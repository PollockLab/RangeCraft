import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parentOf, buildGraph, log, byAuthor } from '../src/lineage.js';
import { areaKm2, revisionDiff, changeText } from '../src/diff.js';
import { buildCollection } from '../src/export.js';

const real = await import(process.env.PC_MODULE ?? 'polygon-clipping').then(m => m.default, () => null);
const r = (id, parent, extra = {}) => ({ id, file: `data/ranges/1/${id}.geojson`, author: 'a', created: '2025-01-01', ...(parent && { parent: `data/ranges/1/${parent}.geojson` }), ...extra });
const sq = (x, y, s) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] } });
const fc = (...features) => ({ type: 'FeatureCollection', features });

test('parentOf: parent wins, legacy derived_from path is parsed, otherwise null', () => {
  assert.equal(parentOf({ parent: 'data/ranges/1/a.geojson', derived_from: 'x, data/ranges/1/b.geojson' }), 'data/ranges/1/a.geojson');
  assert.equal(parentOf({ derived_from: 'Jo 2025-02-03, data/ranges/1/b-1.geojson' }), 'data/ranges/1/b-1.geojson');
  for (const p of [{}, null, { derived_from: 'USGS GAP' }, { parent: null, derived_from: 'Jo 2025-02-03' }]) assert.equal(parentOf(p), null);
});

test('buildGraph and log: chain oldest first, missing parent is a root, fork has two children', () => {
  const g = buildGraph([r('c', 'b', { created: '2025-03-01' }), r('b', 'a', { created: '2025-02-01' }), r('a'), r('d', 'a', { created: '2025-04-01' }), r('o', 'gone')]);
  assert.deepEqual(log(g, 'c').map(n => n.range.id), ['a', 'b', 'c']);
  assert.deepEqual(g.get('a').children.map(n => n.range.id), ['b', 'd']);
  assert.equal(g.get('o').parent, null);
  assert.deepEqual(log(g, 'nope'), []);
});

test('a first patch is a root (no parent path); a later patch points at its file', () => {
  const g = buildGraph([r('p1', null, { basis: 'official-patch' }), r('p2', 'p1', { basis: 'official-patch', created: '2025-02-01' })]);
  assert.equal(g.get('p1').parent, null);
  assert.equal(g.get('p1').range.basis, 'official-patch');
  assert.deepEqual(log(g, 'p2').map(n => n.range.id), ['p1', 'p2']);
});

test('cycles and self-parents are guarded', () => {
  const g = buildGraph([r('a', 'b'), r('b', 'a'), r('s', 's')]);
  assert.deepEqual(log(g, 'a').map(n => n.range.id).sort(), ['a', 'b']);
  assert.deepEqual(log(g, 's').map(n => n.range.id), ['s']);
});

test('byAuthor: per author, chronological, case-insensitive', () => {
  const m = byAuthor([r('x', null, { author: 'Ann', created: '2025-05-01' }), r('y', null, { author: 'ann', created: '2025-01-01' }), r('z', null, { author: 'Bo' })]);
  assert.deepEqual(m.get('ann').map(x => x.id), ['y', 'x']);
  assert.equal(m.size, 2);
});

test('buildCollection records the parent path next to derived_from; new drawings have none', () => {
  const meta = { taxonKey: '1', scientificName: 'X y', author: 'A', sources: 's' }, f = [{ geometry: sq(0, 0, 1).geometry }];
  const d = buildCollection(f, { ...meta, derived: { by: 'B', created: '2025-01-01', file: 'data/ranges/1/b.geojson' } }).properties;
  assert.equal(d.parent, 'data/ranges/1/b.geojson');
  assert.match(d.derived_from, /data\/ranges\/1\/b\.geojson$/);
  assert.equal('parent' in buildCollection(f, meta).properties, false);
});

test('areaKm2: one degree cell at the equator is about 12,364 km2; empty is 0', () => {
  assert.ok(Math.abs(areaKm2([sq(0, 0, 1).geometry.coordinates]) - 12364) < 30);
  assert.equal(areaKm2([]), 0);
});

test('revisionDiff: added and removed area vs parent; root counts all as added', { skip: !real && 'polygon-clipping not installed' }, () => {
  const d = revisionDiff(fc(sq(0, 0, 2)), fc(sq(1, 0, 2)), real);
  assert.ok(Math.abs(d.addedKm2 - d.removedKm2) < 1 && d.addedKm2 > 20000);
  assert.match(changeText(d), /^\+[\d,]+ km² added, −[\d,]+ km² removed\.$/);
  const root = revisionDiff(null, fc(sq(0, 0, 1)), real);
  assert.equal(root.removedKm2, 0);
  assert.ok(root.addedKm2 > 12000);
  assert.deepEqual(revisionDiff(fc(sq(0, 0, 1)), fc(), real).added, []);
});
