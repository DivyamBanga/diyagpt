// DiyaGPT API: auth, lockouts, chat storage, Azure proxy, activity log and admin controls.
// Secrets (wrangler secret put): AZURE_BASE, AZURE_KEY, PEPPER.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const USER_SESSION_MS = 30 * DAY; // sliding
const ADMIN_SESSION_MS = 12 * HOUR; // fixed

// Login protection. Attempts are counted per IP (IPv6 grouped by /64) and reset on success.
const LOCK = {
  user: { tries: 5, window: 15 * MIN, dayMax: 10, global: 30 },
  admin: { tries: 5, window: 15 * MIN, dayMax: 8, global: 15 },
};

const MODES = { instant: 'none', thinking: 'medium', deep: 'high' };

const DEFAULT_PROMPT = `You are DiyaGPT, a warm, brilliant and genuinely helpful AI assistant.
You can see images and read documents the user attaches. When a web_search tool is available, use it for anything current, factual and checkable (news, prices, schedules, recent events) and cite sources. When a code_interpreter tool is available, use Python for calculations, data analysis, charts and file conversions; save any file you create to /mnt/data and link to it.
Write naturally and match the user's tone. Use Markdown (headings, lists, tables, fenced code blocks with a language) when it makes things clearer, and keep simple answers short. Write math in LaTeX using \\( ... \\) for inline math and \\[ ... \\] for display math (never single dollar signs, which are reserved for money).`;

const DEFAULT_CONFIG = {
  chat_enabled: true,
  login_enabled: true,
  uploads_enabled: true,
  web_enabled: true,
  code_enabled: true,
  pause_message: 'DiyaGPT is taking a short break. Please check back soon.',
  announcement: '',
  model: 'gpt-5.6-luna',
  max_output_tokens: 0,
  daily_message_limit: 0,
  daily_token_limit: 0,
  system_prompt: DEFAULT_PROMPT,
  price_in: 1.25,
  price_out: 10,
  timezone: 'America/Toronto',
  ntfy_topic: '',
  notify_login: true,
  notify_failed: true,
  notify_lockout: true,
  notify_limit: true,
  notify_error: false,
  notify_admin: true,
  user_global_lock_until: 0,
  admin_global_lock_until: 0,
};

const CONFIG_TYPES = {
  chat_enabled: 'bool', login_enabled: 'bool', uploads_enabled: 'bool', web_enabled: 'bool', code_enabled: 'bool',
  pause_message: 'str:300', announcement: 'str:500', model: 'model', system_prompt: 'str:12000',
  max_output_tokens: 'int:0:128000', daily_message_limit: 'int:0:100000', daily_token_limit: 'int:0:1000000000',
  price_in: 'num:0:1000', price_out: 'num:0:1000', timezone: 'tz', ntfy_topic: 'topic',
  notify_login: 'bool', notify_failed: 'bool', notify_lockout: 'bool', notify_limit: 'bool', notify_error: 'bool', notify_admin: 'bool',
  user_global_lock_until: 'int:0:9999999999999', admin_global_lock_until: 'int:0:9999999999999',
};

const DEFAULT_PREFS = { name: 'Diya', about: '', style: '', mode: 'thinking', web: true, code: true, theme: 'system', enter_send: true, font: 'md' };
const PREF_TYPES = {
  name: 'str:60', about: 'str:3000', style: 'str:3000', mode: 'mode', web: 'bool', code: 'bool',
  theme: 'enum:system,light,dark', enter_send: 'bool', font: 'enum:sm,md,lg',
};

const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const FILE_RE = /^assistant-[A-Za-z0-9]{6,64}$/;
const CNTR_RE = /^cntr_[A-Za-z0-9]{6,100}$/;
const CFILE_RE = /^cfile_[A-Za-z0-9]{6,100}$/;
const MAX_UPLOAD = 50 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, error, message, extra) {
    super(message || error);
    this.status = status;
    this.body = { error, message: message || error, ...extra };
  }
}

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin');
    const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
    if (origin && !allowed.includes(origin)) return new Response('Forbidden', { status: 403 });
    const corsHeaders = origin
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        }
      : {};
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

    let res;
    try {
      res = await route(req, env, ctx);
    } catch (e) {
      if (e instanceof HttpError) res = json(e.body, e.status);
      else {
        console.error(e);
        res = json({ error: 'server', message: 'Something went wrong. Please try again.' }, 500);
      }
    }
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
    return new Response(res.body, { status: res.status, headers });
  },

  async scheduled(_event, env) {
    const now = Date.now();
    // Uploads attached to a chat that was never sent. Capped to stay under the subrequest limit.
    const { results } = await env.DB.prepare('SELECT id FROM files WHERE created_at < ? AND chat_id NOT IN (SELECT id FROM chats) LIMIT 40').bind(now - DAY).all();
    await deleteFiles(env, results.map((r) => r.id));
    await env.DB.batch([
      ...results.map((r) => env.DB.prepare('DELETE FROM files WHERE id = ?').bind(r.id)),
      env.DB.prepare('DELETE FROM attempts WHERE ts < ?').bind(now - 30 * DAY),
      env.DB.prepare('DELETE FROM events WHERE ts < ?').bind(now - 180 * DAY),
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ? OR (revoked = 1 AND last_seen < ?)').bind(now - 30 * DAY, now - 30 * DAY),
    ]);
  },
};

async function route(req, env, ctx) {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, '');
  const m = req.method;

  // Public
  if (p === '/api/status' && m === 'GET') return status(req, env, url.searchParams.get('scope') === 'admin' ? 'admin' : 'user');
  if (p === '/api/login' && m === 'POST') return login(req, env, ctx, 'user');
  if (p === '/api/admin/login' && m === 'POST') return login(req, env, ctx, 'admin');

  // Admin
  if (p.startsWith('/api/admin/')) {
    const s = await auth(req, env, ctx, 'admin');
    return adminRoute(req, env, ctx, s, p.slice('/api/admin'.length), m, url);
  }

  // User
  if (!p.startsWith('/api/')) throw new HttpError(404, 'not_found');
  const s = await auth(req, env, ctx, 'user');
  const seg = p.split('/').slice(2); // ['chats', id, ...]

  if (p === '/api/logout' && m === 'POST') return logout(env, s);
  if (p === '/api/me' && m === 'GET') return me(env, s);
  if (p === '/api/prefs' && m === 'PUT') return savePrefs(req, env);
  if (p === '/api/respond' && m === 'POST') return respond(req, env, ctx);
  if (p === '/api/title' && m === 'POST') return makeTitle(req, env, ctx);
  if (p === '/api/search' && m === 'GET') return search(env, url.searchParams.get('q') || '');
  if (p === '/api/files' && m === 'POST') return uploadFile(req, env, url);
  if (seg[0] === 'files' && seg[1] && m === 'GET') return fileContent(env, seg[1]);
  if (p === '/api/container-file' && m === 'POST') return persistContainerFile(req, env);
  if (p === '/api/sessions' && m === 'GET') return listSessions(env, 'user', s.id);
  if (seg[0] === 'sessions' && seg[1] && m === 'DELETE') return revokeSession(env, seg[1], 'user');
  if (p === '/api/chats' && m === 'GET') return listChats(env);
  if (p === '/api/chats' && m === 'DELETE') return deleteAllChats(env, ctx);
  if (seg[0] === 'chats' && seg[1] && seg.length === 2) {
    if (m === 'GET') return getChat(env, seg[1]);
    if (m === 'PATCH') return patchChat(req, env, seg[1]);
    if (m === 'DELETE') return deleteChat(env, ctx, seg[1]);
  }
  if (seg[0] === 'messages' && seg[1] && m === 'PUT') return putMessage(req, env, seg[1]);
  throw new HttpError(404, 'not_found');
}

async function adminRoute(req, env, ctx, s, p, m, url) {
  if (p === '/logout' && m === 'POST') return logout(env, s);
  if (p === '/overview' && m === 'GET') return adminOverview(env, s);
  if (p === '/events' && m === 'GET') return adminEvents(env, url);
  if (p === '/events/seen' && m === 'POST') {
    await env.DB.prepare('UPDATE events SET seen = 1 WHERE seen = 0').run();
    return json({ ok: true });
  }
  if (p === '/config' && m === 'PUT') return adminConfig(req, env, ctx);
  if (p === '/password' && m === 'POST') return adminPassword(req, env, ctx, s);
  if (p === '/unlock' && m === 'POST') return adminUnlock(env, ctx);
  if (p === '/notify-test' && m === 'POST') return adminNotifyTest(env);
  if (p === '/revoke-all' && m === 'POST') {
    const { role } = await readJson(req);
    const r = await env.DB.prepare("UPDATE sessions SET revoked = 1 WHERE revoked = 0 AND role = 'user'").run();
    if (role === 'all') await env.DB.prepare('UPDATE sessions SET revoked = 1 WHERE revoked = 0 AND role = ? AND id != ?').bind('admin', s.id).run();
    const cfg = await getConfig(env);
    await logEvent(env, ctx, cfg, 'sessions_revoked', 'warn', `Admin signed out ${r.meta.changes} device${r.meta.changes === 1 ? '' : 's'}`, null, null);
    return json({ ok: true, revoked: r.meta.changes });
  }
  const seg = p.split('/').slice(1);
  if (seg[0] === 'sessions' && seg[1] && m === 'DELETE') return revokeSession(env, seg[1], null);
  throw new HttpError(404, 'not_found');
}

// ---------- helpers ----------

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

async function readJson(req, max = 1_000_000) {
  const len = Number(req.headers.get('Content-Length') || 0);
  if (len > max) throw new HttpError(413, 'too_large', 'That request is too large.');
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, 'too_large', 'That request is too large.');
  try {
    const v = JSON.parse(text || '{}');
    if (!v || typeof v !== 'object') throw 0;
    return v;
  } catch {
    throw new HttpError(400, 'bad_json');
  }
}

const enc = new TextEncoder();

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256hex(s) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(env, salt, password) {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.PEPPER), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${salt}\u0000${password}`)));
  return b64url(sig);
}

async function verifyPassword(env, scope, password) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(`${scope}_pw`).first();
  if (!row) return false;
  const { salt, hash } = JSON.parse(row.value);
  const got = enc.encode(await hashPassword(env, salt, password));
  const want = enc.encode(hash);
  return got.byteLength === want.byteLength && crypto.subtle.timingSafeEqual(got, want);
}

async function setPassword(env, scope, password) {
  const salt = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await hashPassword(env, salt, password);
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(`${scope}_pw`, JSON.stringify({ salt, hash }))
    .run();
}

function ipKey(req) {
  const ip = req.headers.get('CF-Connecting-IP') || '0.0.0.0';
  if (!ip.includes(':')) return ip;
  // Group IPv6 by /64 so rotating addresses inside one network doesn't reset the counter.
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const full = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return `${full.slice(0, 4).map((x) => x.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

function deviceName(ua = '') {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /CrOS/.test(ua) ? 'ChromeOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Unknown device';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}

function locationOf(req) {
  const cf = req.cf || {};
  return [cf.city, cf.region, cf.country].filter(Boolean).join(', ') || 'Unknown location';
}

function dayOf(ts, tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ts);
  } catch {
    return new Date(ts).toISOString().slice(0, 10);
  }
}

function validTz(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function coerce(type, v) {
  const [kind, a, b] = type.split(':');
  switch (kind) {
    case 'bool': return typeof v === 'boolean' ? v : undefined;
    case 'str': return typeof v === 'string' ? v.slice(0, Number(a)) : undefined;
    case 'int': {
      const n = Math.round(Number(v));
      return Number.isFinite(n) ? Math.min(Number(b), Math.max(Number(a), n)) : undefined;
    }
    case 'num': {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(Number(b), Math.max(Number(a), n)) : undefined;
    }
    case 'enum': return a.split(',').includes(v) ? v : undefined;
    case 'mode': return v in MODES ? v : undefined;
    case 'model': return typeof v === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(v) ? v : undefined;
    case 'tz': return typeof v === 'string' && validTz(v) ? v : undefined;
    case 'topic': return typeof v === 'string' && /^[A-Za-z0-9_-]{0,64}$/.test(v) ? v : undefined;
  }
}

async function getSetting(env, key, defaults) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return { ...defaults, ...(row ? JSON.parse(row.value) : {}) };
}
const getConfig = (env) => getSetting(env, 'config', DEFAULT_CONFIG);
const getPrefs = (env) => getSetting(env, 'prefs', DEFAULT_PREFS);

async function putSetting(env, key, value) {
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, JSON.stringify(value))
    .run();
}

async function updateConfig(env, patch) {
  const cfg = await getConfig(env);
  Object.assign(cfg, patch);
  await putSetting(env, 'config', cfg);
  return cfg;
}

async function logEvent(env, ctx, cfg, type, level, message, meta, notifyKey) {
  await env.DB.prepare('INSERT INTO events (ts, type, level, message, meta) VALUES (?, ?, ?, ?, ?)')
    .bind(Date.now(), type, level, message, meta ? JSON.stringify(meta) : null)
    .run();
  if (notifyKey && cfg[notifyKey] && cfg.ntfy_topic) ctx.waitUntil(notify(cfg.ntfy_topic, message, level));
}

function notify(topic, message, level) {
  return fetch(`https://ntfy.sh/${topic}`, {
    method: 'POST',
    headers: {
      Title: 'DiyaGPT',
      Priority: level === 'alert' ? 'high' : 'default',
      Tags: level === 'alert' ? 'rotating_light' : level === 'warn' ? 'warning' : 'candle',
    },
    body: message,
  }).catch(() => {});
}

function azure(env, path, init = {}) {
  return fetch(`${env.AZURE_BASE}${path}`, { ...init, headers: { 'api-key': env.AZURE_KEY, ...(init.headers || {}) } });
}

// ---------- auth ----------

async function lockState(env, scope, ip) {
  const L = LOCK[scope];
  const now = Date.now();
  const { results } = await env.DB.prepare(
    `SELECT ts FROM attempts WHERE scope = ?1 AND ip = ?2 AND ok = 0 AND ts > ?3
       AND ts > COALESCE((SELECT MAX(ts) FROM attempts WHERE scope = ?1 AND ip = ?2 AND ok = 1), 0)
     ORDER BY ts DESC LIMIT 20`,
  ).bind(scope, ip, now - DAY).all();
  const fails = results.map((r) => r.ts);
  const recent = fails.filter((ts) => ts > now - L.window);
  let until = 0;
  if (fails.length >= L.dayMax) until = fails[L.dayMax - 1] + DAY;
  else if (recent.length >= L.tries) until = recent[L.tries - 1] + L.window;
  return { until: until > now ? until : 0, remaining: Math.max(0, L.tries - recent.length) };
}

async function status(req, env, scope) {
  const cfg = await getConfig(env);
  const now = Date.now();
  const st = await lockState(env, scope, ipKey(req));
  const globalUntil = cfg[`${scope}_global_lock_until`] > now ? cfg[`${scope}_global_lock_until`] : 0;
  return json({
    login_enabled: scope === 'admin' || cfg.login_enabled,
    remaining: st.remaining,
    max: LOCK[scope].tries,
    locked_until: Math.max(st.until, globalUntil),
  });
}

async function login(req, env, ctx, scope) {
  const now = Date.now();
  const ip = ipKey(req);
  const body = await readJson(req, 10_000);
  const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
  const cfg = await getConfig(env);
  const label = scope === 'admin' ? 'Admin' : 'DiyaGPT';

  if (scope === 'user' && !cfg.login_enabled) throw new HttpError(403, 'disabled', 'Sign-in is turned off right now.');
  const globalUntil = cfg[`${scope}_global_lock_until`];
  if (globalUntil > now) throw new HttpError(429, 'locked', 'Sign-in is temporarily locked.', { locked_until: globalUntil, remaining: 0 });
  const before = await lockState(env, scope, ip);
  if (before.until) throw new HttpError(429, 'locked', 'Too many attempts.', { locked_until: before.until, remaining: 0 });

  const ok = password.length > 0 && (await verifyPassword(env, scope, password));
  await env.DB.prepare('INSERT INTO attempts (scope, ip, ts, ok) VALUES (?, ?, ?, ?)').bind(scope, ip, now, ok ? 1 : 0).run();
  const device = deviceName(req.headers.get('User-Agent') || '');
  const where = locationOf(req);
  const meta = { ip, device, location: where };

  if (!ok) {
    const after = await lockState(env, scope, ip);
    await logEvent(env, ctx, cfg, `${scope}_login_failed`, 'warn', `Wrong ${label} password from ${device} · ${where}`, meta, 'notify_failed');
    if (after.until) {
      const mins = Math.round((after.until - now) / MIN);
      await logEvent(env, ctx, cfg, 'lockout', 'alert', `${label} sign-in locked for ${mins >= 120 ? `${Math.round(mins / 60)} hours` : `${mins} minutes`} after repeated wrong passwords (${device} · ${where})`, meta, 'notify_lockout');
    }
    const g = await env.DB.prepare('SELECT COUNT(*) AS n FROM attempts WHERE scope = ? AND ok = 0 AND ts > ?').bind(scope, now - HOUR).first();
    if (g.n >= LOCK[scope].global && !(cfg[`${scope}_global_lock_until`] > now)) {
      const until = now + HOUR;
      await updateConfig(env, { [`${scope}_global_lock_until`]: until });
      await logEvent(env, ctx, cfg, 'global_lockout', 'alert', `${label} sign-in locked for everyone for 1 hour: ${g.n} wrong passwords in the last hour. Unlock it from the admin panel if this was you.`, null, 'notify_lockout');
      throw new HttpError(429, 'locked', 'Sign-in is temporarily locked.', { locked_until: until, remaining: 0 });
    }
    if (after.until) throw new HttpError(429, 'locked', 'Too many attempts.', { locked_until: after.until, remaining: 0 });
    throw new HttpError(401, 'invalid', 'That password isn’t right.', { remaining: after.remaining });
  }

  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const id = await sha256hex(token);
  const expires = now + (scope === 'admin' ? ADMIN_SESSION_MS : USER_SESSION_MS);
  await env.DB.prepare('INSERT INTO sessions (id, role, created_at, last_seen, expires_at, ip, location, device) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, scope, now, now, expires, ip, where, device)
    .run();
  await logEvent(env, ctx, cfg, `${scope}_login`, scope === 'admin' ? 'warn' : 'info', `${label} sign-in: ${device} · ${where}`, meta, scope === 'admin' ? 'notify_admin' : 'notify_login');
  return json({ token, role: scope });
}

async function auth(req, env, ctx, role) {
  const m = /^Bearer ([A-Za-z0-9_-]{30,100})$/.exec(req.headers.get('Authorization') || '');
  if (!m) throw new HttpError(401, 'auth', 'Please sign in.');
  const id = await sha256hex(m[1]);
  const s = await env.DB.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first();
  const now = Date.now();
  if (!s || s.revoked || s.expires_at < now || s.role !== role) throw new HttpError(401, 'auth', 'Please sign in.');
  if (now - s.last_seen > 5 * MIN) {
    const expires = role === 'user' ? now + USER_SESSION_MS : s.expires_at;
    ctx.waitUntil(env.DB.prepare('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id = ?').bind(now, expires, id).run());
  }
  return s;
}

async function logout(env, s) {
  await env.DB.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').bind(s.id).run();
  return json({ ok: true });
}

async function listSessions(env, role, currentId) {
  const q = role
    ? env.DB.prepare('SELECT id, role, created_at, last_seen, location, device FROM sessions WHERE revoked = 0 AND expires_at > ? AND role = ? ORDER BY last_seen DESC').bind(Date.now(), role)
    : env.DB.prepare('SELECT id, role, created_at, last_seen, location, device FROM sessions WHERE revoked = 0 AND expires_at > ? ORDER BY last_seen DESC').bind(Date.now());
  const { results } = await q.all();
  return json({ sessions: results.map((r) => ({ ...r, id: r.id.slice(0, 16), current: r.id === currentId })) });
}

async function revokeSession(env, shortId, role) {
  if (!/^[0-9a-f]{16}$/.test(shortId)) throw new HttpError(400, 'bad_id');
  const q = role
    ? env.DB.prepare("UPDATE sessions SET revoked = 1 WHERE substr(id, 1, 16) = ? AND role = ?").bind(shortId, role)
    : env.DB.prepare('UPDATE sessions SET revoked = 1 WHERE substr(id, 1, 16) = ?').bind(shortId);
  await q.run();
  return json({ ok: true });
}

// ---------- user ----------

function publicFeatures(cfg) {
  return {
    chat_enabled: cfg.chat_enabled,
    uploads_enabled: cfg.uploads_enabled,
    web_enabled: cfg.web_enabled,
    code_enabled: cfg.code_enabled,
    pause_message: cfg.pause_message,
    announcement: cfg.announcement,
  };
}

async function me(env, s) {
  const [cfg, prefs] = await Promise.all([getConfig(env), getPrefs(env)]);
  return json({ role: s.role, session: s.id.slice(0, 16), prefs, features: publicFeatures(cfg) });
}

async function savePrefs(req, env) {
  const body = await readJson(req, 20_000);
  const prefs = await getPrefs(env);
  for (const [k, t] of Object.entries(PREF_TYPES)) {
    if (k in body) {
      const v = coerce(t, body[k]);
      if (v !== undefined) prefs[k] = v;
    }
  }
  await putSetting(env, 'prefs', prefs);
  return json({ prefs });
}

async function listChats(env) {
  const { results } = await env.DB.prepare('SELECT id, title, created_at, updated_at, pinned FROM chats ORDER BY updated_at DESC LIMIT 1000').all();
  return json({ chats: results });
}

async function getChat(env, id) {
  if (!ID_RE.test(id)) throw new HttpError(400, 'bad_id');
  const chat = await env.DB.prepare('SELECT id, title, created_at, updated_at, pinned, leaf_id FROM chats WHERE id = ?').bind(id).first();
  if (!chat) throw new HttpError(404, 'not_found', 'This chat doesn’t exist anymore.');
  const { results } = await env.DB.prepare('SELECT data FROM messages WHERE chat_id = ? ORDER BY created_at').bind(id).all();
  return json({ chat, messages: results.map((r) => JSON.parse(r.data)) });
}

async function patchChat(req, env, id) {
  if (!ID_RE.test(id)) throw new HttpError(400, 'bad_id');
  const body = await readJson(req, 10_000);
  const sets = [];
  const vals = [];
  if (typeof body.title === 'string' && body.title.trim()) sets.push('title = ?'), vals.push(body.title.trim().slice(0, 120));
  if (typeof body.pinned === 'boolean') sets.push('pinned = ?'), vals.push(body.pinned ? 1 : 0);
  if (typeof body.leaf_id === 'string' && ID_RE.test(body.leaf_id)) sets.push('leaf_id = ?'), vals.push(body.leaf_id);
  if (!sets.length) return json({ ok: true });
  await env.DB.prepare(`UPDATE chats SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
  return json({ ok: true });
}

async function deleteFiles(env, ids) {
  for (const id of ids) await azure(env, `/files/${id}`, { method: 'DELETE' }).catch(() => {});
}

// Deletes up to 40 files of chats that no longer exist; anything left over is picked up by the daily cron.
async function purgeFiles(env, chatId) {
  const q = chatId
    ? env.DB.prepare('SELECT id FROM files WHERE chat_id = ? LIMIT 40').bind(chatId)
    : env.DB.prepare('SELECT id FROM files WHERE chat_id NOT IN (SELECT id FROM chats) LIMIT 40');
  const { results } = await q.all();
  await deleteFiles(env, results.map((r) => r.id));
  if (results.length) await env.DB.batch(results.map((r) => env.DB.prepare('DELETE FROM files WHERE id = ?').bind(r.id)));
}

async function deleteChat(env, ctx, id) {
  if (!ID_RE.test(id)) throw new HttpError(400, 'bad_id');
  await env.DB.batch([env.DB.prepare('DELETE FROM messages WHERE chat_id = ?').bind(id), env.DB.prepare('DELETE FROM chats WHERE id = ?').bind(id)]);
  ctx.waitUntil(purgeFiles(env, id));
  return json({ ok: true });
}

async function deleteAllChats(env, ctx) {
  await env.DB.batch([env.DB.prepare('DELETE FROM messages'), env.DB.prepare('DELETE FROM chats')]);
  ctx.waitUntil(purgeFiles(env, null));
  return json({ ok: true });
}

async function putMessage(req, env, id) {
  if (!ID_RE.test(id)) throw new HttpError(400, 'bad_id');
  const body = await readJson(req, 1_800_000);
  const { chat_id, parent_id, role, text, data, title } = body;
  if (!ID_RE.test(chat_id || '')) throw new HttpError(400, 'bad_chat');
  if (parent_id != null && !ID_RE.test(parent_id)) throw new HttpError(400, 'bad_parent');
  if (role !== 'user' && role !== 'assistant') throw new HttpError(400, 'bad_role');
  if (!data || typeof data !== 'object') throw new HttpError(400, 'bad_data');
  const now = Date.now();
  const created = Number.isFinite(data.createdAt) ? data.createdAt : now;
  const payload = JSON.stringify({ ...data, id, chatId: chat_id, parentId: parent_id ?? null, role });
  if (payload.length > 1_800_000) throw new HttpError(413, 'too_large', 'This message is too large to save.');
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO chats (id, title, created_at, updated_at, leaf_id) VALUES (?1, ?2, ?3, ?3, ?4)
       ON CONFLICT(id) DO UPDATE SET updated_at = ?3, leaf_id = ?4`,
    ).bind(chat_id, (typeof title === 'string' && title.trim() ? title.trim() : 'New chat').slice(0, 120), now, id),
    env.DB.prepare(
      `INSERT INTO messages (id, chat_id, parent_id, role, text, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET text = excluded.text, data = excluded.data`,
    ).bind(id, chat_id, parent_id ?? null, role, String(text || '').slice(0, 200_000), payload, created),
  ]);
  return json({ ok: true });
}

async function search(env, q) {
  q = q.trim().slice(0, 100);
  if (!q) return json({ results: [] });
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const [titles, msgs] = await Promise.all([
    env.DB.prepare("SELECT id, title, updated_at FROM chats WHERE title LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 20").bind(like).all(),
    env.DB.prepare(
      `SELECT m.chat_id, m.text, m.created_at, c.title, c.updated_at FROM messages m JOIN chats c ON c.id = m.chat_id
       WHERE m.text LIKE ? ESCAPE '\\' ORDER BY m.created_at DESC LIMIT 60`,
    ).bind(like).all(),
  ]);
  const out = new Map();
  for (const t of titles.results) out.set(t.id, { chat_id: t.id, title: t.title, updated_at: t.updated_at, snippet: '' });
  const lower = q.toLowerCase();
  for (const r of msgs.results) {
    const prev = out.get(r.chat_id);
    if (prev && prev.snippet) continue;
    const i = r.text.toLowerCase().indexOf(lower);
    const start = Math.max(0, i - 50);
    const snippet = (start > 0 ? '…' : '') + r.text.slice(start, i + q.length + 90).replace(/\s+/g, ' ').trim();
    out.set(r.chat_id, { chat_id: r.chat_id, title: r.title, updated_at: r.updated_at, snippet });
    if (out.size >= 30) break;
  }
  return json({ results: [...out.values()] });
}

// ---------- files ----------

async function uploadFile(req, env, url) {
  const cfg = await getConfig(env);
  if (!cfg.uploads_enabled) throw new HttpError(403, 'uploads_off', 'File uploads are turned off right now.');
  const ct = req.headers.get('Content-Type') || '';
  if (!ct.startsWith('multipart/form-data')) throw new HttpError(400, 'bad_upload');
  const len = Number(req.headers.get('Content-Length') || 0);
  if (len > MAX_UPLOAD + 10_000) throw new HttpError(413, 'too_large', 'Files can be up to 50 MB.');
  const chatId = url.searchParams.get('chat_id');
  if (!ID_RE.test(chatId || '')) throw new HttpError(400, 'bad_chat');
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_UPLOAD + 10_000) throw new HttpError(413, 'too_large', 'Files can be up to 50 MB.');
  const r = await azure(env, '/files', { method: 'POST', headers: { 'Content-Type': ct }, body: buf });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !FILE_RE.test(d.id || '')) throw new HttpError(502, 'upload_failed', d.error?.message || 'Upload failed. Please try again.');
  await env.DB.prepare('INSERT INTO files (id, chat_id, name, bytes, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(d.id, chatId, String(d.filename || '').slice(0, 300), d.bytes || buf.byteLength, Date.now())
    .run();
  return json({ id: d.id, bytes: d.bytes });
}

async function fileContent(env, id) {
  if (!FILE_RE.test(id)) throw new HttpError(400, 'bad_id');
  const known = await env.DB.prepare('SELECT id FROM files WHERE id = ?').bind(id).first();
  if (!known) throw new HttpError(404, 'not_found');
  const r = await azure(env, `/files/${id}/content`);
  if (!r.ok) throw new HttpError(r.status === 404 ? 404 : 502, 'fetch_failed', 'Couldn’t load that file.');
  return new Response(r.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=86400',
    },
  });
}

async function persistContainerFile(req, env) {
  const { container_id, file_id, filename, chat_id } = await readJson(req, 10_000);
  if (!CNTR_RE.test(container_id || '') || !CFILE_RE.test(file_id || '') || !ID_RE.test(chat_id || '')) throw new HttpError(400, 'bad_id');
  const name = String(filename || 'file').replace(/[^\w.\- ()]/g, '_').slice(0, 200) || 'file';
  const r = await azure(env, `/containers/${container_id}/files/${file_id}/content`);
  if (!r.ok) throw new HttpError(502, 'fetch_failed', 'That generated file has expired.');
  const blob = await r.blob();
  const form = new FormData();
  form.append('purpose', 'assistants');
  form.append('file', new File([blob], name));
  const up = await azure(env, '/files', { method: 'POST', body: form });
  const d = await up.json().catch(() => ({}));
  if (!up.ok || !FILE_RE.test(d.id || '')) throw new HttpError(502, 'upload_failed', d.error?.message || 'Couldn’t save that file.');
  await env.DB.prepare('INSERT INTO files (id, chat_id, name, bytes, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(d.id, chat_id, name, d.bytes || blob.size, Date.now())
    .run();
  return json({ id: d.id, bytes: d.bytes || blob.size, name });
}

// ---------- model ----------

function instructions(cfg, prefs, tz) {
  const zone = typeof tz === 'string' && validTz(tz) ? tz : cfg.timezone;
  const now = new Intl.DateTimeFormat('en-US', { timeZone: zone, dateStyle: 'full', timeStyle: 'short' }).format(Date.now());
  const parts = [cfg.system_prompt];
  if (prefs.name) parts.push(`The user's name is ${prefs.name}.`);
  if (prefs.about) parts.push(`What the user wants you to know about them:\n${prefs.about}`);
  if (prefs.style) parts.push(`How the user wants you to respond:\n${prefs.style}`);
  parts.push(`Current date and time for the user: ${now} (${zone}).`);
  return parts.join('\n\n');
}

async function usageToday(env, cfg) {
  const day = dayOf(Date.now(), cfg.timezone);
  const u = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(input_tokens + output_tokens), 0) AS t FROM usage WHERE day = ? AND kind = 'chat'").bind(day).first();
  return { day, messages: u.n, tokens: u.t };
}

async function checkLimits(env, ctx, cfg) {
  if (!cfg.daily_message_limit && !cfg.daily_token_limit) return;
  const u = await usageToday(env, cfg);
  const over = (cfg.daily_message_limit && u.messages >= cfg.daily_message_limit) || (cfg.daily_token_limit && u.tokens >= cfg.daily_token_limit);
  if (!over) return;
  const meta = JSON.stringify({ day: u.day });
  const already = await env.DB.prepare("SELECT 1 FROM events WHERE type = 'limit_reached' AND meta = ?").bind(meta).first();
  if (!already) await logEvent(env, ctx, cfg, 'limit_reached', 'warn', `Daily limit reached (${u.messages} messages, ${u.tokens.toLocaleString('en-US')} tokens today)`, { day: u.day }, 'notify_limit');
  throw new HttpError(429, 'limit', 'You’ve reached today’s usage limit. It resets at midnight.');
}

async function recordUsage(env, cfg, kind, mode, final, tools, ms, status) {
  const u = final?.usage || {};
  const out = final?.output || [];
  const searches = out.filter((o) => o.type === 'web_search_call').length;
  const codeRuns = out.filter((o) => o.type === 'code_interpreter_call').length;
  await env.DB.prepare(
    'INSERT INTO usage (ts, day, kind, mode, input_tokens, output_tokens, reasoning_tokens, cached_tokens, tools, ms, status, searches, code_runs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    Date.now(), dayOf(Date.now(), cfg.timezone), kind, mode,
    u.input_tokens || 0, u.output_tokens || 0, u.output_tokens_details?.reasoning_tokens || 0, u.input_tokens_details?.cached_tokens || 0,
    tools || null, ms, status, searches, codeRuns,
  ).run();
}

async function respond(req, env, ctx) {
  const [cfg, prefs] = await Promise.all([getConfig(env), getPrefs(env)]);
  if (!cfg.chat_enabled) throw new HttpError(503, 'paused', cfg.pause_message);
  const body = await readJson(req, 4_000_000);
  if (!Array.isArray(body.input) || !body.input.length || body.input.length > 1000) throw new HttpError(400, 'bad_input');
  await checkLimits(env, ctx, cfg);

  const mode = body.mode in MODES ? body.mode : 'thinking';
  const tools = [];
  if (cfg.web_enabled && body.web) tools.push({ type: 'web_search' });
  if (cfg.code_enabled && body.code) {
    const ids = (Array.isArray(body.file_ids) ? body.file_ids : []).filter((x) => FILE_RE.test(x)).slice(-20);
    tools.push({ type: 'code_interpreter', container: { type: 'auto', file_ids: ids } });
  }
  const payload = {
    model: cfg.model,
    input: body.input,
    instructions: instructions(cfg, prefs, body.tz),
    stream: true,
    store: false,
    reasoning: { effort: MODES[mode], summary: 'auto' },
    ...(tools.length ? { tools } : {}),
    ...(cfg.code_enabled && body.code ? { include: ['code_interpreter_call.outputs'] } : {}),
    ...(cfg.max_output_tokens ? { max_output_tokens: cfg.max_output_tokens } : {}),
  };

  const started = Date.now();
  const upstream = await azure(env, '/responses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!upstream.ok) {
    const d = await upstream.json().catch(() => ({}));
    const msg = d.error?.message || `Azure returned ${upstream.status}`;
    await logEvent(env, ctx, cfg, 'api_error', 'warn', `Model error (${upstream.status}): ${msg.slice(0, 200)}`, null, 'notify_error');
    const friendly = d.error?.code === 'content_filter' || /content (management|filter)/i.test(msg)
      ? 'That request was blocked by the content filter. Try rephrasing it.'
      : upstream.status === 429 ? 'The model is busy right now. Please try again in a moment.' : msg;
    throw new HttpError(upstream.status === 400 ? 400 : 502, 'upstream', friendly);
  }

  const { readable, writable } = new TransformStream();
  ctx.waitUntil(pump(upstream.body, writable, async (final, cancelled) => {
    const toolNames = tools.map((t) => t.type).join(',') || null;
    await recordUsage(env, cfg, 'chat', mode, final, toolNames, Date.now() - started, final?.status || (cancelled ? 'cancelled' : 'error'));
    if (final?.status === 'failed') {
      await logEvent(env, ctx, cfg, 'api_error', 'warn', `Response failed: ${(final.error?.message || 'unknown error').slice(0, 200)}`, null, 'notify_error');
    }
  }));
  return new Response(readable, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
}

// Pass the SSE stream through untouched while watching for the terminal event (for usage logging).
// Sends keep-alive comments at event boundaries during long silent reasoning.
async function pump(body, writable, done) {
  const reader = body.getReader();
  const writer = writable.getWriter();
  const dec = new TextDecoder();
  let buf = '';
  let final = null;
  let gone = false;
  let last = Date.now();
  const ping = setInterval(() => {
    if (!gone && buf === '' && Date.now() - last > 15_000) {
      last = Date.now();
      writer.write(enc.encode(': ping\n\n')).catch(() => (gone = true));
    }
  }, 5_000);
  try {
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      last = Date.now();
      try {
        await writer.write(value);
      } catch {
        gone = true;
        break;
      }
      buf += dec.decode(value, { stream: true });
      if (buf.includes('\r')) buf = buf.replace(/\r\n/g, '\n');
      let i;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (/^event: response\.(completed|incomplete|failed)\b/.test(block)) {
          const line = block.split('\n').find((l) => l.startsWith('data:'));
          try {
            final = JSON.parse(line.slice(5)).response;
          } catch {}
        }
      }
    }
  } catch {
    // upstream broke mid-stream; the client sees the stream end and shows an error
  } finally {
    clearInterval(ping);
    if (gone) reader.cancel().catch(() => {});
    writer.close().catch(() => {});
    await done(final, gone).catch((e) => console.error(e));
  }
}

async function makeTitle(req, env, ctx) {
  const cfg = await getConfig(env);
  const { chat_id, text } = await readJson(req, 50_000);
  if (!ID_RE.test(chat_id || '')) throw new HttpError(400, 'bad_chat');
  const started = Date.now();
  const r = await azure(env, '/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      store: false,
      reasoning: { effort: 'none' },
      max_output_tokens: 40,
      instructions: 'Write a short, specific title (2 to 5 words, Title Case) for a chat that begins with the message below. Reply with the title only: no quotes, no trailing punctuation, no emoji.',
      input: String(text || '').slice(0, 4000) || 'New chat',
    }),
  });
  const d = await r.json().catch(() => ({}));
  const raw = d.output?.find((o) => o.type === 'message')?.content?.find((c) => c.type === 'output_text')?.text || '';
  const title = raw.replace(/^["'“”‘’\s]+|["'“”‘’.\s]+$/g, '').replace(/\s+/g, ' ').slice(0, 80);
  ctx.waitUntil(recordUsage(env, cfg, 'title', null, d, null, Date.now() - started, r.ok ? 'completed' : 'error'));
  if (!title) return json({ title: null });
  await env.DB.prepare('UPDATE chats SET title = ? WHERE id = ?').bind(title, chat_id).run();
  return json({ title });
}

// ---------- admin ----------

async function adminOverview(env, s) {
  const cfg = await getConfig(env);
  const now = Date.now();
  const today = dayOf(now, cfg.timezone);
  const since30 = now - 30 * DAY;
  const [daily, totals, counts, sessions, events, unseen, lastActive, locks] = await Promise.all([
    env.DB.prepare(
      `SELECT day, SUM(kind = 'chat') AS messages, SUM(input_tokens) AS input, SUM(output_tokens) AS output, SUM(cached_tokens) AS cached, SUM(reasoning_tokens) AS reasoning
       FROM usage WHERE ts > ? GROUP BY day ORDER BY day`,
    ).bind(since30).all(),
    env.DB.prepare(
      `SELECT SUM(kind = 'chat') AS messages, COALESCE(SUM(input_tokens), 0) AS input, COALESCE(SUM(output_tokens), 0) AS output, COALESCE(SUM(cached_tokens), 0) AS cached,
              COALESCE(SUM(searches), 0) AS web, COALESCE(SUM(code_runs), 0) AS code, SUM(status = 'error' OR status = 'failed') AS errors, AVG(CASE WHEN kind = 'chat' THEN ms END) AS avg_ms
       FROM usage`,
    ).first(),
    env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM chats) AS chats, (SELECT COUNT(*) FROM messages) AS messages,
              (SELECT COUNT(*) FROM files) AS files, (SELECT COALESCE(SUM(bytes), 0) FROM files) AS bytes`,
    ).first(),
    env.DB.prepare('SELECT id, role, created_at, last_seen, location, device FROM sessions WHERE revoked = 0 AND expires_at > ? ORDER BY last_seen DESC').bind(now).all(),
    env.DB.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 60').all(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM events WHERE seen = 0').first(),
    env.DB.prepare("SELECT MAX(last_seen) AS t FROM sessions WHERE role = 'user'").first(),
    env.DB.prepare(
      `SELECT scope, ip, COUNT(*) AS fails, MAX(ts) AS last FROM attempts a WHERE ok = 0 AND ts > ?
         AND ts > COALESCE((SELECT MAX(ts) FROM attempts b WHERE b.scope = a.scope AND b.ip = a.ip AND b.ok = 1), 0)
       GROUP BY scope, ip ORDER BY last DESC LIMIT 30`,
    ).bind(now - DAY).all(),
  ]);
  const lastUsage = await env.DB.prepare("SELECT MAX(ts) AS t FROM usage WHERE kind = 'chat'").first();
  return json({
    config: cfg,
    defaults: { system_prompt: DEFAULT_PROMPT },
    today,
    daily: daily.results,
    totals,
    counts,
    sessions: sessions.results.map((r) => ({ ...r, id: r.id.slice(0, 16), current: r.id === s.id })),
    events: events.results,
    unseen: unseen.n,
    last_active: Math.max(lastActive?.t || 0, lastUsage?.t || 0),
    attempts: locks.results,
    lock: LOCK,
  });
}

async function adminEvents(env, url) {
  const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
  const after = Number(url.searchParams.get('after')) || 0;
  const { results } = await env.DB.prepare('SELECT * FROM events WHERE id < ? AND id > ? ORDER BY id DESC LIMIT 100').bind(before, after).all();
  const unseen = await env.DB.prepare('SELECT COUNT(*) AS n FROM events WHERE seen = 0').first();
  return json({ events: results, unseen: unseen.n });
}

async function adminConfig(req, env, ctx) {
  const body = await readJson(req, 50_000);
  const cfg = await getConfig(env);
  const changed = [];
  for (const [k, t] of Object.entries(CONFIG_TYPES)) {
    if (!(k in body)) continue;
    const v = coerce(t, body[k]);
    if (v === undefined) throw new HttpError(400, 'bad_value', `Invalid value for ${k}.`);
    if (JSON.stringify(cfg[k]) !== JSON.stringify(v)) {
      cfg[k] = v;
      changed.push(k);
    }
  }
  if (changed.length) {
    await putSetting(env, 'config', cfg);
    const msg = changed.includes('chat_enabled')
      ? cfg.chat_enabled ? 'Admin turned chat back on' : 'Admin paused chat'
      : changed.includes('login_enabled')
        ? cfg.login_enabled ? 'Admin turned sign-in back on' : 'Admin turned off sign-in'
        : `Admin changed settings: ${changed.join(', ')}`;
    await logEvent(env, ctx, cfg, 'settings_changed', 'info', msg, { changed }, null);
  }
  return json({ config: cfg });
}

async function adminPassword(req, env, ctx, s) {
  const { target, password, signout } = await readJson(req, 10_000);
  if (target !== 'user' && target !== 'admin') throw new HttpError(400, 'bad_target');
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) throw new HttpError(400, 'weak', 'Use at least 8 characters.');
  await setPassword(env, target, password);
  if (signout) {
    if (target === 'user') await env.DB.prepare("UPDATE sessions SET revoked = 1 WHERE role = 'user'").run();
    else await env.DB.prepare("UPDATE sessions SET revoked = 1 WHERE role = 'admin' AND id != ?").bind(s.id).run();
  }
  const cfg = await getConfig(env);
  await logEvent(env, ctx, cfg, 'password_changed', 'alert', `Admin changed the ${target === 'user' ? 'DiyaGPT' : 'admin'} password${signout ? ' and signed out all devices' : ''}`, null, 'notify_admin');
  return json({ ok: true });
}

async function adminUnlock(env, ctx) {
  const cfg = await updateConfig(env, { user_global_lock_until: 0, admin_global_lock_until: 0 });
  await env.DB.prepare('DELETE FROM attempts WHERE ok = 0 AND ts > ?').bind(Date.now() - DAY).run();
  await logEvent(env, ctx, cfg, 'unlocked', 'info', 'Admin cleared all sign-in lockouts', null, null);
  return json({ ok: true });
}

async function adminNotifyTest(env) {
  const cfg = await getConfig(env);
  if (!cfg.ntfy_topic) throw new HttpError(400, 'no_topic', 'Set a notification topic first.');
  const r = await fetch(`https://ntfy.sh/${cfg.ntfy_topic}`, { method: 'POST', headers: { Title: 'DiyaGPT', Tags: 'candle' }, body: 'Notifications are working.' });
  if (!r.ok) throw new HttpError(502, 'notify_failed', 'ntfy.sh rejected the test notification.');
  return json({ ok: true });
}
