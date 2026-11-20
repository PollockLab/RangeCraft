import test from 'node:test';
import assert from 'node:assert/strict';
import { modeLabel, medianGap, crowded, editHint, crosses, selectSay, patchHint } from '../src/mode.js';

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
  assert.match(editHint(poly([[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], [[3, 1], [5, 2], [3, 3], [3, 1]]), px(20)), /crosses itself or another border/);
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

test('crosses: bowtie crosses, square and touching hole-free rings do not', () => {
  assert.equal(crosses([[[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]]), true);
  assert.equal(crosses([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]), false);
  assert.equal(crosses([[[0, 0], [2, 0], [1, 1], [2, 2], [0, 2], [1, 1], [0, 0]]]), false); // touches at (1,1), no crossing
});

test('crosses: holes crossing the outer ring or each other cross, touching does not', () => {
  const sq = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
  assert.equal(crosses([sq, [[1, 1], [2, 1], [2, 2], [1, 1]]]), false); // inside
  assert.equal(crosses([sq, [[3, 1], [5, 2], [3, 3], [3, 1]]]), true); // pokes through the right side
  assert.equal(crosses([sq, [[4, 2], [3, 1], [3, 3], [4, 2]]]), false); // touches the outer ring at (4,2)
  assert.equal(crosses([sq, [[1, 1], [2, 1], [2, 2], [1, 1]], [[1.5, 0.5], [1.8, 1.5], [1.2, 1.5], [1.5, 0.5]]]), true); // two holes cross
});

test('selectSay names only the drags that work at this zoom', () => {
  const f = { geometry: { coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } };
  assert.match(selectSay(f, ([x, y]) => ({ x: x * 100, y: y * 100 })), /Drag a corner point/);
  assert.match(selectSay(f, ([x, y]) => ({ x, y })), /zoom in to drag single corner points/);
});

test('patchHint explains that only patch shapes are selectable', () => {
  assert.match(patchHint('select'), /only shapes you added/);
  assert.match(patchHint('polygon'), /added to the official range/);
  assert.equal(patchHint('add'), '');
});
