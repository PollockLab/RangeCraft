import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUndo } from '../src/undo.js';

test('empty stack has nothing to undo or redo', () => {
  const u = createUndo();
  assert.equal(u.canUndo(), false); assert.equal(u.canRedo(), false);
  assert.equal(u.undo(), null); assert.equal(u.redo(), null);
});

test('undo and redo walk the recorded states', () => {
  const u = createUndo(); u.reset([]);
  u.record(['a']); u.record(['a', 'b']);
  assert.deepEqual(u.undo(), ['a']); assert.deepEqual(u.undo(), []); assert.equal(u.undo(), null);
  assert.deepEqual(u.redo(), ['a']); assert.equal(u.canRedo(), true);
});

test('recording after an undo drops the redo tail; equal snapshots are ignored', () => {
  const u = createUndo(); u.reset([]);
  u.record(['a']); u.undo();
  assert.equal(u.record([]), false);
  assert.equal(u.record(['c']), true);
  assert.equal(u.canRedo(), false);
});

test('stack is bounded to the limit', () => {
  const u = createUndo(3); u.reset(0);
  for (let i = 1; i <= 10; i++) u.record(i);
  let n = 0; while (u.undo() !== null) n++;
  assert.equal(n, 3);
});
