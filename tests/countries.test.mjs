import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countriesIn } from '../src/countries.js';

const real = await import(process.env.PC_MODULE ?? 'polygon-clipping').then(m => m.default, () => null);
const sq = (x, y, s = 1) => [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]];
const f = (coordinates, props = {}) => ({ properties: props, geometry: { type: 'Polygon', coordinates } });
const countries = { features: [f(sq(0, 0), { NAME: 'B-land', ISO_A2: 'BB' }), f(sq(1, 0), { NAME: 'A-land', ISO_A2: 'AA' }), f(sq(5, 5), { NAME: 'Far', ISO_A2: 'FF' })] };
const skip = !real && 'polygon-clipping not installed';

test('countriesIn: range over a shared border lists both, sorted by name; far country excluded', { skip }, () => {
  assert.deepEqual(countriesIn([f(sq(0.8, 0.2, 0.4))], countries, () => 1, real.intersection), [{ name: 'A-land', iso: 'AA' }, { name: 'B-land', iso: 'BB' }]);
});

test('countriesIn: presence 3-6 polygons ignored; empty drawing gives []', { skip }, () => {
  const mixed = [f(sq(0.2, 0.2, 0.4), { PRESENCE: 1 }), f(sq(1.2, 0.2, 0.4), { PRESENCE: 4 })];
  assert.deepEqual(countriesIn(mixed, countries, x => x.properties.PRESENCE, real.intersection).map(c => c.iso), ['BB']);
  assert.deepEqual(countriesIn([], countries, () => 1, real.intersection), []);
});
