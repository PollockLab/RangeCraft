// RangeCraft relay: OAuth/magic-link sign-in and PR submission through a GitHub App.
import { buildFile, RangeError, slug } from './geo.js';
import { openPr } from './github.js';
import { enabledProviders, PROVIDERS, sendMagicLink } from './providers.js';
import { checkReturn, originAllowed, pkceChallenge, pkceVerifier, randomId, sha256hex, sign, verify, withParams } from './token.js';

const MAX_BODY = 1_000_000, SESSION_TTL = 2 * 3600, SUBMITS_PER_DAY = 10;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

const reply = (status, body, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {
  status, headers: { 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json', ...headers },
});
const redirect = (url, headers = {}) => new Response(null, { status: 302, headers: { Location: url, ...headers } });

// Rate limit with a KV counter. KV is eventually consistent, so this is a soft cap, not a hard one.
async function hit(kv, key, max, ttl) {
  const n = Number(await kv.get(key)) || 0;
  if (n >= max) return false;
  await kv.put(key, String(n + 1), { expirationTtl: ttl });
  return true;
}

const session = (env, id) => sign(env.HMAC_KEY, 'session', { provider: id.provider, id: id.id, name: String(id.name).slice(0, 100), verified: !!id.verified }, SESSION_TTL);
const readCookie = (req, k) => (req.headers.get('Cookie') || '').split(/;\s*/).map(c => c.split('=')).find(([n]) => n === k)?.[1];

export async function handle(req, env) {
  const url = new URL(req.url), origin = req.headers.get('Origin');
  const cors = originAllowed(env, origin) ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : { Vary: 'Origin' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' } });
  const out = async p => { const r = await p; for (const [k, v] of Object.entries(cors)) r.headers.set(k, v); return r; };
  const enabled = enabledProviders(env);
  const parts = url.pathname.split('/').filter(Boolean);

  if (req.method === 'GET' && url.pathname === '/providers') return out(reply(200, { providers: enabled }));

  if (parts[0] === 'auth' && parts.length === 3 && parts[1] === 'email' && parts[2] === 'start' && req.method === 'POST') {
    return out(emailStart(req, env, enabled, origin));
  }
  if (parts[0] === 'auth' && parts.length === 3 && req.method === 'GET') {
    const [, p, step] = parts;
    if (!enabled.includes(p)) return reply(404, 'provider disabled');
    if (p === 'email' && step === 'callback') return emailCallback(url, env);
    if (p !== 'email' && step === 'start') return oauthStart(url, req, env, p);
    if (p !== 'email' && step === 'callback') return oauthCallback(url, req, env, p);
  }
  if (req.method === 'POST' && url.pathname === '/submit') return out(submit(req, env, origin));
  return reply(404, 'not found');
}

async function oauthStart(url, req, env, p) {
  const ret = checkReturn(env, url.searchParams.get('return'));
  if (!ret) return reply(400, 'return URL is not on an allowed origin');
  const prov = PROVIDERS[p], nonce = randomId();
  const state = await sign(env.HMAC_KEY, 'state', { nonce, return: ret.toString(), p }, 600);
  const q = new URLSearchParams({ response_type: 'code', client_id: env[`${prov.prefix}_CLIENT_ID`], redirect_uri: `${url.origin}/auth/${p}/callback`, state });
  if (prov.scope) q.set('scope', prov.scope);
  if (prov.pkce) { q.set('code_challenge', await pkceChallenge(await pkceVerifier(env.HMAC_KEY, nonce))); q.set('code_challenge_method', 'S256'); }
  // The cookie ties the callback to the browser that started the flow (login CSRF).
  return redirect(`${prov.authorize}?${q}`, { 'Set-Cookie': `rc_n=${nonce}; Max-Age=600; Path=/auth; HttpOnly; Secure; SameSite=Lax` });
}

async function oauthCallback(url, req, env, p) {
  const st = await verify(env.HMAC_KEY, 'state', url.searchParams.get('state'));
  if (!st || st.p !== p || readCookie(req, 'rc_n') !== st.nonce) return reply(400, 'invalid or expired sign-in state');
  const clear = { 'Set-Cookie': 'rc_n=; Max-Age=0; Path=/auth; HttpOnly; Secure; SameSite=Lax' };
  const fail = code => redirect(withParams(st.return, { error: code }), clear);
  const code = url.searchParams.get('code');
  if (!code) return fail('denied');
  try {
    const id = await PROVIDERS[p].identity(env, { code, redirectUri: `${url.origin}/auth/${p}/callback`, verifier: PROVIDERS[p].pkce ? await pkceVerifier(env.HMAC_KEY, st.nonce) : undefined });
    return redirect(withParams(st.return, { token: await session(env, id) }), clear);
  } catch { return fail('signin_failed'); }
}

async function emailStart(req, env, enabled, origin) {
  if (!enabled.includes('email')) return reply(404, 'provider disabled');
  if (!originAllowed(env, origin)) return reply(403, 'origin not allowed');
  const b = await req.json().catch(() => ({}));
  const email = String(b.email || '').trim().toLowerCase(), ret = checkReturn(env, b.return);
  if (!EMAIL_RE.test(email) || email.length > 254) return reply(400, { error: 'invalid email' });
  if (!ret) return reply(400, { error: 'return URL is not on an allowed origin' });
  const eh = await sha256hex(email), ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await hit(env.KV, `rl:email:${eh}`, 3, 3600)) || !(await hit(env.KV, `rl:ip:${ip}`, 10, 3600))) return reply(429, { error: 'too many requests, try later' });
  const nonce = randomId();
  await env.KV.put(`ml:${nonce}`, '1', { expirationTtl: 900 });
  // The email itself never leaves the token; the public id is a hash prefix.
  const t = await sign(env.HMAC_KEY, 'ml', { nonce, id: eh.slice(0, 16), name: String(b.name || '').trim().slice(0, 100) || 'Email contributor', return: ret.toString() }, 900);
  try { await sendMagicLink(env, email, `${new URL(req.url).origin}/auth/email/callback?t=${t}`); } catch { return reply(502, { error: 'could not send email' }); }
  return reply(200, { ok: true });
}

async function emailCallback(url, env) {
  const c = await verify(env.HMAC_KEY, 'ml', url.searchParams.get('t'));
  if (!c || !(await env.KV.get(`ml:${c.nonce}`))) return reply(400, 'link expired or already used');
  await env.KV.delete(`ml:${c.nonce}`);
  return redirect(withParams(c.return, { token: await session(env, { provider: 'email', id: c.id, name: c.name, verified: false }) }));
}

async function submit(req, env, origin) {
  if (!originAllowed(env, origin)) return reply(403, { error: 'origin not allowed' });
  const sess = await verify(env.HMAC_KEY, 'session', (req.headers.get('Authorization') || '').replace(/^Bearer /, ''));
  if (!sess) return reply(401, { error: 'sign in again' });
  if (Number(req.headers.get('Content-Length')) > MAX_BODY) return reply(413, { error: 'body over 1 MB' });
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY) return reply(413, { error: 'body over 1 MB' });
  let body, file;
  try { body = JSON.parse(text); } catch { return reply(400, { error: 'invalid JSON' }); }
  try { file = buildFile(body?.geojson, sess); } catch (e) {
    if (e instanceof RangeError || e instanceof TypeError) return reply(400, { error: e.message });
    throw e;
  }
  const day = new Date().toISOString().slice(0, 10);
  if (!(await hit(env.KV, `sub:${sess.provider}:${sess.id}:${day}`, SUBMITS_PER_DAY, 86400))) return reply(429, { error: 'daily submission limit reached' });
  const p = file.properties, sid = [...crypto.getRandomValues(new Uint8Array(4))].map(b => b.toString(16).padStart(2, '0')).join('');
  const clean = s => String(s).replace(/[\r\n]+/g, ' ').slice(0, 100);
  const title = `range: ${clean(p.scientificName || p.taxonKey)} by ${clean(sess.name)} (${sess.provider})`;
  const note = String(body.message || '').slice(0, 2000).replace(/@/g, '@​');
  const prBody = `Submitted through the relay.\n\n- Identity: ${sess.provider} \`${sess.id}\` (${sess.verified ? 'verified by the provider' : 'unverified, a maintainer merge counts as the vouch'})\n- Taxon: ${p.taxonKey}\n\n${note}`;
  try {
    const prUrl = await openPr(env, { path: `data/ranges/${p.taxonKey}/${slug(p.author)}-${sid}.geojson`, content: JSON.stringify(file, null, 1) + '\n', branch: `relay/${p.taxonKey}-${sid}`, title, body: prBody });
    return reply(200, { url: prUrl });
  } catch { return reply(502, { error: 'could not open the pull request' }); }
}

export default { fetch: (req, env) => handle(req, env) };
