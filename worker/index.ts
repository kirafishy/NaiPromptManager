
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
  // GUEST_PASSCODE removed, now stored in DB
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

// Updated Schema with Users, Sessions, and Settings
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
    type TEXT DEFAULT 'style',
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
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
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

// Helper: 记录登录日志
async function logAccess(
  db: D1Database, 
  user: {id: string, username: string, role: string}, 
  request: Request, 
  action: string
) {
  const ip = request.headers.get('CF-Connecting-IP') || 
             request.headers.get('X-Forwarded-For') || 
             'unknown';
  const userAgent = request.headers.get('User-Agent') || 'unknown';
  try {
    await db.prepare(
      'INSERT INTO access_logs (user_id, username, role, ip, user_agent, action, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(user.id, user.username, user.role, ip, userAgent.slice(0, 200), action, Date.now()).run();
  } catch (e) {
    console.error('Failed to log access:', e);
  }
}

// Helper: 更新每日统计
async function incrementDailyStat(db: D1Database, field: string) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  try {
    await db.prepare(`
      INSERT INTO daily_stats (date, ${field}) VALUES (?, 1)
      ON CONFLICT(date) DO UPDATE SET ${field} = ${field} + 1
    `).bind(today).run();
  } catch (e) {
    console.error('Failed to update daily stat:', e);
  }
}

// Helper: Delete File from R2
async function deleteR2File(env: Env, url: string) {
    if (!env.BUCKET || !url) return;
    // Check if it is a local API asset URL
    if (url.startsWith('/api/assets/')) {
        const key = url.replace('/api/assets/', '');
        try {
            await env.BUCKET.delete(decodeURIComponent(key));
            console.log(`Deleted old file: ${key}`);
        } catch (e) {
            console.error(`Failed to delete file ${key}`, e);
        }
    }
}

// Helper: Process Base64 Image and Upload to R2 with Quota Check
async function processImageUpload(
    env: Env, 
    imageData: string, 
    folder: string, 
    id: string,
    user?: { id: string, role: string, storage_usage?: number }
): Promise<string> {
    if (imageData.startsWith('http') || imageData.startsWith('/api/')) return imageData;

    if (!env.BUCKET) {
        throw new Error("R2 Bucket not configured");
    }

    const matches = imageData.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
        throw new Error("Invalid image data format");
    }

    const ext = matches[1]; 
    const base64Data = matches[2];
    const filename = `${folder}/${id}_${Date.now()}.${ext}`;

    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    
    const fileSize = bytes.length;

    if (user && user.role !== 'admin') {
        const currentUsage = user.storage_usage || 0;
        if (currentUsage + fileSize > MAX_STORAGE_QUOTA) {
            throw new Error(`Storage quota exceeded (300MB limit).`);
        }
    }

    await env.BUCKET.put(filename, bytes.buffer, {
        httpMetadata: { contentType: `image/${ext}` }
    });
    
    if (user && env.DB) {
        await env.DB.prepare('UPDATE users SET storage_usage = COALESCE(storage_usage, 0) + ? WHERE id = ?')
            .bind(fileSize, user.id).run();
    }

    return `/api/assets/${filename}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // --- R2 Asset Proxy Route (Allow public GET access) ---
    if (path.startsWith('/api/assets/') && method === 'GET') {
        if (!env.BUCKET) return error('Bucket not configured', 503);
        const rawKey = path.replace('/api/assets/', '');
        const key = decodeURIComponent(rawKey);
        const object = await env.BUCKET.get(key);
        if (!object) return error('File not found', 404);
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        headers.set('Access-Control-Allow-Origin', '*'); 
        return new Response(object.body, { headers });
    }

    if (!path.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (!env.DB) {
       return error('Database not configured.', 503);
    }
    const db = env.DB!;

    // Auto Init DB
    const initDB = async () => {
      const statements = INIT_SQL.split(';').map(s => s.trim()).filter(s => s.length > 0);
      for (const sql of statements) {
          try { await db.prepare(sql).run(); } catch(e) {}
      }
      try { await db.prepare("ALTER TABLE users ADD COLUMN storage_usage INTEGER DEFAULT 0").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE chains ADD COLUMN user_id TEXT").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE chains ADD COLUMN username TEXT").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE inspirations ADD COLUMN user_id TEXT").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE inspirations ADD COLUMN username TEXT").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE chains ADD COLUMN variable_values TEXT DEFAULT '{}'").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE artists ADD COLUMN preview_url TEXT").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE artists ADD COLUMN benchmarks TEXT DEFAULT '[]'").run(); } catch (e) {}
      try { await db.prepare("ALTER TABLE chains ADD COLUMN type TEXT DEFAULT 'style'").run(); } catch (e) {}

      // 创建访问日志表
      try {
        await db.prepare(`
          CREATE TABLE IF NOT EXISTS access_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            username TEXT,
            role TEXT,
            ip TEXT,
            user_agent TEXT,
            action TEXT,
            created_at INTEGER
          )
        `).run();
        await db.prepare('CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON access_logs(created_at)').run();
        await db.prepare('CREATE INDEX IF NOT EXISTS idx_access_logs_role ON access_logs(role)').run();
      } catch (e) { console.error('Access logs table init failed', e) }

      // 创建每日统计表
      try {
        await db.prepare(`
          CREATE TABLE IF NOT EXISTS daily_stats (
            date TEXT PRIMARY KEY,
            total_requests INTEGER DEFAULT 0,
            api_requests INTEGER DEFAULT 0,
            guest_logins INTEGER DEFAULT 0,
            user_logins INTEGER DEFAULT 0,
            generate_requests INTEGER DEFAULT 0
          )
        `).run();
      } catch (e) { console.error('Daily stats table init failed', e) }

      // Default Admin
      try {
        const admin = await db.prepare('SELECT * FROM users WHERE username = ?').bind('admin').first();
        if (!admin) {
            const adminId = crypto.randomUUID();
            await db.prepare('INSERT INTO users (id, username, password, role, created_at, storage_usage) VALUES (?, ?, ?, ?, ?, 0)')
              .bind(adminId, 'admin', 'admin_996', 'admin', Date.now()).run();
        }
      } catch (e) { console.error('Admin init failed', e) }

      // Default Guest
      try {
        const guestName = 'guest';
        const existing = await db.prepare('SELECT * FROM users WHERE username = ?').bind(guestName).first<{id: string, role: string}>();
        if (!existing) {
             const guestId = 'guest-0000-0000-0000-000000000000';
             await db.prepare("INSERT INTO users (id, username, password, role, created_at, storage_usage) VALUES (?, ?, 'nai_guest_123', 'guest', ?, 0)")
               .bind(guestId, guestName, Date.now()).run();
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
        try {
            return await db.prepare('SELECT id, username, role, storage_usage FROM users WHERE id = ?')
                .bind(session.user_id).first<{id: string, username: string, role: string, storage_usage: number}>();
        } catch (e: any) {
             if (e.message && e.message.includes('no such column')) {
                 await initDB();
                 return await db.prepare('SELECT id, username, role, storage_usage FROM users WHERE id = ?')
                    .bind(session.user_id).first<{id: string, username: string, role: string, storage_usage: number}>();
             }
             throw e;
        }
    };

    try {
      if (path === '/api/init') { await initDB(); return json({ success: true }); }

      // --- PUBLIC: Benchmark Config (Read) ---
      if (path === '/api/config/benchmarks' && method === 'GET') {
          const res = await db.prepare('SELECT value FROM settings WHERE key = ?').bind('benchmark_config').first<{value: string}>();
          return json({ config: res ? JSON.parse(res.value) : null });
      }

      // Guest Login & Normal Login Logic
      if (path === '/api/auth/guest-login' && method === 'POST') {
          const { passcode } = await request.json() as any;
          if (!passcode) return error('请输入访问口令', 400);
          let guestUser = await db.prepare('SELECT * FROM users WHERE role = ?').bind('guest').first<{id: string, username: string, role: string, password: string}>();
          if (!guestUser) { await initDB(); guestUser = await db.prepare('SELECT * FROM users WHERE role = ?').bind('guest').first<{id: string, username: string, role: string, password: string}>(); }
          if (!guestUser) return error('System Error', 500);
          if (passcode !== guestUser.password) return error('访问口令错误', 401);
          const sessionId = crypto.randomUUID();
          const expiresAt = Date.now() + 86400000;
          await db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').bind(sessionId, guestUser.id, expiresAt).run();
          // 记录登录日志和每日统计
          await logAccess(db, { id: guestUser.id, username: guestUser.username, role: 'guest' }, request, 'guest_login');
          await incrementDailyStat(db, 'guest_logins');
          return json({ success: true, user: { id: guestUser.id, username: guestUser.username, role: 'guest', storageUsage: 0 } }, 200, { 'Set-Cookie': `session_id=${sessionId}; Expires=${new Date(expiresAt).toUTCString()}; Path=/; SameSite=Lax; HttpOnly` });
      }

      if (path === '/api/auth/login' && method === 'POST') {
          const { username, password } = await request.json() as any;
          try { await db.prepare('SELECT 1 FROM users').first(); } catch(e) { await initDB(); }
          const user = await db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<{id: string, role: string, storage_usage: number, password: string}>();
          if (!user) return error('用户名或密码错误', 401);
          if (user.role === 'guest') return error('Invalid login method', 401);
          let isValid = await bcrypt.compare(password, user.password);
          if (!isValid && user.password === password) { isValid = true; const newHash = await bcrypt.hash(password, 10); await db.prepare('UPDATE users SET password = ? WHERE id = ?').bind(newHash, user.id).run(); }
          if (!isValid) return error('用户名或密码错误', 401);
          const sessionId = crypto.randomUUID();
          const expiresAt = Date.now() + 604800000;
          await db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').bind(sessionId, user.id, expiresAt).run();
          // 记录登录日志和每日统计
          await logAccess(db, { id: user.id, username, role: user.role }, request, 'login');
          await incrementDailyStat(db, 'user_logins');
          return json({ success: true, user: { id: user.id, username, role: user.role, storageUsage: user.storage_usage || 0 } }, 200, { 'Set-Cookie': `session_id=${sessionId}; Expires=${new Date(expiresAt).toUTCString()}; Path=/; SameSite=Lax; HttpOnly` });
      }

      if (path === '/api/auth/logout' && method === 'POST') {
          const cookies = parseCookies(request);
          if (cookies['session_id']) await db.prepare('DELETE FROM sessions WHERE id = ?').bind(cookies['session_id']).run();
          return json({ success: true }, 200, { 'Set-Cookie': `session_id=; Max-Age=0; Path=/; SameSite=Lax; HttpOnly` });
      }

      if (path === '/api/auth/me' && method === 'GET') {
          const user = await getSessionUser();
          if (!user) return error('Unauthorized', 401);
          return json({ id: user.id, username: user.username, role: user.role, storageUsage: user.storage_usage || 0 });
      }

      // --- Authenticated Logic ---
      const currentUser = await getSessionUser();
      if (!currentUser) return error('Unauthorized', 401);

      // --- ADMIN: Global Settings (Benchmark Config) ---
      if (path === '/api/config/benchmarks' && method === 'PUT') {
          if (currentUser.role !== 'admin') return error('Forbidden', 403);
          const { config } = await request.json() as any;
          await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('benchmark_config', JSON.stringify(config)).run();
          return json({ success: true });
      }

      // --- ADMIN: Import GitHub Artist (Stream to R2) ---
      if (path === '/api/admin/import-github' && method === 'POST') {
          if (currentUser.role !== 'admin') return error('Forbidden', 403);
          if (!env.BUCKET) return error('R2 Bucket not configured', 503);

          const { name, url: githubUrl } = await request.json() as any;
          if (!name || !githubUrl) return error('Missing name or url', 400);

          const ghRes = await fetch(githubUrl);
          if (!ghRes.ok) return error(`Failed to fetch from GitHub: ${ghRes.statusText}`, 502);

          const contentType = ghRes.headers.get('content-type') || 'image/png';
          const ext = contentType.split('/')[1] || 'png';
          const id = crypto.randomUUID(); 
          const filename = `artists/${id}_gh.${ext}`;

          await env.BUCKET.put(filename, ghRes.body, {
              httpMetadata: { contentType }
          });

          const r2Url = `/api/assets/${filename}`;
          const existing = await db.prepare('SELECT id FROM artists WHERE name = ?').bind(name).first<{id: string}>();
          
          if (existing) {
              await db.prepare('UPDATE artists SET image_url = ? WHERE id = ?').bind(r2Url, existing.id).run();
          } else {
              await db.prepare('INSERT INTO artists (id, name, image_url) VALUES (?, ?, ?)').bind(id, name, r2Url).run();
          }

          return json({ success: true, id: existing?.id || id, imageUrl: r2Url });
      }

      // --- Admin Guest Setting ---
      if (path === '/api/admin/guest-setting' && method === 'GET') {
          if (currentUser.role !== 'admin') return error('Forbidden', 403);
          let guest = await db.prepare('SELECT password FROM users WHERE role = ?').bind('guest').first<{password: string}>();
          if (!guest) { await initDB(); guest = await db.prepare('SELECT password FROM users WHERE role = ?').bind('guest').first<{password: string}>(); }
          return json({ passcode: guest?.password });
      }
      if (path === '/api/admin/guest-setting' && method === 'PUT') {
          if (currentUser.role !== 'admin') return error('Forbidden', 403);
          const { passcode } = await request.json() as any;
          await db.prepare('UPDATE users SET password = ? WHERE role = ?').bind(passcode, 'guest').run();
          return json({ success: true });
      }

      // --- ADMIN: Usage Statistics ---
      if (path === '/api/admin/stats' && method === 'GET') {
          if (currentUser.role !== 'admin') return error('Forbidden', 403);
          
          // 近 30 天的每日统计
          const dailyStatsResult = await db.prepare(`
              SELECT * FROM daily_stats 
              WHERE date >= date('now', '-30 days')
              ORDER BY date DESC
          `).all();
          
          // 最近 50 条登录日志
          const recentLogsResult = await db.prepare(`
              SELECT * FROM access_logs 
              ORDER BY created_at DESC 
              LIMIT 50
          `).all();
          
          // 存储统计
          const userStorageStats = await db.prepare(`
              SELECT SUM(storage_usage) as total_storage, COUNT(*) as user_count 
              FROM users WHERE role != 'guest'
          `).first<{total_storage: number, user_count: number}>();
          
          const chainsCount = await db.prepare('SELECT COUNT(*) as count FROM chains').first<{count: number}>();
          const inspirationsCount = await db.prepare('SELECT COUNT(*) as count FROM inspirations').first<{count: number}>();
          const artistsCount = await db.prepare('SELECT COUNT(*) as count FROM artists').first<{count: number}>();
          
          return json({
              dailyStats: dailyStatsResult.results.map((s: any) => ({
                  date: s.date,
                  totalRequests: s.total_requests || 0,
                  apiRequests: s.api_requests || 0,
                  guestLogins: s.guest_logins || 0,
                  userLogins: s.user_logins || 0,
                  generateRequests: s.generate_requests || 0
              })),
              recentLogs: recentLogsResult.results.map((l: any) => ({
                  id: l.id,
                  userId: l.user_id,
                  username: l.username,
                  role: l.role,
                  ip: l.ip,
                  userAgent: l.user_agent,
                  action: l.action,
                  createdAt: l.created_at
              })),
              storage: {
                  totalUserStorage: userStorageStats?.total_storage || 0,
                  userCount: userStorageStats?.user_count || 0,
                  chainsCount: chainsCount?.count || 0,
                  inspirationsCount: inspirationsCount?.count || 0,
                  artistsCount: artistsCount?.count || 0
              }
          });
      }

      // --- ADMIN: Clear Old Logs ---
      if (path === '/api/admin/clear-logs' && method === 'POST') {
          if (currentUser.role !== 'admin') return error('Forbidden', 403);
          const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
          await db.prepare('DELETE FROM access_logs WHERE created_at < ?').bind(thirtyDaysAgo).run();
          return json({ success: true });
      }

      // --- NAI Proxy ---
      if (path === '/api/generate' && method === 'POST') {
        const body = await request.json();
        const clientAuth = request.headers.get('Authorization'); 
        if (!clientAuth) return error('Missing API Key', 401);
        const naiRes = await fetch("https://image.novelai.net/ai/generate-image", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": clientAuth }, body: JSON.stringify(body) });
        if (!naiRes.ok) return error(await naiRes.text(), naiRes.status);
        const blob = await naiRes.blob();
        return new Response(blob, { headers: { ...corsHeaders, 'Content-Type': 'application/zip' } });
      }

      // --- File Upload ---
      if (path === '/api/upload' && method === 'POST') {
          if (!env.BUCKET) return error('R2 Bucket not configured', 503);
          if (currentUser.role === 'guest') return error('Guests cannot upload files', 403);
          const formData = await request.formData();
          const file = formData.get('file');
          if (!file || !(file instanceof File)) return error('Invalid file', 400);
          const folder = formData.get('folder') as string || 'misc';
          const ext = file.name.split('.').pop() || 'png';
          const filename = `${folder}/${currentUser.id}_${Date.now()}.${ext}`;
          const fileSize = file.size;
          if (currentUser.role !== 'admin') {
              const currentUsage = currentUser.storage_usage || 0;
              if (currentUsage + fileSize > MAX_STORAGE_QUOTA) return error(`Storage quota exceeded`, 413);
          }
          await env.BUCKET.put(filename, file.stream(), { httpMetadata: { contentType: file.type } });
          await db.prepare('UPDATE users SET storage_usage = COALESCE(storage_usage, 0) + ? WHERE id = ?').bind(fileSize, currentUser.id).run();
          return json({ url: `/api/assets/${filename}`, size: fileSize });
      }

      // --- CRUD Routes ---
      if (path === '/api/users' && method === 'POST') {
          if (currentUser.role !== 'admin') return error('Forbidden', 403);
          const { username, password } = await request.json() as any;
          const hashedPassword = await bcrypt.hash(password, 10);
          try { await db.prepare('INSERT INTO users (id, username, password, role, created_at, storage_usage) VALUES (?, ?, ?, ?, ?, 0)').bind(crypto.randomUUID(), username, hashedPassword, 'user', Date.now()).run(); return json({ success: true }); } catch(e) { return error('Username exists', 409); }
      }
      if (path === '/api/users/password' && method === 'PUT') {
          const { password } = await request.json() as any;
          const hashedPassword = await bcrypt.hash(password, 10);
          await db.prepare('UPDATE users SET password = ? WHERE id = ?').bind(hashedPassword, currentUser.id).run();
          return json({ success: true });
      }
      if (path === '/api/users' && method === 'GET') {
         if (currentUser.role !== 'admin') return error('Forbidden', 403);
         const res = await db.prepare('SELECT id, username, role, created_at, storage_usage FROM users ORDER BY created_at DESC').all();
         return json(res.results);
      }
      if (path.startsWith('/api/users/') && method === 'DELETE') {
         if (currentUser.role !== 'admin') return error('Forbidden', 403);
         const id = path.split('/').pop();
         if (id === currentUser.id) return error('Cannot delete self', 400);
         await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
         return json({ success: true });
      }

      // Chains
      if (path === '/api/chains' && method === 'GET') {
        const chainsResult = await db.prepare('SELECT * FROM chains ORDER BY updated_at DESC').all();
        const data = chainsResult.results.map((c: any) => ({
          id: c.id, userId: c.user_id, username: c.username, type: c.type || 'style', name: c.name, description: c.description,
          tags: JSON.parse(c.tags || '[]'), previewImage: c.preview_image, base_prompt: c.base_prompt, // raw DB column needed? No, mapping below
          basePrompt: c.base_prompt,
          negativePrompt: c.negative_prompt, modules: JSON.parse(c.modules || '[]'), params: JSON.parse(c.params || '{}'),
          variableValues: JSON.parse(c.variable_values || '{}'), createdAt: c.created_at, updatedAt: c.updated_at
        }));
        return json(data);
      }
      if (path === '/api/chains' && method === 'POST') {
        if (currentUser.role === 'guest') return error('Forbidden', 403);
        const body = await request.json() as any;
        const id = crypto.randomUUID();
        const type = body.type || 'style'; // Default to style
        // Sanitize and validate tags
        let tags = '[]';
        if (Array.isArray(body.tags)) {
          const sanitizedTags = body.tags
            .map(tag => typeof tag === 'string' ? tag.trim().substring(0, 50) : '')
            .filter(tag => tag.length > 0);
          tags = JSON.stringify(sanitizedTags);
        }
        await db.prepare(`INSERT INTO chains (id, user_id, username, type, name, description, tags, preview_image, base_prompt, negative_prompt, modules, params, variable_values, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, currentUser.id, currentUser.username, type, body.name, body.description, tags, null, body.basePrompt || '', body.negativePrompt || '', body.modules ? JSON.stringify(body.modules) : '[]', body.params ? JSON.stringify(body.params) : '{}', body.variableValues ? JSON.stringify(body.variableValues) : '{}', Date.now(), Date.now()).run();
        return json({ id });
      }
      const chainIdMatch = path.match(/^\/api\/chains\/([^\/]+)$/);
      if (chainIdMatch && method === 'PUT') {
        if (currentUser.role === 'guest') return error('Forbidden', 403);
        const id = chainIdMatch[1];
        const updates = await request.json() as any;
        const chain = await db.prepare('SELECT user_id, preview_image FROM chains WHERE id = ?').bind(id).first<{user_id: string, preview_image: string}>();
        if (!chain) return error('Not Found', 404);
        if (chain.user_id && chain.user_id !== currentUser.id && currentUser.role !== 'admin') return error('Permission Denied', 403);
        
        // Handle Chain Cover Cleanup
        if (updates.previewImage && updates.previewImage.startsWith('data:')) {
             try { 
                 const newUrl = await processImageUpload(env, updates.previewImage, 'covers', id, currentUser);
                 // Delete old cover if exists and different
                 if (chain.preview_image && chain.preview_image !== newUrl) {
                     await deleteR2File(env, chain.preview_image);
                 }
                 updates.previewImage = newUrl;
             } catch (e: any) { return error(e.message, 413); }
        }

        const fields = []; const values = [];
        if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
        if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
        if (updates.previewImage !== undefined) { fields.push('preview_image = ?'); values.push(updates.previewImage); }
        if (updates.basePrompt !== undefined) { fields.push('base_prompt = ?'); values.push(updates.basePrompt); }
        if (updates.negativePrompt !== undefined) { fields.push('negative_prompt = ?'); values.push(updates.negativePrompt); }
        if (updates.modules !== undefined) { fields.push('modules = ?'); values.push(JSON.stringify(updates.modules)); }
        if (updates.params !== undefined) { fields.push('params = ?'); values.push(JSON.stringify(updates.params)); }
        if (updates.variableValues !== undefined) { fields.push('variable_values = ?'); values.push(JSON.stringify(updates.variableValues)); }
        if (updates.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(updates.tags)); }
        if (fields.length > 0) { fields.push('updated_at = ?'); values.push(Date.now()); values.push(id); await db.prepare(`UPDATE chains SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run(); }
        return json({ success: true });
      }
      if (chainIdMatch && method === 'DELETE') {
        if (currentUser.role === 'guest') return error('Forbidden', 403);
        const id = chainIdMatch[1];
        const chain = await db.prepare('SELECT user_id, preview_image FROM chains WHERE id = ?').bind(id).first<{user_id: string, preview_image: string}>();
        if (chain) {
            if (chain.user_id && chain.user_id !== currentUser.id && currentUser.role !== 'admin') return error('Permission Denied', 403);
            // Delete Cover
            if (chain.preview_image) await deleteR2File(env, chain.preview_image);
            await db.prepare('DELETE FROM chains WHERE id = ?').bind(id).run();
        }
        return json({ success: true });
      }

      // Artists (Updated with Deletion Logic)
      if (path === '/api/artists' && method === 'GET') {
         const res = await db.prepare('SELECT * FROM artists ORDER BY name ASC').all();
         return json(res.results.map((a: any) => ({ id: a.id, name: a.name, imageUrl: a.image_url, previewUrl: a.preview_url, benchmarks: a.benchmarks ? JSON.parse(a.benchmarks) : [] })));
      }
      if (path === '/api/artists' && method === 'POST') {
        if (currentUser.role !== 'admin') return error('Forbidden', 403);
        const body = await request.json() as any;
        const id = body.id || crypto.randomUUID();
        
        // Fetch existing artist to compare for deletions
        const existing = await db.prepare('SELECT benchmarks, preview_url, image_url FROM artists WHERE id = ?').bind(id).first<{benchmarks: string, preview_url: string, image_url: string}>();
        const oldBenchmarks = existing && existing.benchmarks ? JSON.parse(existing.benchmarks) : [];

        let imageUrl = body.imageUrl;
        if (imageUrl && imageUrl.startsWith('data:')) {
            imageUrl = await processImageUpload(env, imageUrl, 'artists', id);
            // Delete old avatar if changed
            if (existing && existing.image_url && existing.image_url !== imageUrl) {
                await deleteR2File(env, existing.image_url);
            }
        }

        let benchmarks = body.benchmarks || [];
        if (Array.isArray(benchmarks)) {
            for (let i = 0; i < benchmarks.length; i++) {
                if (benchmarks[i] && benchmarks[i].startsWith('data:')) {
                    // Upload new file
                    const newUrl = await processImageUpload(env, benchmarks[i], `artists/benchmarks_${i}`, id);
                    benchmarks[i] = newUrl;
                    
                    // Check and delete old file at this index
                    const oldUrl = oldBenchmarks[i];
                    if (oldUrl && oldUrl !== newUrl) {
                        await deleteR2File(env, oldUrl);
                    }
                }
            }
        }
        
        await db.prepare(`INSERT INTO artists (id, name, image_url, benchmarks, preview_url) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, image_url = excluded.image_url, benchmarks = excluded.benchmarks`).bind(id, body.name, imageUrl, JSON.stringify(benchmarks), body.previewUrl).run();
        return json({ success: true, benchmarks });
      }
      if (path.startsWith('/api/artists/') && method === 'DELETE') {
        if (currentUser.role !== 'admin') return error('Forbidden', 403);
        const id = path.split('/').pop();
        const artist = await db.prepare('SELECT benchmarks, preview_url, image_url FROM artists WHERE id = ?').bind(id).first<{benchmarks: string, preview_url: string, image_url: string}>();
        if (artist) {
            // Delete all associated files
            await deleteR2File(env, artist.image_url);
            if (artist.preview_url) await deleteR2File(env, artist.preview_url);
            if (artist.benchmarks) {
                const bms = JSON.parse(artist.benchmarks);
                for (const url of bms) {
                    if (url) await deleteR2File(env, url);
                }
            }
        }
        await db.prepare('DELETE FROM artists WHERE id = ?').bind(id).run();
        return json({ success: true });
      }

      // Inspirations
      if (path === '/api/inspirations' && method === 'GET') {
        const res = await db.prepare('SELECT * FROM inspirations ORDER BY created_at DESC').all();
        return json(res.results.map((i: any) => ({ id: i.id, userId: i.user_id, username: i.username, title: i.title, imageUrl: i.image_url, prompt: i.prompt, createdAt: i.created_at })));
      }
      if (path === '/api/inspirations' && method === 'POST') {
        if (currentUser.role === 'guest') return error('Forbidden', 403);
        const body = await request.json() as any;
        let imageUrl = body.imageUrl;
        if (imageUrl && imageUrl.startsWith('data:')) { try { imageUrl = await processImageUpload(env, imageUrl, 'inspirations', body.id || crypto.randomUUID(), currentUser); } catch (e: any) { return error(e.message, 413); } }
        await db.prepare('INSERT OR REPLACE INTO inspirations (id, user_id, username, title, image_url, prompt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(body.id, currentUser.id, currentUser.username, body.title, imageUrl, body.prompt, body.createdAt).run();
        return json({ success: true });
      }
      if (path === '/api/inspirations/bulk-delete' && method === 'POST') {
          if (currentUser.role === 'guest') return error('Forbidden', 403);
          const { ids } = await request.json() as { ids: string[] };
          for (const id of ids) {
              const item = await db.prepare('SELECT user_id, image_url FROM inspirations WHERE id = ?').bind(id).first<{user_id: string, image_url: string}>();
              if (item) {
                  if (currentUser.role !== 'admin' && item.user_id !== currentUser.id) continue;
                  await deleteR2File(env, item.image_url);
                  await db.prepare('DELETE FROM inspirations WHERE id = ?').bind(id).run();
              }
          }
          return json({ success: true });
      }
      if (path.startsWith('/api/inspirations/') && method === 'PUT') {
         if (currentUser.role === 'guest') return error('Forbidden', 403);
         const id = path.split('/').pop();
         const updates = await request.json() as any;
         const item = await db.prepare('SELECT user_id FROM inspirations WHERE id = ?').bind(id).first<{user_id: string}>();
         if (!item) return error('Not Found', 404);
         if (item.user_id !== currentUser.id && currentUser.role !== 'admin') return error('Permission Denied', 403);
         if (updates.title) await db.prepare('UPDATE inspirations SET title = ? WHERE id = ?').bind(updates.title, id).run();
         if (updates.prompt) await db.prepare('UPDATE inspirations SET prompt = ? WHERE id = ?').bind(updates.prompt, id).run();
         return json({ success: true });
      }
      if (path.startsWith('/api/inspirations/') && method === 'DELETE') {
         if (currentUser.role === 'guest') return error('Forbidden', 403);
         const id = path.split('/').pop();
         const item = await db.prepare('SELECT user_id, image_url FROM inspirations WHERE id = ?').bind(id).first<{user_id: string, image_url: string}>();
         if (item) {
             if (item.user_id !== currentUser.id && currentUser.role !== 'admin') return error('Permission Denied', 403);
             await deleteR2File(env, item.image_url);
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
