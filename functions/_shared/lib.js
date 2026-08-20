// Draught — shared primitives. No dependencies; everything here is Web Crypto
// and standard Request/Response.

export const DAY = 86400;
export const SESSION_DAYS = 90;
export const COOKIE = 'dr_sess';
export const OAUTH_COOKIE = 'dr_oauth';

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}
export const bad = (msg, status = 400) => json({ error: msg }, status);

export const now = () => Math.floor(Date.now() / 1000);

export function randToken(bytes = 32) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return b64url(b);
}

export function b64url(bytes) {
  let s = '';
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return b64url(new Uint8Array(digest));
}

// Constant-time string compare, for the OAuth state check.
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function cookies(request) {
  const header = request.headers.get('cookie') || '';
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setCookie(name, value, { maxAge, secure, expires } = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (secure) bits.push('Secure');
  if (typeof maxAge === 'number') bits.push(`Max-Age=${maxAge}`);
  if (expires) bits.push(`Expires=${expires}`);
  return bits.join('; ');
}

export const clearCookie = (name, secure) =>
  setCookie(name, '', { maxAge: 0, secure, expires: 'Thu, 01 Jan 1970 00:00:00 GMT' });

// "Cloudwater  DIPA / v2" -> "cloudwater-dipa-v2"
export function slugify(s) {
  return String(s)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export const HANDLE_RE = /^[a-z0-9_]{2,20}$/;
// Handles that would collide with routes or impersonate the product.
export const RESERVED = new Set([
  'admin', 'api', 'draught', 'settings', 'log', 'recent', 'welcome', 'about', 'beer', 'b',
  'brewery', 'style', 'styles', 'help', 'support', 'terms', 'privacy', 'login', 'logout',
  'signin', 'signup', 'auth', 'me', 'you', 'user', 'users', 'null', 'undefined', 'root',
]);

// ---- sessions -------------------------------------------------------------

export async function createSession(env, userId, secure) {
  const token = randToken();
  const id = await sha256(token + env.SESSION_SECRET);
  const t = now();
  await env.DB.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(id, userId, t, t + SESSION_DAYS * DAY)
    .run();
  return setCookie(COOKIE, token, { maxAge: SESSION_DAYS * DAY, secure });
}

export async function currentUser(request, env) {
  const token = cookies(request)[COOKIE];
  if (!token) return null;
  const id = await sha256(token + env.SESSION_SECRET);
  const row = await env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`
  ).bind(id, now()).first();
  return row || null;
}

export async function destroySession(request, env) {
  const token = cookies(request)[COOKIE];
  if (!token) return;
  const id = await sha256(token + env.SESSION_SECRET);
  await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
}

export const publicUser = (u) => ({
  handle: u.handle, name: u.name, avatar: u.avatar, bio: u.bio, joined: u.created_at,
});
