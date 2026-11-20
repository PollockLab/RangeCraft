import { test } from 'node:test';
import assert from 'node:assert/strict';
import { citeLine, addLines, fetchCites } from '../src/cite.js';

const o = { key: 1234567, basisOfRecord: 'PRESERVED_SPECIMEN', year: 2019, institutionCode: 'MCZ', catalogNumber: 'A-1234' };

test('citeLine formats and tolerates missing fields', () => {
  assert.equal(citeLine(o), 'GBIF occurrence 1234567 (PRESERVED_SPECIMEN, 2019, catalogue MCZ:A-1234) https://www.gbif.org/occurrence/1234567');
  assert.equal(citeLine({ key: 9, basisOfRecord: 'HUMAN_OBSERVATION' }), 'GBIF occurrence 9 (HUMAN_OBSERVATION) https://www.gbif.org/occurrence/9');
});

test('addLines appends, dedupes and handles empty text', () => {
  const a = citeLine(o), b = citeLine({ key: 2 });
  assert.deepEqual(addLines('', [a, a]), { text: a, added: 1 });
  const r = addLines(`my notes\n`, [a, b]);
  assert.equal(r.text, `my notes\n${a}\n${b}`); assert.equal(r.added, 2);
  assert.deepEqual(addLines(r.text, [a, b]), { text: r.text, added: 0 });
  assert.equal(addLines('see https://www.gbif.org/occurrence/1234567', [a]).added, 0);
});

test('fetchCites falls back without basisOfRecord and surfaces HTTP errors', async () => {
  const urls = [], mk = res => async u => (urls.push(u), res(u));
  const c = { w: 0, s: 1, e: 2, n: 3 };
  const lines = await fetchCites(5, c, mk(u => ({ ok: true, json: async () => ({ results: u.includes('basisOfRecord') ? [] : [o] }) })));
  assert.equal(lines.length, 1); assert.equal(urls.length, 2);
  assert.ok(urls[0].includes('taxonKey=5') && urls[0].includes('limit=5') && urls[0].includes('basisOfRecord=PRESERVED_SPECIMEN') && !urls[1].includes('basisOfRecord'));
  await assert.rejects(fetchCites(5, c, async () => ({ ok: false, status: 500 })), /GBIF 500/);
});

test('fetchCites applies the records filter', async () => {
  const urls = [], f = async u => (urls.push(u), { ok: true, json: async () => ({ results: [] }) });
  const c = { w: 0, s: 1, e: 2, n: 3 };
  await fetchCites(5, c, f, 'specimens');
  assert.equal(urls.length, 1); assert.ok(urls[0].includes('basisOfRecord=PRESERVED_SPECIMEN'));
  urls.length = 0; await fetchCites(5, c, f, 'since2000');
  assert.ok(urls.length === 2 && urls.every(u => /year=2000,\d{4}/.test(u)));
});
