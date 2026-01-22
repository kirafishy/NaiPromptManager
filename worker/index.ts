
import bcrypt from 'bcryptjs';

// Add missing D1 type definitions locally
interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  error?: string;
  meta: any;
}

interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  dump(): Promise<ArrayBuffer>;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec<T = unknown>(query: string): Promise<D1Result<T>>;
}

// R2 Type Definitions
interface R2ObjectBody {
  body: ReadableStream;
  writeHttpMetadata(headers: Headers): void;
  httpEtag: string;
}

interface R2Bucket {
    put(key: string, body: ReadableStream | ArrayBuffer | string, options?: any): Promise<any>;
    get(key: string): Promise<R2ObjectBody | null>;
    delete(key: string): Promise<void>;
}

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  DB?: D1Database;
  BUCKET?: R2Bucket; // R2 Binding
  MASTER_KEY: string; 
  R2_PUBLIC_URL?: string; // Kept for legacy compatibility if needed
  GUEST_PASSCODE?: string; // Guest Access Code
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie, Server-Timing',
  'Access-Control-Allow-Credentials': 'true',
};

const json = (data: any, status = 200, headers: Record<string, string> = {}) => 
  new Response(JSON.stringify(data), { 
    headers: { 'Content-Type': 'application/json', ...corsHeaders, ...headers }, 
    status 
  });

const error = (msg: string, status = 500) => 
  new Response(JSON.stringify({ error: msg }), { headers: { 'Content-Type': 'application/json', ...corsHeaders }, status });

// Updated Schema with Users and Sessions
const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL, 
    role TEXT DEFAULT 'user', 
    created_at INTEGER,
    storage_usage INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS chains (
    id TEXT PRIMARY KEY,
    user_id TEXT, 
    username TEXT, 
    name TEXT NOT NULL,
    description TEXT,
    tags TEXT,
    preview_image TEXT,
    base_prompt TEXT DEFAULT '',
    negative_prompt TEXT DEFAULT '',
    modules TEXT DEFAULT '[]',
    params TEXT DEFAULT '{}',
    variable_values TEXT DEFAULT '{}',
    created_at INTEGER,
    updated_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS artists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    image_url TEXT
  );
  CREATE TABLE IF NOT EXISTS inspirations (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    username TEXT,
    title TEXT NOT NULL,
    image_url TEXT,
    prompt TEXT,
    created_at INTEGER
  );
`;

// Constants
const MAX_STORAGE_QUOTA = 300 * 1024 * 1024; // 300MB

// Helper: Parse Cookies
function parseCookies(request: Request) {
  const cookieHeader = request.headers.get('Cookie');
  const cookies: Record<string, string> = {};
  if (cookieHeader) {
    cookieHeader.split(';').forEach(cookie => {
      const [name, value] = cookie.split('=').map(c => c.trim());
      cookies[name] = value;
    });
  }
  return cookies;
}

// Helper: Process Base64 Image and Upload to R2 with Quota Check
// Note: This is kept for Legacy Base64 uploads (e.g. from canvas or old API calls)
async function processImageUpload(
    env: Env, 
    imageData: string, 
    folder: string, 
    id: string,
    user?: { id: string, role: string, storage_usage?: number }
): Promise<string> {
    // If it's already a URL (starts with http or /api), return it as is
    if (imageData.startsWith('http') || imageData.startsWith('/api/')) return imageData;

    if (!env.BUCKET) {
        throw new Error("R2 Bucket not configured");
    }

    // Expecting data:image/png;base64,xxxxxx
    const matches = imageData.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
        throw new Error("Invalid image data format");
    }

    const ext = matches[1]; // png, jpeg, etc.
    const base64Data = matches[2];
    const filename = `${folder}/${id}_${Date.now()}.${ext}`;

    // Convert Base64 to Uint8Array for storage
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    
    const fileSize = bytes.length;

    // --- Quota Check ---
    if (user && user.role !== 'admin') {
        const currentUsage = user.storage_usage || 0;
        if (currentUsage + fileSize > MAX_STORAGE_QUOTA) {
            throw new Error(`Storage quota exceeded (300MB limit). Current: ${(currentUsage/1024/1024).toFixed(1)}MB`);
        }
    }

    // Upload to R2
    await env.BUCKET.put(filename, bytes.buffer, {
        httpMetadata: { contentType: `image/${ext}` }
    });
    
    // Update User Usage if upload successful
    if (user && env.DB) {
        await env.DB.prepare('UPDATE users SET storage_usage = COALESCE(storage_usage, 0) + ? WHERE id = ?')
            .bind(fileSize, user.id).run();
    }

    // Return internal API path instead of public URL
    return `/api/assets/${filename}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // --- R2 Asset Proxy Route (Allow public GET access for images) ---
    if (path.startsWith('/api/assets/') && method === 'GET') {
        if (!env.BUCKET) return error('Bucket not configured', 503);
        
        // Extract key from path: /api/assets/folder/file.png -> folder/file.png
        const rawKey = path.replace('/api/assets/', '');
        const key = decodeURIComponent(rawKey);
        
        const object = await env.BUCKET.get(key);

        if (!object) return error('File not found', 404);

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        // Cache for 1 year (immutable assets)
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        headers.set('Access-Control-Allow-Origin', '*'); // Allow cross-origin for canvas
        
        return new Response(object.body, { headers });
    }

    if (!path.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // DB Guard
    if (!env.DB) {
       return error('Database not configured.', 503);
    }
    const db = env.DB!;

    // Auto Init DB & Default Admin / Guest User
    const initDB = async () => {
      const statements = INIT_SQL.split(';').map(s => s.trim()).filter(s => s.length > 0);
      for (const sql of statements) {
          try { await db.prepare(sql).run(); } catch(e) {}
      }
      // Migration for storage_usage column
      try { await db.prepare("ALTER TABLE users ADD COLUMN storage_usage INTEGER DEFAULT 0").run(); } catch (e) {}
      
      // Migrations for other columns
      try { await db.prepare("ALTER TABLE chains ADD COLUMN user_id TEXT").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE chains ADD COLUMN username TEXT").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE inspirations ADD COLUMN user_id TEXT").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE inspirations ADD COLUMN username TEXT").run(); } catch (e) {}
      
      // Migration for variable_values
      try { await db.prepare("ALTER TABLE chains ADD COLUMN variable_values TEXT DEFAULT '{}'").run(); } catch (e) {}

      // Create Default Admin if not exists
      try {
        const admin = await db.prepare('SELECT * FROM users WHERE username = ?').bind('admin').first();
        if (!admin) {
            const adminId = crypto.randomUUID();
            await db.prepare('INSERT INTO users (id, username, password, role, created_at, storage_usage) VALUES (?, ?, ?, ?, ?, 0)')
              .bind(adminId, 'admin', 'admin_996', 'admin', Date.now()).run();
        }
      } catch (e) { console.error('Admin init failed', e) }

      // Create Default Guest User if not exists
      try {
        const guest = await db.prepare('SELECT * FROM users WHERE role = ?').bind('guest').first();
        if (!guest) {
            const guestId = 'guest-0000-0000-0000-000000000000'; // Static ID for guest
            await db.prepare('INSERT INTO users (id, username, password, role, created_at, storage_usage) VALUES (?, ?, ?, ?, ?, 0)')
              .bind(guestId, 'guest', 'guest_access', 'guest', Date.now()).run();
        }
      } catch (e) { console.error('Guest init failed', e) }
    };

    // --- Authentication Middleware ---
    const getSessionUser = async () => {
        const cookies = parseCookies(request);
        const sessionId = cookies['session_id'];
        if (!sessionId) return null;

        const session = await db.prepare('SELECT * FROM sessions WHERE id = ? AND expires_at > ?')
            .bind(sessionId, Date.now()).first<{user_id: string}>();
        
        if (!session) return null;

        // Auto-heal: try query, if fail (e.g. missing column), run initDB and retry
        try {
            return await db.prepare('SELECT id, username, role, storage_usage FROM users WHERE id = ?')
                .bind(session.user_id).first<{id: string, username: string, role: string, storage_usage: number}>();
        } catch (e: any) {
             if (e.message && e.message.includes('no such column')) {
                 console.log('Detected missing column, running migration...');
                 await initDB();
                 // Retry once
                 return await db.prepare('SELECT id, username, role, storage_usage FROM users WHERE id = ?')
                    .bind(session.user_id).first<{id: string, username: string, role: string, storage_usage: number}>();
             }
             throw e;
        }
    };

    try {
      // --- Public/Auth Routes ---
      
      // Init Check (Silent)
      if (path === '/api/init') {
          await initDB();
          return json({ success: true });
      }

      // Guest Login
      if (path === '/api/auth/guest-login' && method === 'POST') {
          const { passcode } = await request.json() as any;
          if (!passcode) return error('请输入访问口令', 400);
          
          if (passcode !== env.GUEST_PASSCODE) {
              return error('访问口令错误', 401);
          }

          // Ensure guest user exists (lazy check)
          try { await db.prepare('SELECT 1 FROM users WHERE role = ?').bind('guest').first(); } catch(e) { await initDB(); }
          
          const guestUser = await db.prepare('SELECT * FROM users WHERE role = ?').bind('guest').first<{id: string, username: string, role: string}>();
          
          if (!guestUser) return error('Guest user configuration error', 500);

          const sessionId = crypto.randomUUID();
          const expiresAt = Date.now() + 1 * 24 * 60 * 60 * 1000; // 1 day for guests

          await db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
              .bind(sessionId, guestUser.id, expiresAt).run();

          return json({ success: true, user: { id: guestUser.id, username: guestUser.username, role: 'guest', storageUsage: 0 } }, 200, {
              'Set-Cookie': `session_id=${sessionId}; Expires=${new Date(expiresAt).toUTCString()}; Path=/; SameSite=Lax; HttpOnly`
          });
      }

      // Login (UPDATED: Hash Support & Lazy Migration)
      if (path === '/api/auth/login' && method === 'POST') {
          const { username, password } = await request.json() as any;
          try { await db.prepare('SELECT 1 FROM users').first(); } catch(e) { await initDB(); }

          const user = await db.prepare('SELECT * FROM users WHERE username = ?')
              .bind(username).first<{id: string, role: string, storage_usage: number, password: string}>();

          if (!user) return error('用户名或密码错误', 401);
          if (user.role === 'guest') return error('Invalid login method', 401);

          let isValid = false;
          let needMigration = false;

          isValid = await bcrypt.compare(password, user.password);

          if (!isValid && user.password === password) {
              isValid = true;
              needMigration = true; 
          }

          if (!isValid) return error('用户名或密码错误', 401);

          if (needMigration) {
              const newHash = await bcrypt.hash(password, 10);
              await db.prepare('UPDATE users SET password = ? WHERE id = ?')
                  .bind(newHash, user.id).run();
          }

          const sessionId = crypto.randomUUID();
          const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

          await db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
              .bind(sessionId, user.id, expiresAt).run();

          return json({ success: true, user: { id: user.id, username, role: user.role, storageUsage: user.storage_usage || 0 } }, 200, {
              'Set-Cookie': `session_id=${sessionId}; Expires=${new Date(expiresAt).toUTCString()}; Path=/; SameSite=Lax; HttpOnly`
          });
      }

      // Logout
      if (path === '/api/auth/logout' && method === 'POST') {
          const cookies = parseCookies(request);
          if (cookies['session_id']) {
              await db.prepare('DELETE FROM sessions WHERE id = ?').bind(cookies['session_id']).run();
          }
          return json({ success: true }, 200, {
              'Set-Cookie': `session_id=; Max-Age=0; Path=/; SameSite=Lax; HttpOnly`
          });
      }

      // Check Session
      if (path === '/api/auth/me' && method === 'GET') {
          const user = await getSessionUser();
          if (!user) return error('Unauthorized', 401);
          return json({
              id: user.id, 
              username: user.username, 
              role: user.role,
              storageUsage: user.storage_usage || 0
          });
      }

      // --- Protected Routes Logic ---
      const currentUser = await getSessionUser();
      if (!currentUser) return error('Unauthorized', 401);

      // --- NAI Proxy (With Guest Guard Removed) ---
      if (path === '/api/generate' && method === 'POST') {
        const body = await request.json();
        const clientAuth = request.headers.get('Authorization'); 
        if (!clientAuth) return error('Missing API Key', 401);

        const naiRes = await fetch("https://image.novelai.net/ai/generate-image", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": clientAuth },
          body: JSON.stringify(body)
        });

        if (!naiRes.ok) return error(await naiRes.text(), naiRes.status);
        const blob = await naiRes.blob();
        return new Response(blob, { headers: { ...corsHeaders, 'Content-Type': 'application/zip' } });
      }

      // --- NEW: Binary Upload Endpoint (Multipart with Streaming) ---
      if (path === '/api/upload' && method === 'POST') {
          if (!env.BUCKET) return error('R2 Bucket not configured', 503);
          
          if (currentUser.role === 'guest') return error('Guests cannot upload files', 403);

          const timings: string[] = [];
          const startTotal = performance.now();

          const formData = await request.formData();
          const file = formData.get('file');

          if (!file || !(file instanceof File)) {
              return error('No file uploaded or invalid format', 400);
          }

          const folder = formData.get('folder') as string || 'misc';
          const ext = file.name.split('.').pop() || 'png';
          const filename = `${folder}/${currentUser.id}_${Date.now()}.${ext}`;
          const fileSize = file.size; // Use size from metadata, no arrayBuffer needed yet

          // 1. DB Check (Quota)
          // We rely on currentUser.storage_usage which was fetched at start of request.
          // This avoids an extra DB call here.
          const startDbCheck = performance.now();
          if (currentUser.role !== 'admin') {
              const currentUsage = currentUser.storage_usage || 0;
              if (currentUsage + fileSize > MAX_STORAGE_QUOTA) {
                  return error(`Storage quota exceeded. Limit: 300MB`, 413);
              }
          }
          timings.push(`db_check;dur=${(performance.now() - startDbCheck).toFixed(2)}`);

          // 2. R2 Put (Streaming)
          // Using file.stream() pipes the data directly to R2 without buffering the whole file in worker memory
          const startR2 = performance.now();
          await env.BUCKET.put(filename, file.stream(), {
              httpMetadata: { contentType: file.type }
          });
          timings.push(`r2_put;dur=${(performance.now() - startR2).toFixed(2)}`);

          // 3. DB Update (Usage)
          const startDbUp = performance.now();
          await db.prepare('UPDATE users SET storage_usage = COALESCE(storage_usage, 0) + ? WHERE id = ?')
              .bind(fileSize, currentUser.id).run();
          timings.push(`db_update;dur=${(performance.now() - startDbUp).toFixed(2)}`);
          
          timings.push(`total;dur=${(performance.now() - startTotal).toFixed(2)}`);

          return json(
              { url: `/api/assets/${filename}`, size: fileSize }, 
              200, 
              { 'Server-Timing': timings.join(', ') }
          );
      }

      // --- User Management ---
      if (path === '/api/users' && method === 'POST') {
          if (currentUser.role !== 'admin') return error('Forbidden', 403);
          const { username, password } = await request.json() as any;
          if (!username || !password) return error('Missing fields', 400);
          
          const hashedPassword = await bcrypt.hash(password, 10);

          try {
              const id = crypto.randomUUID();
              await db.prepare('INSERT INTO users (id, username, password, role, created_at, storage_usage) VALUES (?, ?, ?, ?, ?, 0)')
                  .bind(id, username, hashedPassword, 'user', Date.now()).run();
              return json({ success: true });
          } catch(e: any) {
              if (e.message.includes('UNIQUE constraint')) return error('Username exists', 409);
              throw e;
          }
      }

      if (path === '/api/users/password' && method === 'PUT') {
          const { password } = await request.json() as any;
          if (!password) return error('Missing password', 400);
          
          const hashedPassword = await bcrypt.hash(password, 10);

          await db.prepare('UPDATE users SET password = ? WHERE id = ?')
              .bind(hashedPassword, currentUser.id).run();
          return json({ success: true });
      }
      
      if (path === '/api/users' && method === 'GET') {
         if (currentUser.role !== 'admin') return error('Forbidden', 403);
         const res = await db.prepare('SELECT id, username, role, created_at, storage_usage FROM users ORDER BY created_at DESC').all();
         return json(res.results.map((u: any) => ({
             id: u.id, username: u.username, role: u.role, createdAt: u.created_at, storageUsage: u.storage_usage
         })));
      }

      if (path.startsWith('/api/users/') && method === 'DELETE') {
         if (currentUser.role !== 'admin') return error('Forbidden', 403);
         const id = path.split('/').pop();
         if (id === currentUser.id) return error('Cannot delete self', 400);
         await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
         return json({ success: true });
      }

      // --- Chains ---
      if (path === '/api/chains' && method === 'GET') {
        const chainsResult = await db.prepare('SELECT * FROM chains ORDER BY updated_at DESC').all();
        const data = chainsResult.results.map((c: any) => ({
          id: c.id, userId: c.user_id, username: c.username, name: c.name, description: c.description,
          tags: JSON.parse(c.tags || '[]'), previewImage: c.preview_image, basePrompt: c.base_prompt,
          negativePrompt: c.negative_prompt, modules: JSON.parse(c.modules || '[]'), params: JSON.parse(c.params || '{}'),
          variableValues: JSON.parse(c.variable_values || '{}'),
          createdAt: c.created_at, updatedAt: c.updated_at
        }));
        return json(data);
      }

      if (path === '/api/chains' && method === 'POST') {
        if (currentUser.role === 'guest') return error('Guests cannot create chains', 403);
        const body = await request.json() as any;
        const id = crypto.randomUUID();
        const now = Date.now();
        const basePrompt = body.basePrompt || 'masterpiece, best quality';
        const negPrompt = body.negativePrompt || 'lowres, bad anatomy';
        const modules = body.modules ? JSON.stringify(body.modules) : JSON.stringify([{ id: crypto.randomUUID(), name: "光照", content: "cinematic lighting", isActive: true, position: 'post' }]);
        const params = body.params ? JSON.stringify(body.params) : JSON.stringify({ width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral' });
        const vars = body.variableValues ? JSON.stringify(body.variableValues) : JSON.stringify({ subject: '1girl' });

        await db.prepare(
        `INSERT INTO chains 
        (id, user_id, username, name, description, tags, preview_image, base_prompt, negative_prompt, modules, params, variable_values, created_at, updated_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(id, currentUser.id, currentUser.username, body.name, body.description, '[]', null, basePrompt, negPrompt, modules, params, vars, now, now).run();

        return json({ id });
      }

      const chainIdMatch = path.match(/^\/api\/chains\/([^\/]+)$/);
      if (chainIdMatch && method === 'PUT') {
        if (currentUser.role === 'guest') return error('Guests cannot update chains', 403);
        const id = chainIdMatch[1];
        const updates = await request.json() as any;
        
        const chain = await db.prepare('SELECT user_id, preview_image FROM chains WHERE id = ?').bind(id).first<{user_id: string, preview_image: string}>();
        if (!chain) return error('Not Found', 404);
        if (chain.user_id && chain.user_id !== currentUser.id && currentUser.role !== 'admin') {
            return error('Permission Denied', 403);
        }

        const fields = [];
        const values = [];
        
        if (updates.previewImage && chain.preview_image && chain.preview_image !== updates.previewImage) {
             if (env.BUCKET && chain.preview_image.startsWith('/api/assets/')) {
                 try {
                     const oldKey = chain.preview_image.replace('/api/assets/', '');
                     await env.BUCKET.delete(oldKey);
                 } catch (err) {
                     console.error('Failed to delete old image', err);
                 }
             }
        }
        
        if (updates.previewImage && updates.previewImage.startsWith('data:')) {
             try {
                const r2Url = await processImageUpload(env, updates.previewImage, 'covers', id, currentUser);
                updates.previewImage = r2Url;
             } catch (e: any) {
                return error(`Image upload failed: ${e.message}`, 413);
             }
        }

        if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
        if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
        if (updates.previewImage !== undefined) { fields.push('preview_image = ?'); values.push(updates.previewImage); }
        if (updates.basePrompt !== undefined) { fields.push('base_prompt = ?'); values.push(updates.basePrompt); }
        if (updates.negativePrompt !== undefined) { fields.push('negative_prompt = ?'); values.push(updates.negativePrompt); }
        if (updates.modules !== undefined) { fields.push('modules = ?'); values.push(JSON.stringify(updates.modules)); }
        if (updates.params !== undefined) { fields.push('params = ?'); values.push(JSON.stringify(updates.params)); }
        if (updates.variableValues !== undefined) { fields.push('variable_values = ?'); values.push(JSON.stringify(updates.variableValues)); }

        if (fields.length > 0) {
           fields.push('updated_at = ?');
           values.push(Date.now());
           values.push(id);
           await db.prepare(`UPDATE chains SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
        }
        return json({ success: true });
      }

      if (chainIdMatch && method === 'DELETE') {
        if (currentUser.role === 'guest') return error('Guests cannot delete chains', 403);
        const id = chainIdMatch[1];
        const chain = await db.prepare('SELECT user_id FROM chains WHERE id = ?').bind(id).first<{user_id: string}>();
        if (chain) {
            if (chain.user_id && chain.user_id !== currentUser.id && currentUser.role !== 'admin') {
                return error('Permission Denied', 403);
            }
            await db.prepare('DELETE FROM chains WHERE id = ?').bind(id).run();
        }
        return json({ success: true });
      }

      // --- Artists ---
      if (path === '/api/artists' && method === 'GET') {
         const res = await db.prepare('SELECT * FROM artists ORDER BY name ASC').all();
         return json(res.results.map((a: any) => ({
             id: a.id,
             name: a.name,
             imageUrl: a.image_url
         })));
      }
      if (path === '/api/artists' && method === 'POST') {
        if (currentUser.role !== 'admin') return error('Forbidden', 403);
        const body = await request.json() as any;
        
        if (body.imageUrl && body.imageUrl.startsWith('data:')) {
             body.imageUrl = await processImageUpload(env, body.imageUrl, 'artists', body.id || crypto.randomUUID());
        }

        await db.prepare('INSERT OR REPLACE INTO artists (id, name, image_url) VALUES (?, ?, ?)').bind(body.id, body.name, body.imageUrl).run();
        return json({ success: true });
      }
      if (path.startsWith('/api/artists/') && method === 'DELETE') {
        if (currentUser.role !== 'admin') return error('Forbidden', 403);
        const id = path.split('/').pop();
        await db.prepare('DELETE FROM artists WHERE id = ?').bind(id).run();
        return json({ success: true });
      }

      // --- Inspirations ---
      if (path === '/api/inspirations' && method === 'GET') {
        const res = await db.prepare('SELECT * FROM inspirations ORDER BY created_at DESC').all();
        return json(res.results.map((i: any) => ({ 
            id: i.id, userId: i.user_id, username: i.username, title: i.title, 
            imageUrl: i.image_url, prompt: i.prompt, createdAt: i.created_at
        }))); 
      }
      
      if (path === '/api/inspirations' && method === 'POST') {
        if (currentUser.role === 'guest') return error('Guests cannot upload inspirations', 403);
        const body = await request.json() as any;
        let imageUrl = body.imageUrl;

        if (imageUrl && imageUrl.startsWith('data:')) {
            try {
                imageUrl = await processImageUpload(env, imageUrl, 'inspirations', body.id || crypto.randomUUID(), currentUser);
            } catch (e: any) {
                return error(`Image upload failed: ${e.message}`, 413);
            }
        }

        await db.prepare('INSERT OR REPLACE INTO inspirations (id, user_id, username, title, image_url, prompt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(body.id, currentUser.id, currentUser.username, body.title, imageUrl, body.prompt, body.createdAt).run();
        return json({ success: true });
      }
      
      if (path === '/api/inspirations/bulk-delete' && method === 'POST') {
          if (currentUser.role === 'guest') return error('Guests cannot delete inspirations', 403);
          const { ids } = await request.json() as { ids: string[] };
          if (!ids || ids.length === 0) return json({ success: true });

          if (currentUser.role === 'admin') {
              for (const id of ids) await db.prepare('DELETE FROM inspirations WHERE id = ?').bind(id).run();
          } else {
              for (const id of ids) {
                  await db.prepare('DELETE FROM inspirations WHERE id = ? AND user_id = ?').bind(id, currentUser.id).run();
              }
          }
          return json({ success: true });
      }

      if (path.startsWith('/api/inspirations/') && method === 'PUT') {
         if (currentUser.role === 'guest') return error('Guests cannot update inspirations', 403);
         const id = path.split('/').pop();
         const updates = await request.json() as any;
         
         const item = await db.prepare('SELECT user_id FROM inspirations WHERE id = ?').bind(id).first<{user_id: string}>();
         if (!item) return error('Not Found', 404);
         
         if (item.user_id !== currentUser.id && currentUser.role !== 'admin') {
             return error('Permission Denied', 403);
         }

         if (updates.title) await db.prepare('UPDATE inspirations SET title = ? WHERE id = ?').bind(updates.title, id).run();
         if (updates.prompt) await db.prepare('UPDATE inspirations SET prompt = ? WHERE id = ?').bind(updates.prompt, id).run();
         
         return json({ success: true });
      }

      if (path.startsWith('/api/inspirations/') && method === 'DELETE') {
         if (currentUser.role === 'guest') return error('Guests cannot delete inspirations', 403);
         const id = path.split('/').pop();
         const item = await db.prepare('SELECT user_id FROM inspirations WHERE id = ?').bind(id).first<{user_id: string}>();
         if (item) {
             if (item.user_id !== currentUser.id && currentUser.role !== 'admin') {
                 return error('Permission Denied', 403);
             }
             await db.prepare('DELETE FROM inspirations WHERE id = ?').bind(id).run();
         }
         return json({ success: true });
      }

      if (path.startsWith('/api/')) return error('Not Found', 404);
      return env.ASSETS.fetch(request);

    } catch (e: any) {
      return error(e.message, 500);
    }
  }
};
