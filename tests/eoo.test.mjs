import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eoo, aoo } from '../src/eoo.js';

const poly = ring => ({ geometry: { type: 'Polygon', coordinates: [ring] } });

test('EOO: 1 degree square at the equator is about 12364 km2 (within 1%)', () => {
  const a = eoo([poly([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]])]);
  assert.ok(Math.abs(a - 12364) / 12364 < 0.01, a);
});

test('EOO: hull spans several polygons; 10x10 km box at 45N within 1%', () => {
  const dLat = 10 / 111.195, dLon = 10 / (111.195 * Math.cos(45 * Math.PI / 180));
  const box = (x, y) => poly([[x, y], [x + dLon / 2, y], [x + dLon / 2, y + dLat], [x, y + dLat], [x, y]]);
  const a = eoo([box(10, 45), box(10 + dLon / 2, 45)]);
  assert.ok(Math.abs(a - 100) / 100 < 0.01, a);
});

test('EOO: empty and degenerate input give null', () => {
  assert.equal(eoo([]), null);
  assert.equal(eoo([{ geometry: { type: 'Point', coordinates: [0, 0] } }]), null);
  assert.equal(eoo([poly([[0, 0], [0, 0], [0, 0], [0, 0]])]), null);
});

test('AOO: duplicates share a cell, distant points add 4 km2 each, empty is null', () => {
  assert.equal(aoo([[10, 10], [10, 10], [10, 10]]), 4);
  assert.equal(aoo([[10, 10], [11, 10]]), 8);
  assert.equal(aoo([]), null);
});

test('EOO: polygons with presence code 3-6 are excluded, 1-2 kept', () => {
  const a = { id: 'a', ...poly([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]) }, b = { id: 'b', ...poly([[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]) };
  const full = eoo([a, b]), only = eoo([a]);
  assert.ok(full > only * 2);
  for (const c of [3, 4, 5, 6, '6']) assert.equal(eoo([a, b], f => (f.id === 'b' ? c : 1)), only);
  assert.equal(eoo([a, b], f => (f.id === 'b' ? 2 : 1)), full);
  assert.equal(eoo([a], () => 3), null);
});

test('AOO: with features, only points inside presence 1-2 polygons count', () => {
  const a = { id: 'a', ...poly([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]) }, b = { id: 'b', ...poly([[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]) };
  const pts = [[0.5, 0.5], [5.5, 5.5], [9, 9]];
  assert.equal(aoo(pts), 12);
  assert.equal(aoo(pts, [a, b], f => 1), 8);
  assert.equal(aoo(pts, [a, b], f => (f.id === 'b' ? 5 : 1)), 4);
  assert.equal(aoo(pts, [a], () => 5), null);
});
