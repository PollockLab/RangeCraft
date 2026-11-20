import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, toPatch } from '../src/patch.js';
import { areaKm2, multi } from '../src/diff.js';

const real = await import(process.env.PC_MODULE ?? 'polygon-clipping').then(m => m.default, () => null);
const skip = !real && 'polygon-clipping not installed';
const sq = (x, y, s) => ({ type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] });
const fc = (...gs) => ({ type: 'FeatureCollection', features: gs.map(geometry => ({ type: 'Feature', properties: {}, geometry })) });
const meta = { taxonKey: '1', scientificName: 'X y', author: 'A', sources: 's', base: 'slug' };
const area = c => areaKm2(c);

test('toPatch: only the user shapes, op per feature, pointer to the base, parent defaults to base', () => {
  const p = toPatch([{ op: 'add', geometry: sq(5, 5, 1) }, { op: 'cut', geometry: sq(0, 0, 1) }], { ...meta, message: 'why' });
  assert.deepEqual(p.features.map(f => f.properties), [{ op: 'add' }, { op: 'cut' }]);
  assert.equal(p.properties.basis, 'official-patch');
  assert.equal(p.properties.parent, 'slug');
  assert.equal(p.properties.message, 'why');
  assert.equal(toPatch([], { ...meta, parent: 'data/ranges/1/a.geojson' }).properties.parent, 'data/ranges/1/a.geojson');
});

test('output file has no base vertices', () => {
  const base = fc(sq(100, 40, 3)), shapes = [{ op: 'add', geometry: sq(0, 0, 1) }, { op: 'cut', geometry: sq(101, 41, 1) }];
  const text = JSON.stringify(toPatch(shapes, meta));
  for (const [x, y] of base.features[0].geometry.coordinates[0]) assert.ok(!text.includes(`[${x},${y}]`));
});

test('applyPatch: empty patch is the base; add grows; cut shrinks; cut outside is a no-op; adds apply before cuts', { skip }, () => {
  const base = fc(sq(0, 0, 2)), a0 = area(multi(base));
  const patch = (...fs) => ({ features: fs.map(([op, geometry]) => ({ properties: { op }, geometry })) });
  assert.ok(Math.abs(area(applyPatch(base, patch(), real)) - a0) < 1);
  assert.ok(area(applyPatch(base, patch(['add', sq(5, 0, 1)]), real)) > a0 + 10000);
  assert.ok(area(applyPatch(base, patch(['cut', sq(0, 0, 1)]), real)) < a0 - 10000);
  assert.ok(Math.abs(area(applyPatch(base, patch(['cut', sq(50, 50, 1)]), real)) - a0) < 1);
  // a cut over an added shape removes it, whatever the order in the file
  assert.ok(Math.abs(area(applyPatch(base, patch(['cut', sq(5, 0, 1)], ['add', sq(5, 0, 1)]), real)) - a0) < 1);
  assert.deepEqual(applyPatch(fc(), patch(['cut', sq(0, 0, 1)]), real), []);
});
