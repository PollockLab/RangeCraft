import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bbox, inside, pickZoom, addTile, binSize, classify, summaryLine, gbifCellUrl, inatCellUrl } from '../src/rangecheck.js';

const sq = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
const fc = (...rings) => ({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: rings } }] });

test('bbox and point-in-range respect holes', () => {
  const r = fc(sq(0, 0, 10, 10), sq(4, 4, 6, 6));
  assert.deepEqual(bbox(r), [0, 0, 10, 10]);
  const t = inside(r);
  assert.ok(t(1, 1)); assert.ok(!t(5, 5)); assert.ok(!t(11, 1));
  assert.equal(bbox({ features: [] }), null);
});

test('zoom: finest that fits the request and cell budgets', () => {
  const small = pickZoom([-80, 40, -75, 45]);
  assert.equal(small.z, 4);
  assert.ok(small.tiles.length <= 64);
  const big = pickZoom([-170, 25, -50, 70]);
  assert.ok(big.z < 4 && big.tiles.length <= 64);
  assert.equal(pickZoom([-179, -80, 179, 80]).z, 2);
});

test('addTile bins squares at native resolution', () => {
  const counts = new Map(); // tile 2/2/1: lon -90..-45, lat 45..0; its centre (2048,2048) is -67.5, 22.5
  addTile(counts, { z: 2, x: 2, y: 1 }, [{ x: 2048, y: 2048, props: { total: 7 } }, { x: 2048, y: 2048, props: { total: 1 } }]);
  assert.equal(counts.size, 1);
  const size = binSize(2), [k, n] = [...counts][0], [i, j] = k.split(',').map(Number);
  assert.equal(n, 8);
  assert.ok(Math.abs(-180 + (i + 0.5) * size + 67.5) <= size / 2 && Math.abs(90 - (j + 0.5) * size - 22.5) <= size / 2);
});

// Range: lon 0..10, lat 80..90 with 2-degree bins. Bin (i, j) has centre (2i + 1 - 180, 90 - 2j - 1).
const range = fc(sq(0, 80, 10, 90));
const key = (lon, lat) => `${Math.floor((lon + 180) / 2)},${Math.floor((90 - lat) / 2)}`;

test('classify: outside, gap, confirmed at native bins', () => {
  const counts = new Map([[key(1, 89), 5], [key(21, 89), 15], [key(23, 89), 1]]);
  const r = classify(counts, range, 2);
  assert.equal(r.confirmed, 1);
  assert.equal(r.gaps, 24); // 5 x 5 bins in range, 1 has records
  assert.deepEqual(r.cells.filter(c => c.status === 'outside').map(c => c.count), [15, 1]);
  assert.equal(r.total, 21);
  assert.ok(Math.abs(r.outsidePct - (100 * 16) / 21) < 1e-9);
  assert.ok(Math.abs(r.gapPct - (100 * 24) / 25) < 1e-9);
  assert.equal(summaryLine(r), '76% of records fall outside this range; 96% of the range has no records');
});

test('outsideMin hides stray bins from the map but not from the summary', () => {
  const counts = new Map([[key(1, 89), 5], [key(21, 89), 15], [key(23, 89), 1]]);
  const r = classify(counts, range, 2, { outsideMin: 3 });
  assert.deepEqual(r.cells.filter(c => c.status === 'outside').map(c => c.count), [15]);
  assert.ok(Math.abs(r.outsidePct - (100 * 16) / 21) < 1e-9);
});

test('no records at all', () => {
  const r = classify(new Map(), range, 2);
  assert.equal(r.outsidePct, 0);
  assert.equal(r.gapPct, 100);
  assert.match(summaryLine(r), /No GBIF records/);
});

test('area links', () => {
  const c = { w: -80, s: 40, e: -75, n: 45 };
  assert.match(inatCellUrl('Lithobates sylvaticus', c), /taxon_name=Lithobates%20sylvaticus&swlat=40&swlng=-80&nelat=45&nelng=-75/);
  assert.match(gbifCellUrl(2427072, c), /taxon_key=2427072&geometry=POLYGON/);
});
