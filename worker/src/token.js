// Compact HMAC-SHA256 tokens, PKCE helpers and the return-URL allowlist. WebCrypto only.
const enc = new TextEncoder();

export const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

const hmacKey = (secret, usage) =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);

export const hmac = async (secret, data) => b64u(await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(data)));
export const sha256hex = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))]
  .map(b => b.toString(16).padStart(2, '0')).join('');
export const randomId = (bytes = 16) => b64u(crypto.getRandomValues(new Uint8Array(bytes)));

// typ separates token kinds (session, state, magic link) so one cannot be replayed as another.
export async function sign(secret, typ, claims, ttlSec, now = Date.now()) {
  const body = b64u(enc.encode(JSON.stringify({ ...claims, typ, exp: Math.floor(now / 1000) + ttlSec })));
  return `${body}.${await hmac(secret, body)}`;
}

// Returns the claims, or null for any malformed, tampered, wrong-typ or expired token.
export async function verify(secret, typ, token, now = Date.now()) {
  try {
    const [body, mac, extra] = String(token).split('.');
    if (!body || !mac || extra !== undefined) return null;
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), unb64u(mac), enc.encode(body));
    if (!ok) return null;
    const claims = JSON.parse(new TextDecoder().decode(unb64u(body)));
    return claims.typ === typ && claims.exp > now / 1000 ? claims : null;
  } catch { return null; }
}

// Stateless PKCE: the verifier is derived from the signed nonce, never sent to the browser.
export const pkceVerifier = (secret, nonce) => hmac(secret, `pkce:${nonce}`);
export const pkceChallenge = async verifier =>
  b64u(await crypto.subtle.digest('SHA-256', enc.encode(verifier)));

export const allowedOrigins = env => String(env.APP_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);

export function originAllowed(env, origin) {
  if (!origin) return false;
  if (allowedOrigins(env).includes(origin)) return true;
  return env.ALLOW_LOCALHOST === '1' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

// Parsed URL if its origin is allowed and, on the deployed site, its path is under APP_PATH (the
// project page, so no other pages on a shared github.io origin). Local dev origins skip the path check.
export function checkReturn(env, value) {
  try {
    const u = new URL(value);
    if (u.username || u.password || !originAllowed(env, u.origin)) return null;
    const local = !allowedOrigins(env).includes(u.origin);
    return local || u.pathname.startsWith(env.APP_PATH || '/rangecraft/') ? u : null;
  } catch { return null; }
}

// return#a=b -> return#a=b&token=...; keeps the app's own fragment state (e.g. taxon).
export function withParams(returnUrl, params) {
  const u = new URL(returnUrl);
  const h = new URLSearchParams(u.hash.slice(1));
  for (const [k, v] of Object.entries(params)) h.set(k, v);
  u.hash = h.toString();
  return u.toString();
}
