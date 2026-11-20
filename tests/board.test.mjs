import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingContributors } from '../src/board.js';

const res = body => ({ json: async () => body });
const get = routes => async url => { for (const [k, v] of Object.entries(routes)) if (url.includes(k)) { if (v instanceof Error) throw v; return res(v); } throw new Error(url); };

test('pending: only open PRs touching data/ranges/', async () => {
  const p = await pendingContributors(10, get({
    '?state=open': [{ number: 2, user: { login: 'b' }, html_url: 'u2' }, { number: 1, user: { login: 'a' }, html_url: 'u1' }],
    '/pulls/1/files': [{ filename: 'data/ranges/1/a.geojson' }], '/pulls/2/files': [{ filename: 'README.md' }] }));
  assert.deepEqual(p, [{ login: 'a', url: 'u1', number: 1 }]);
});

test('pending: caps the PRs inspected and fails silently', async () => {
  const seen = [];
  const prs = Array.from({ length: 5 }, (_, i) => ({ number: i + 1, user: { login: 'x' }, html_url: '' }));
  await pendingContributors(2, async url => { seen.push(url); return res(url.includes('/files') ? [] : prs); });
  assert.equal(seen.length, 3);
  assert.deepEqual(await pendingContributors(10, get({ '?state=open': new Error('offline') })), []);
  assert.deepEqual(await pendingContributors(10, get({ '?state=open': { message: 'rate limited' } })), []);
});
