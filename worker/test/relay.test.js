import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { appJwt } from '../src/github.js';
import { handle } from '../src/index.js';
import { sign, verify, unb64u } from '../src/token.js';
import { fc, kv, lastPublicKey, pkcs8Pem } from './helpers.js';

const APP = 'https://pollocklab.github.io';
let env, calls, realFetch, routes;
const J = (o, status = 200) => new Response(JSON.stringify(o), { status });

beforeEach(async () => {
  realFetch = globalThis.fetch;
  calls = []; routes = {};
  globalThis.fetch = async (url, init = {}) => {
    const key = `${init.method || 'GET'} ${url}`;
    calls.push({ key, init });
    const r = Object.entries(routes).find(([k]) => key.startsWith(k));
    return r ? r[1](init) : J({ message: 'unmocked' }, 599);
  };
  env = { HMAC_KEY: 'k'.repeat(32), APP_ORIGIN: APP, GH_REPO: 'PollockLab/rangecraft', GH_BASE: 'main', KV: kv(),
    GH_APP_ID: '42', GH_APP_PRIVATE_KEY: await pkcs8Pem(), GH_INSTALLATION_ID: '7',
    ORCID_CLIENT_ID: 'oc', ORCID_CLIENT_SECRET: 'os', GITHUB_CLIENT_ID: 'gc', GITHUB_CLIENT_SECRET: 'gs',
    RESEND_API_KEY: 'rk', MAIL_FROM: 'RangeCraft <no-reply@example.org>' };
});
afterEach(() => { globalThis.fetch = realFetch; });

const get = (path, headers = {}) => handle(new Request(`https://relay.example${path}`, { headers }), env);
const post = (path, body, headers = {}) => handle(new Request(`https://relay.example${path}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { Origin: APP, ...headers } }), env);
const cookie = r => r.headers.get('Set-Cookie').split(';')[0];
const fragment = r => new URLSearchParams(new URL(r.headers.get('Location')).hash.slice(1));

test('/providers lists only providers with secrets; none without HMAC_KEY', async () => {
  assert.deepEqual((await (await get('/providers')).json()).providers, ['orcid', 'github', 'email']);
  delete env.GITHUB_CLIENT_SECRET; delete env.RESEND_API_KEY;
  assert.deepEqual((await (await get('/providers')).json()).providers, ['orcid']);
  assert.equal((await get('/auth/github/start?return=' + encodeURIComponent(APP + '/'))).status, 404);
  delete env.HMAC_KEY;
  assert.deepEqual((await (await get('/providers')).json()).providers, []);
});

test('start rejects a return URL off the allowlist', async () => {
  assert.equal((await get('/auth/orcid/start?return=https://evil.io/')).status, 400);
  assert.equal((await get('/auth/orcid/start')).status, 400);
});

test('github flow: PKCE, state, cookie binding, session in the fragment', async () => {
  const s = await get('/auth/github/start?return=' + encodeURIComponent(APP + '/rangecraft/#taxon=5'));
  assert.equal(s.status, 302);
  const loc = new URL(s.headers.get('Location'));
  assert.equal(loc.origin + loc.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(loc.searchParams.get('redirect_uri'), 'https://relay.example/auth/github/callback');
  const state = loc.searchParams.get('state');

  routes['POST https://github.com/login/oauth/access_token'] = init => { assert.ok(new URLSearchParams(init.body).get('code_verifier')); return J({ access_token: 'at' }); };
  routes['GET https://api.github.com/user'] = init => { assert.equal(init.headers.Authorization, 'Bearer at'); return J({ id: 4242, login: 'ann', name: null }); };
  const cb = `/auth/github/callback?code=c&state=${state}`;
  assert.equal((await get(cb)).status, 400); // no cookie: login CSRF
  const ok = await get(cb, { Cookie: cookie(s) });
  assert.equal(ok.status, 302);
  assert.equal(fragment(ok).get('taxon'), '5');
  const sess = await verify(env.HMAC_KEY, 'session', fragment(ok).get('token'));
  assert.deepEqual({ ...sess, exp: 0, typ: 0 }, { provider: 'github', id: '4242', login: 'ann', name: 'ann', verified: true, exp: 0, typ: 0 });
  assert.ok(sess.exp - Date.now() / 1000 <= 7200);
});

test('callback rejects a forged state and a state for another provider', async () => {
  const forged = await sign('x'.repeat(32), 'state', { nonce: 'n', return: APP + '/', p: 'orcid' }, 60);
  assert.equal((await get(`/auth/orcid/callback?code=c&state=${forged}`, { Cookie: 'rc_n=n' })).status, 400);
  const good = await sign(env.HMAC_KEY, 'state', { nonce: 'n', return: APP + '/', p: 'orcid' }, 60);
  assert.equal((await get(`/auth/github/callback?code=c&state=${good}`, { Cookie: 'rc_n=n' })).status, 400);
});

test('orcid callback: verified iD and name', async () => {
  const s = await get('/auth/orcid/start?return=' + encodeURIComponent(APP + '/'));
  assert.ok(!new URL(s.headers.get('Location')).searchParams.has('code_challenge'));
  assert.equal(new URL(s.headers.get('Location')).searchParams.get('scope'), '/authenticate');
  const state = new URL(s.headers.get('Location')).searchParams.get('state');
  routes['POST https://orcid.org/oauth/token'] = () => J({ access_token: 'a', orcid: '0000-0002-1825-0097', name: 'Josiah Carberry' });
  const ok = await get(`/auth/orcid/callback?code=c&state=${state}`, { Cookie: cookie(s) });
  const sess = await verify(env.HMAC_KEY, 'session', fragment(ok).get('token'));
  assert.equal(sess.id, '0000-0002-1825-0097');
  assert.equal(sess.name, 'Josiah Carberry');
});

test('provider failure redirects with an error, no token', async () => {
  const s = await get('/auth/orcid/start?return=' + encodeURIComponent(APP + '/'));
  const state = new URL(s.headers.get('Location')).searchParams.get('state');
  routes['POST https://orcid.org/oauth/token'] = () => J({ error: 'invalid_grant' }, 400);
  const r = await get(`/auth/orcid/callback?code=c&state=${state}`, { Cookie: cookie(s) });
  assert.equal(fragment(r).get('error'), 'signin_failed');
  assert.equal(fragment(r).get('token'), null);
});

test('inat: token, api_token, users/me', async () => {
  env.INAT_CLIENT_ID = 'i'; env.INAT_CLIENT_SECRET = 's';
  const s = await get('/auth/inat/start?return=' + encodeURIComponent(APP + '/'));
  const state = new URL(s.headers.get('Location')).searchParams.get('state');
  routes['POST https://www.inaturalist.org/oauth/token'] = () => J({ access_token: 'at' });
  routes['GET https://www.inaturalist.org/users/api_token'] = init => { assert.equal(init.headers.Authorization, 'Bearer at'); return J({ api_token: 'jwt' }); };
  routes['GET https://api.inaturalist.org/v1/users/me'] = init => { assert.equal(init.headers.Authorization, 'jwt'); return J({ results: [{ id: 9, login: 'bird_nerd', name: '' }] }); };
  const sess = await verify(env.HMAC_KEY, 'session', fragment(await get(`/auth/inat/callback?code=c&state=${state}`, { Cookie: cookie(s) })).get('token'));
  assert.deepEqual([sess.provider, sess.id, sess.login, sess.name], ['inat', '9', 'bird_nerd', 'bird_nerd']);
});

test('email magic link: unverified identity, one-time use, rate limit', async () => {
  let mail;
  routes['POST https://api.resend.com/emails'] = init => { mail = JSON.parse(init.body); return J({ id: 'm' }); };
  const start = await post('/auth/email/start', { email: 'Ann@Example.org', return: APP + '/' });
  assert.equal(start.status, 200);
  assert.match(start.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=None/);
  assert.equal(start.headers.get('Access-Control-Allow-Credentials'), 'true');
  assert.deepEqual(mail.to, ['ann@example.org']);
  const link = new URL(mail.text.match(/https:\/\/\S+/)[0]);
  const ok = await get(link.pathname + link.search, { Cookie: cookie(start) });
  const sess = await verify(env.HMAC_KEY, 'session', fragment(ok).get('token'));
  assert.equal(sess.provider, 'email'); assert.equal(sess.verified, false);
  assert.match(sess.id, /^[0-9a-f]{16}$/);
  assert.ok(!JSON.stringify(sess).includes('ann@'));
  assert.equal((await get(link.pathname + link.search, { Cookie: cookie(start) })).status, 400); // consumed
  assert.equal((await post('/auth/email/start', { email: 'ann@example.org', return: APP + '/' })).status, 200);
  assert.equal((await post('/auth/email/start', { email: 'ann@example.org', return: APP + '/' })).status, 200);
  assert.equal((await post('/auth/email/start', { email: 'ann@example.org', return: APP + '/' })).status, 429);
  assert.equal((await post('/auth/email/start', { email: 'bad', return: APP + '/' })).status, 400);
  assert.equal((await post('/auth/email/start', { email: 'b@example.org', return: 'https://evil.io/' })).status, 400);
});

test('expired magic link is rejected', async () => {
  const t = await sign(env.HMAC_KEY, 'ml', { nonce: 'n', id: 'x', name: 'n', return: APP + '/' }, 60, Date.now() - 120_000);
  await env.KV.put('ml:n', '1');
  assert.equal((await get(`/auth/email/callback?t=${t}`, { Cookie: 'rc_ml=n' })).status, 400);
});

test('email login CSRF: no cookie means a confirmation page, not a token', async () => {
  let mail;
  routes['POST https://api.resend.com/emails'] = init => { mail = JSON.parse(init.body); return J({ id: 'm' }); };
  const start = await post('/auth/email/start', { email: 'victim@example.org', return: APP + '/' });
  const link = new URL(mail.text.match(/https:\/\/\S+/)[0]);
  const other = await get(link.pathname + link.search); // different browser: no cookie
  assert.equal(other.status, 200);
  assert.equal(other.headers.get('Location'), null);
  const html = await other.text();
  assert.ok(html.includes('victim@example.org') && html.includes('method="post"'));
  assert.ok(await env.KV.get([...env.KV.m.keys()].find(k => k.startsWith('ml:')))); // GET did not consume it
  const wrong = await get(link.pathname + link.search, { Cookie: 'rc_ml=other' });
  assert.equal(wrong.status, 200); // wrong cookie is treated as missing
  const t = link.searchParams.get('t');
  const post_ = await handle(new Request('https://relay.example/auth/email/callback', { method: 'POST', body: new URLSearchParams({ t }) }), env);
  assert.equal(post_.status, 303);
  assert.ok(await verify(env.HMAC_KEY, 'session', fragment(post_).get('token')));
  const again = await handle(new Request('https://relay.example/auth/email/callback', { method: 'POST', body: new URLSearchParams({ t }) }), env);
  assert.equal(again.status, 400);
  assert.ok(start.headers.get('Set-Cookie'));
});

test('github and inat sessions key on the numeric id, not the login', async () => {
  routes['POST https://github.com/login/oauth/access_token'] = () => J({ access_token: 'at' });
  const states = async () => { const s = await get('/auth/github/start?return=' + encodeURIComponent(APP + '/')); return [new URL(s.headers.get('Location')).searchParams.get('state'), cookie(s)]; };
  const ids = [];
  for (const [id, login] of [[1, 'ann'], [2, 'ann']]) { // the login was renamed away and reused
    routes['GET https://api.github.com/user'] = () => J({ id, login, name: 'A' });
    const [state, ck] = await states();
    ids.push((await verify(env.HMAC_KEY, 'session', fragment(await get(`/auth/github/callback?code=c&state=${state}`, { Cookie: ck })).get('token'))).id);
  }
  assert.deepEqual(ids, ['1', '2']);
  routes['GET https://api.github.com/user'] = () => J({ login: 'ann' }); // no numeric id: refuse
  const [state, ck] = await states();
  assert.equal(fragment(await get(`/auth/github/callback?code=c&state=${state}`, { Cookie: ck })).get('error'), 'signin_failed');
});

test('app JWT is RS256 with iss and a short expiry', async () => {
  const jwt = await appJwt('42', env.GH_APP_PRIVATE_KEY), [hb, pb, sb] = jwt.split('.');
  const [h, p] = [hb, pb].map(x => JSON.parse(Buffer.from(unb64u(x))));
  assert.ok(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', lastPublicKey, unb64u(sb), new TextEncoder().encode(`${hb}.${pb}`)));
  assert.equal(h.alg, 'RS256'); assert.equal(p.iss, '42'); assert.ok(p.exp - p.iat <= 600);
  await assert.rejects(appJwt('1', '-----BEGIN RSA PRIVATE KEY-----\nAA\n-----END RSA PRIVATE KEY-----'), /PKCS8/);
});

const mockGithub = () => {
  routes['POST https://api.github.com/app/installations/7/access_tokens'] = init => { assert.match(init.headers.Authorization, /^Bearer ey/); return J({ token: 'inst' }); };
  routes['GET https://api.github.com/repos/PollockLab/rangecraft/git/ref/heads/main'] = () => J({ object: { sha: 'abc' } });
  routes['POST https://api.github.com/repos/PollockLab/rangecraft/git/refs'] = () => J({});
  routes['PUT https://api.github.com/repos/PollockLab/rangecraft/contents/'] = () => J({});
  routes['POST https://api.github.com/repos/PollockLab/rangecraft/pulls'] = () => J({ number: 3, html_url: 'https://github.com/PollockLab/rangecraft/pull/3' });
  routes['POST https://api.github.com/repos/PollockLab/rangecraft/issues/3/labels'] = () => J([]);
};
const bearer = async (o = {}) => ({ Authorization: 'Bearer ' + await sign(env.HMAC_KEY, 'session', { provider: 'orcid', id: '0000-0002-1825-0097', name: 'Josiah', verified: true, ...o }, 600) });

test('submit opens a labelled PR with the session as submitter', async () => {
  mockGithub();
  const r = await post('/submit', { geojson: fc({ github: 'victim' }), message: 'cc @someone' }, await bearer());
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), APP);
  assert.equal((await r.json()).url, 'https://github.com/PollockLab/rangecraft/pull/3');
  const put = calls.find(c => c.key.startsWith('PUT '));
  assert.match(put.key, /contents\/data\/ranges\/123\/ann-[0-9a-f]{8}\.geojson$/);
  const sent = JSON.parse(put.init.body);
  const file = JSON.parse(Buffer.from(sent.content, 'base64'));
  assert.equal(file.properties.submitter.id, '0000-0002-1825-0097');
  assert.ok(!('github' in file.properties));
  const pr = JSON.parse(calls.find(c => c.key.endsWith('/pulls')).init.body);
  assert.equal(pr.title, 'range: Danaus plexippus by Josiah (orcid)');
  assert.ok(!pr.body.includes('@someone'));
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { labels: ['relay'] });
});

test('submit guards: auth, origin, size, validity, rate limit', async () => {
  mockGithub();
  const good = { geojson: fc() };
  assert.equal((await post('/submit', good)).status, 401);
  assert.equal((await post('/submit', good, { Authorization: 'Bearer junk' })).status, 401);
  assert.equal((await post('/submit', good, { ...await bearer(), Origin: 'https://evil.io' })).status, 403);
  assert.equal((await post('/submit', 'x'.repeat(1_000_001), await bearer())).status, 413);
  assert.equal((await post('/submit', '{', await bearer())).status, 400);
  assert.equal((await post('/submit', { geojson: { type: 'FeatureCollection', features: [] } }, await bearer())).status, 400);
  assert.equal((await post('/submit', { geojson: fc({ taxonKey: 'x' }) }, await bearer())).status, 400);
  assert.equal((await post('/submit', { }, await bearer())).status, 400);
  assert.equal(calls.filter(c => c.key.includes('github.com/repos')).length, 0);
  const h = await bearer();
  for (let i = 0; i < 10; i++) assert.equal((await post('/submit', good, h)).status, 200);
  assert.equal((await post('/submit', good, h)).status, 429);
  assert.equal((await post('/submit', good, await bearer({ id: 'someone-else' }))).status, 200);
});

test('GitHub failure deletes the branch and returns 502', async () => {
  mockGithub();
  routes['POST https://api.github.com/repos/PollockLab/rangecraft/pulls'] = () => J({ message: 'nope' }, 422);
  routes['DELETE https://api.github.com/repos/PollockLab/rangecraft/git/refs/heads/relay/'] = () => J({}, 204);
  assert.equal((await post('/submit', { geojson: fc() }, await bearer())).status, 502);
  assert.ok(calls.some(c => c.key.startsWith('DELETE ')));
});

test('CORS preflight only grants the app origin', async () => {
  const ok = await handle(new Request('https://relay.example/submit', { method: 'OPTIONS', headers: { Origin: APP } }), env);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), APP);
  const no = await handle(new Request('https://relay.example/submit', { method: 'OPTIONS', headers: { Origin: 'https://evil.io' } }), env);
  assert.equal(no.headers.get('Access-Control-Allow-Origin'), null);
});
