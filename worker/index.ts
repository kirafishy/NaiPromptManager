
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

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  DB?: D1Database;
  MASTER_KEY: string; // Legacy env var, kept to avoid deployment errors
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie',
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
    password TEXT NOT NULL, -- Simple storage for this demo, usually should be salted hash
    role TEXT DEFAULT 'user', -- 'admin' or 'user'
    created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS chains (
    id TEXT PRIMARY KEY,
    user_id TEXT, -- Owner
    username TEXT, -- Cache for display
    name TEXT NOT NULL,
    description TEXT,
    tags TEXT,
    preview_image TEXT,
    base_prompt TEXT DEFAULT '',
    negative_prompt TEXT DEFAULT '',
    modules TEXT DEFAULT '[]',
    params TEXT DEFAULT '{}',
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

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

    // Auto Init DB & Default Admin
    const initDB = async () => {
      const statements = INIT_SQL.split(';').map(s => s.trim()).filter(s => s.length > 0);
      for (const sql of statements) {
          await db.prepare(sql).run();
      }
      // Create Default Admin if not exists
      try {
        const admin = await db.prepare('SELECT * FROM users WHERE username = ?').bind('admin').first();
        if (!admin) {
            const adminId = crypto.randomUUID();
            // Default: admin / admin_996
            await db.prepare('INSERT INTO users (id, username, password, role, created_at) VALUES (?, ?, ?, ?, ?)')
              .bind(adminId, 'admin', 'admin_996', 'admin', Date.now()).run();
        }
      } catch (e) { console.error('Admin init failed', e) }
    };

    // --- Authentication Middleware ---
    const getSessionUser = async () => {
        const cookies = parseCookies(request);
        const sessionId = cookies['session_id'];
        if (!sessionId) return null;

        const session = await db.prepare('SELECT * FROM sessions WHERE id = ? AND expires_at > ?')
            .bind(sessionId, Date.now()).first<{user_id: string}>();
        
        if (!session) return null;

        return await db.prepare('SELECT id, username, role FROM users WHERE id = ?')
            .bind(session.user_id).first<{id: string, username: string, role: string}>();
    };

    try {
      // --- Public/Auth Routes ---
      
      // Init Check (Silent)
      if (path === '/api/init') {
          await initDB();
          return json({ success: true });
      }

      // Login
      if (path === '/api/auth/login' && method === 'POST') {
          const { username, password } = await request.json() as any;
          
          try {
             // Ensure tables exist on first login attempt
             await db.prepare('SELECT 1 FROM users').first(); 
          } catch(e) { await initDB(); }

          const user = await db.prepare('SELECT * FROM users WHERE username = ? AND password = ?')
              .bind(username, password).first<{id: string, role: string}>();

          if (!user) return error('用户名或密码错误', 401);

          const sessionId = crypto.randomUUID();
          const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

          await db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
              .bind(sessionId, user.id, expiresAt).run();

          return json({ success: true, user: { id: user.id, username, role: user.role } }, 200, {
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
          return json(user);
      }

      // --- NAI Proxy (Public wrapper, but we check session) ---
      if (path === '/api/generate' && method === 'POST') {
        const body = await request.json();
        const clientAuth = request.headers.get('Authorization'); // Key comes from frontend localstorage still
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

      // --- Protected Routes Logic ---
      const currentUser = await getSessionUser();
      if (!currentUser) return error('Unauthorized', 401);

      // --- User Management ---
      
      // Create User (Admin Only)
      if (path === '/api/users' && method === 'POST') {
          if (currentUser.role !== 'admin') return error('Forbidden', 403);
          const { username, password } = await request.json() as any;
          if (!username || !password) return error('Missing fields', 400);
          
          try {
              const id = crypto.randomUUID();
              await db.prepare('INSERT INTO users (id, username, password, role, created_at) VALUES (?, ?, ?, ?, ?)')
                  .bind(id, username, password, 'user', Date.now()).run();
              return json({ success: true });
          } catch(e: any) {
              if (e.message.includes('UNIQUE constraint')) return error('Username exists', 409);
              throw e;
          }
      }

      // Change Password (Self)
      if (path === '/api/users/password' && method === 'PUT') {
          const { password } = await request.json() as any;
          if (!password) return error('Missing password', 400);
          await db.prepare('UPDATE users SET password = ? WHERE id = ?')
              .bind(password, currentUser.id).run();
          return json({ success: true });
      }
      
      // Get User List (Admin Only)
      if (path === '/api/users' && method === 'GET') {
         if (currentUser.role !== 'admin') return error('Forbidden', 403);
         const res = await db.prepare('SELECT id, username, role, created_at FROM users ORDER BY created_at DESC').all();
         return json(res.results);
      }

      // Delete User (Admin Only)
      if (path.startsWith('/api/users/') && method === 'DELETE') {
         if (currentUser.role !== 'admin') return error('Forbidden', 403);
         const id = path.split('/').pop();
         if (id === currentUser.id) return error('Cannot delete self', 400);
         await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
         return json({ success: true });
      }

      // --- Chains ---
      if (path === '/api/chains' && method === 'GET') {
        // Ensure schema columns exist
        try { await db.prepare('SELECT user_id FROM chains LIMIT 1').run(); } 
        catch { 
           // Migration columns
           try { await db.prepare("ALTER TABLE chains ADD COLUMN user_id TEXT").run(); } catch {}
           try { await db.prepare("ALTER TABLE chains ADD COLUMN username TEXT").run(); } catch {}
           try { await db.prepare("ALTER TABLE inspirations ADD COLUMN user_id TEXT").run(); } catch {}
           try { await db.prepare("ALTER TABLE inspirations ADD COLUMN username TEXT").run(); } catch {}
        }

        const chainsResult = await db.prepare('SELECT * FROM chains ORDER BY updated_at DESC').all();
        const data = chainsResult.results.map((c: any) => ({
          ...c,
          userId: c.user_id, // Map for frontend
          tags: JSON.parse(c.tags || '[]'),
          modules: JSON.parse(c.modules || '[]'),
          params: JSON.parse(c.params || '{}')
        }));
        return json(data);
      }

      if (path === '/api/chains' && method === 'POST') {
        const body = await request.json() as any;
        const id = crypto.randomUUID();
        const now = Date.now();
        
        // Use provided modules/params or defaults
        const basePrompt = body.basePrompt || 'masterpiece, best quality, {character}';
        const negPrompt = body.negativePrompt || 'lowres, bad anatomy';
        const modules = body.modules ? JSON.stringify(body.modules) : JSON.stringify([{ id: crypto.randomUUID(), name: "光照", content: "cinematic lighting", isActive: true }]);
        const params = body.params ? JSON.stringify(body.params) : JSON.stringify({ width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral' });

        await db.prepare(
        `INSERT INTO chains 
        (id, user_id, username, name, description, tags, preview_image, base_prompt, negative_prompt, modules, params, created_at, updated_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(id, currentUser.id, currentUser.username, body.name, body.description, '[]', body.previewImage || null, basePrompt, negPrompt, modules, params, now, now).run();

        return json({ id });
      }

      const chainIdMatch = path.match(/^\/api\/chains\/([^\/]+)$/);
      if (chainIdMatch && method === 'PUT') {
        const id = chainIdMatch[1];
        const updates = await request.json() as any;
        
        // Ownership check
        const chain = await db.prepare('SELECT user_id FROM chains WHERE id = ?').bind(id).first<{user_id: string}>();
        if (!chain) return error('Not Found', 404);
        if (chain.user_id && chain.user_id !== currentUser.id && currentUser.role !== 'admin') {
            return error('Permission Denied', 403);
        }

        const fields = [];
        const values = [];
        
        if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
        if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
        if (updates.previewImage !== undefined) { fields.push('preview_image = ?'); values.push(updates.previewImage); }
        if (updates.basePrompt !== undefined) { fields.push('base_prompt = ?'); values.push(updates.basePrompt); }
        if (updates.negativePrompt !== undefined) { fields.push('negative_prompt = ?'); values.push(updates.negativePrompt); }
        if (updates.modules !== undefined) { fields.push('modules = ?'); values.push(JSON.stringify(updates.modules)); }
        if (updates.params !== undefined) { fields.push('params = ?'); values.push(JSON.stringify(updates.params)); }

        if (fields.length > 0) {
           fields.push('updated_at = ?');
           values.push(Date.now());
           values.push(id);
           await db.prepare(`UPDATE chains SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
        }
        return json({ success: true });
      }

      if (chainIdMatch && method === 'DELETE') {
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

      // --- Artists (Admin Only Write) ---
      if (path === '/api/artists' && method === 'GET') {
         const res = await db.prepare('SELECT * FROM artists ORDER BY name ASC').all();
         return json(res.results);
      }
      if (path === '/api/artists' && method === 'POST') {
        if (currentUser.role !== 'admin') return error('Forbidden', 403);
        const body = await request.json() as any;
        await db.prepare('INSERT OR REPLACE INTO artists (id, name, image_url) VALUES (?, ?, ?)').bind(body.id, body.name, body.imageUrl).run();
        return json({ success: true });
      }
      if (path.startsWith('/api/artists/') && method === 'DELETE') {
        if (currentUser.role !== 'admin') return error('Forbidden', 403);
        const id = path.split('/').pop();
        await db.prepare('DELETE FROM artists WHERE id = ?').bind(id).run();
        return json({ success: true });
      }

      // --- Inspirations (Shared Read, Owner/Admin Write) ---
      if (path === '/api/inspirations' && method === 'GET') {
        const res = await db.prepare('SELECT * FROM inspirations ORDER BY created_at DESC').all();
        return json(res.results.map((i: any) => ({ ...i, userId: i.user_id }))); // Map userId
      }
      if (path === '/api/inspirations' && method === 'POST') {
        const body = await request.json() as any;
        await db.prepare('INSERT OR REPLACE INTO inspirations (id, user_id, username, title, image_url, prompt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(body.id, currentUser.id, currentUser.username, body.title, body.imageUrl, body.prompt, body.createdAt).run();
        return json({ success: true });
      }
      
      // Bulk Delete Inspirations
      if (path === '/api/inspirations/bulk-delete' && method === 'POST') {
          const { ids } = await request.json() as { ids: string[] };
          if (!ids || ids.length === 0) return json({ success: true });

          // Need to verify ownership for each or be admin
          if (currentUser.role === 'admin') {
              // Efficient delete for admin
              // D1 doesn't support array binding in IN nicely yet in all drivers, assume simple loop for safety or JSON string check
              // Using loop for safety in D1 alpha/beta nuances
              for (const id of ids) await db.prepare('DELETE FROM inspirations WHERE id = ?').bind(id).run();
          } else {
              // User can only delete their own
              for (const id of ids) {
                  await db.prepare('DELETE FROM inspirations WHERE id = ? AND user_id = ?').bind(id, currentUser.id).run();
              }
          }
          return json({ success: true });
      }

      // Update Inspiration (Title/Prompt)
      if (path.startsWith('/api/inspirations/') && method === 'PUT') {
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

      // Fallback
      if (path.startsWith('/api/')) return error('Not Found', 404);
      return env.ASSETS.fetch(request);

    } catch (e: any) {
      return error(e.message, 500);
    }
  }
};
