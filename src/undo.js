// Bounded undo/redo stack of drawing snapshots. Pure: draw.js decides when to record and how to restore.
// items[at] is the current state; record() drops any redo tail and ignores a snapshot equal to the current one.
export function createUndo(limit = 50) {
  let items = [], at = -1;
  return {
    reset(snap) { items = [snap]; at = 0; },
    record(snap) {
      if (at >= 0 && JSON.stringify(items[at]) === JSON.stringify(snap)) return false;
      items = [...items.slice(0, at + 1), snap].slice(-(limit + 1));
      at = items.length - 1;
      return true;
    },
    canUndo: () => at > 0,
    canRedo: () => at >= 0 && at < items.length - 1,
    undo() { return at > 0 ? items[--at] : null; },
    redo() { return at >= 0 && at < items.length - 1 ? items[++at] : null; },
  };
}
