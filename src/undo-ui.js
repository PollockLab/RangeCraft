// Undo/Redo toolbar buttons and shortcuts for the drawing (stack in undo.js, snapshots in draw.js). Returns sync(), called after any drawing change.
const OFF = 'Not available while editing a patch (it keeps its own add/cut shapes)';

export function initUndoUi({ $, draw, patch, say }) {
  const sync = () => {
    const d = draw(), off = patch.active();
    for (const [id, can, tip] of [['h-undo', d?.canUndo(), 'Undo (Ctrl+Z)'], ['h-redo', d?.canRedo(), 'Redo (Ctrl+Shift+Z)']]) {
      $(id).disabled = !can || off;
      $(id).title = off ? OFF : tip;
    }
  };
  const act = name => {
    if (patch.active() || !draw()?.[name]()) return;
    say(name === 'undo' ? 'Undone.' : 'Redone.');
  };
  $('h-undo').addEventListener('click', () => act('undo'));
  $('h-redo').addEventListener('click', () => act('redo'));
  addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    const k = e.key.toLowerCase(), name = k === 'z' ? (e.shiftKey ? 'redo' : 'undo') : k === 'y' ? 'redo' : null;
    if (name) { e.preventDefault(); act(name); }
  });
  return sync;
}
