import test from 'node:test';
import assert from 'node:assert/strict';
import { modeLabel, medianGap, crowded, editHint } from '../src/mode.js';

const px = s => ([x, y]) => ({ x: x * s, y: y * s });
const ring = (n, step) => Array.from({ length: n }, (_, i) => [i * step, 0]);
const poly = (...rings) => ({ geometry: { type: 'Polygon', coordinates: rings } });

test('modeLabel names what the editor holds', () => {
  assert.equal(modeLabel({ copy: null, patch: null }, 0), '');
  assert.equal(modeLabel({ copy: null, patch: null }, 2), 'your drawing');
  assert.equal(modeLabel({ copy: { derived: { by: 'USGS GAP', created: '2018-08-15' } } }, 3), 'copy of USGS GAP, 2018-08-15');
  assert.equal(modeLabel({ patch: { base: 'some-slug' } }, 0), 'patch on official range');
  assert.equal(modeLabel({ patch: { base: 'inat-123-v1-2' } }, 0), 'patch on iNaturalist range');
});

test('medianGap is the median screen spacing, Infinity for fewer than 2 points', () => {
  assert.equal(medianGap(ring(5, 3), px(1)), 3);
  assert.equal(medianGap([[0, 0]], px(1)), Infinity);
  assert.equal(medianGap([], px(1)), Infinity);
});

test('editHint warns about crowded handles and holes', () => {
  assert.match(editHint(poly(ring(10, 1)), px(2)), /zoom in/); // 2 px apart
  assert.equal(editHint(poly(ring(10, 1)), px(20)), '');
  assert.match(editHint(poly(ring(10, 10), ring(4, 1)), px(20)), /Hole edges/);
  assert.match(editHint(poly(ring(10, 1), ring(4, 1)), px(2)), /zoom in.*Hole edges/);
  assert.equal(editHint(null, px(1)), '');
});

test('crowded is true only when the outer ring gap is under the handle threshold', () => {
  assert.equal(crowded(poly(ring(10, 1)), px(2)), true);
  assert.equal(crowded(poly(ring(10, 1)), px(20)), false);
  assert.equal(crowded(null, px(1)), false);
  assert.equal(crowded(poly(), px(1)), false);
});
