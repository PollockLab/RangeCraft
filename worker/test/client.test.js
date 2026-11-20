import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { sign } from '../src/token.js';

const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const def = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
const relay = await import('../../src/relay.js');
const K = 'k'.repeat(32);
const tok = cn => sign(K, 'session', { provider: 'github', id: '1', name: 'A', verified: true, cn }, 600);

beforeEach(() => {
  relay.signOut();
  def('localStorage', mem()); def('sessionStorage', mem());
  def('history', { replaceState: (_, __, u) => { globalThis.location.hash = u.includes('#') ? u.slice(u.indexOf('#')) : ''; } });
  def('location', { hash: '', pathname: '/rangecraft/', search: '', href: 'https://pollocklab.github.io/rangecraft/' });
});

test('a token minted for this browser nonce is accepted and the fragment is cleaned', async () => {
  const n = relay.startNonce();
  location.hash = `#taxon=5&token=${await tok(n)}`;
  assert.equal(relay.takeSession(), null);
  assert.equal(relay.session().name, 'A');
  assert.equal(location.hash, '#taxon=5');
  assert.equal(localStorage.getItem('rc-nonce'), null); // single use
});

test('login CSRF: a token without our nonce, or with another one, is discarded', async () => {
  relay.startNonce();
  for (const cn of [undefined, 'attacker-nonce-123']) {
    location.hash = `#token=${await tok(cn)}`;
    assert.equal(relay.takeSession(), 'foreign_token');
    assert.equal(relay.session(), null);
  }
  assert.ok(localStorage.getItem('rc-nonce')); // a forged link does not burn the real attempt
});

test('no nonce started at all: any token is discarded', async () => {
  location.hash = `#token=${await tok('abcdefgh12345678')}`;
  assert.equal(relay.takeSession(), 'foreign_token');
  assert.equal(relay.session(), null);
});

test('sign-in URL carries a fresh nonce', () => {
  const a = new URL(relay.signInUrl('github'), 'https://relay.test').searchParams.get('cn');
  assert.match(a, /^[A-Za-z0-9_-]{16,}$/);
  assert.equal(localStorage.getItem('rc-nonce'), a);
});
