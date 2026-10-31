// The access token lives in memory only (never localStorage), so XSS cannot steal a stored copy.
// The refresh token is an httpOnly cookie managed by the browser; this code never sees it.
let accessToken = null;
const listeners = new Set();

export const onToken = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
function setToken(t) { accessToken = t; listeners.forEach((fn) => fn(t)); }

async function tokenRequest(body) {
  const r = await fetch('/api/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { setToken(null); throw new Error(data.error_description || data.error || 'Request failed'); }
  setToken(data.access_token);
  return data.access_token;
}

export const login = (username, password) => tokenRequest({ grant_type: 'password', username, password });

// De-duplicated: parallel refreshes would fight over the single-use refresh cookie.
let inflight = null;
export function refresh() {
  inflight ??= tokenRequest({ grant_type: 'refresh_token' }).finally(() => { inflight = null; });
  return inflight;
}

export async function register(username, password) {
  const r = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error_description || data.error || 'Registration failed');
}

export async function logout() {
  await fetch('/api/oauth/revoke', { method: 'POST' });
  setToken(null);
}

export async function api(path, opts = {}) {
  const call = () => fetch('/api' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let r = await call();
  if (r.status === 401) {                       // token expired? refresh once and retry
    try { await refresh(); r = await call(); } catch { /* session is over */ }
  }
  const data = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(data?.error || 'Request failed'), { status: r.status });
  return data;
}

export function decode(token) {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); }
  catch { return null; }
}
