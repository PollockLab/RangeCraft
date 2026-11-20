import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkReturn, sign, verify, withParams, pkceVerifier, pkceChallenge } from '../src/token.js';

const K = 'k'.repeat(32), env = { APP_ORIGIN: 'https://pollocklab.github.io' };

test('sign/verify round trip', async () => {
  const t = await sign(K, 'session', { id: 'a' }, 60);
  assert.equal((await verify(K, 'session', t)).id, 'a');
});

test('expired token is rejected', async () => {
  const t = await sign(K, 'session', { id: 'a' }, 60, Date.now() - 120_000);
  assert.equal(await verify(K, 'session', t), null);
});

test('tampered payload, wrong key, wrong typ and junk are rejected', async () => {
  const t = await sign(K, 'session', { id: 'a', verified: false }, 60);
  const [body, mac] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), verified: true })).toString('base64url');
  assert.equal(await verify(K, 'session', `${forged}.${mac}`), null);
  assert.equal(await verify('other'.repeat(8), 'session', t), null);
  assert.equal(await verify(K, 'state', t), null);
  for (const j of ['', 'a', 'a.b', 'a.b.c', undefined, null]) assert.equal(await verify(K, 'session', j), null);
});

test('return URL allowlist', () => {
  assert.ok(checkReturn(env, 'https://pollocklab.github.io/rangecraft/#taxon=1'));
  for (const bad of ['https://evil.io/rangecraft/', 'https://pollocklab.github.io.evil.io/', 'https://pollocklab.github.io@evil.io/', 'http://pollocklab.github.io/', 'javascript:alert(1)', 'http://localhost:8816/', '', null]) assert.equal(checkReturn(env, bad), null, String(bad));
  assert.ok(checkReturn({ ...env, ALLOW_LOCALHOST: '1' }, 'http://localhost:8816/'));
  assert.equal(checkReturn({ ...env, ALLOW_LOCALHOST: '1' }, 'http://localhost.evil.io/'), null);
});

test('return URL must be under the project path on the deployed origin', () => {
  for (const bad of ['https://pollocklab.github.io/', 'https://pollocklab.github.io/other/', 'https://pollocklab.github.io/rangecraft', 'https://pollocklab.github.io/rangecrafty/', 'https://pollocklab.github.io/rangecraft/../x/']) assert.equal(checkReturn(env, bad), null, bad);
  assert.ok(checkReturn(env, 'https://pollocklab.github.io/rangecraft/'));
  assert.ok(checkReturn({ ...env, APP_PATH: '/x/' }, 'https://pollocklab.github.io/x/y'));
  assert.ok(checkReturn({ ...env, ALLOW_LOCALHOST: '1' }, 'http://localhost:8816/')); // dev serves from /
});

test('token is appended to the existing fragment', () => {
  assert.equal(withParams('https://a.io/x#taxon=5', { token: 't' }), 'https://a.io/x#taxon=5&token=t');
});

test('pkce challenge is the S256 of a stable verifier', async () => {
  const v = await pkceVerifier(K, 'n1');
  assert.equal(v, await pkceVerifier(K, 'n1'));
  assert.notEqual(v, await pkceVerifier(K, 'n2'));
  assert.equal(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'); // RFC 7636 appendix B
});
