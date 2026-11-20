import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reshape, polygonArea, totalArea } from '../src/reshape.js';

const sq = (x, y, s) => ({ type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] });
const area = gs => gs.reduce((s, g) => s + polygonArea(g.coordinates), 0);
// PC_MODULE lets the gate point at a scratch install: npm i --no-save polygon-clipping@0.15.7
const real = await import(process.env.PC_MODULE ?? 'polygon-clipping').then(m => m.default, () => null);

test('stub clip: add unions all current polygons with the sketch', () => {
  const calls = [];
  const clip = { union: (...a) => { calls.push(a); return [sq(0, 0, 1).coordinates]; }, difference: () => assert.fail('not used') };
  assert.equal(reshape('add', [sq(0, 0, 1), sq(5, 5, 1)], sq(1, 1, 1), clip).length, 1);
  assert.equal(calls[0].length, 3);
});

test('stub clip: slivers under the threshold are dropped', () => {
  const clip = { union: () => [sq(0, 0, 1).coordinates, sq(9, 9, 0.0001).coordinates] };
  assert.equal(reshape('add', [], sq(0, 0, 1), clip).length, 1);
});

test('empty current: add is the sketch, cut does nothing and never calls clip', () => {
  const clip = { union: (...a) => [a[0]], difference: () => assert.fail('no clip') };
  assert.deepEqual(reshape('add', [], sq(0, 0, 1), clip), [sq(0, 0, 1)]);
  assert.deepEqual(reshape('cut', [], sq(0, 0, 1), clip), []);
});

test('real clip: add grows, cut shrinks, cut inside keeps a hole, cut all empties', { skip: !real && 'polygon-clipping not installed' }, () => {
  const base = [sq(0, 0, 10)];
  assert.equal(area(reshape('add', base, sq(8, 0, 10), real)), 180);
  assert.equal(area(reshape('cut', base, sq(8, 0, 10), real)), 80);
  const holed = reshape('cut', base, sq(3, 3, 2), real);
  assert.equal(holed.length, 1);
  assert.equal(holed[0].coordinates.length, 2);
  assert.equal(area(holed), 96);
  assert.deepEqual(reshape('cut', base, sq(-1, -1, 12), real), []);
  assert.equal(area(reshape('add', base, sq(20, 20, 1), real)), 101);
});

test('totalArea sums parts and subtracts holes; empty is 0', () => {
  const holed = { type: 'Polygon', coordinates: [...sq(0, 0, 10).coordinates, ...sq(3, 3, 2).coordinates] };
  assert.equal(totalArea([holed, sq(20, 20, 1)]), 97);
  assert.equal(totalArea([]), 0);
});

test('carryCodes: codes follow the overlapped polygon; mixed codes reset; untouched sketch gets none', { skip: !real && 'polygon-clipping not installed' }, async () => {
  const { carryCodes } = await import('../src/reshape.js');
  const f = (g, iucn) => ({ geometry: g, properties: iucn ? { iucn } : {} }), ext = { PRESENCE: '5' };
  const before = [f(sq(0, 0, 10), ext), f(sq(20, 0, 10))];
  // cut a corner of the first polygon: it keeps its codes
  assert.deepEqual(carryCodes(before, reshape('cut', [before[0].geometry], sq(8, 8, 5), real), real), { codes: [ext], reset: false });
  // add a separate sketch: existing codes stay, the new polygon has none
  const sep = reshape('add', before.map(b => b.geometry), sq(50, 0, 5), real);
  assert.equal(carryCodes(before, sep, real).reset, false);
  assert.equal(carryCodes(before, sep, real).codes.filter(Boolean).length, 1);
  // a sketch bridging a coded and an uncoded polygon merges them: ambiguous
  const merged = reshape('add', before.map(b => b.geometry), { type: 'Polygon', coordinates: [[[9, 2], [21, 2], [21, 4], [9, 4], [9, 2]]] }, real);
  assert.deepEqual(carryCodes(before, merged, real), { codes: [undefined], reset: true });
  assert.deepEqual(carryCodes([], merged, real), { codes: [undefined], reset: false });
});
