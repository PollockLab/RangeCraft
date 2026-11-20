// Add area / Cut area wiring: applies a finished sketch to the drawn range, with one-step undo. Geometry is in reshape.js.
import polygonClipping from 'https://cdn.jsdelivr.net/npm/polygon-clipping@0.15.7/+esm';
import { reshape } from './reshape.js';

const $ = id => document.getElementById(id);
const CUT_OFF = 'Copy a range first (Edit a copy) or draw one';

export function initReshape({ draw, say }) {
  let prev = null; // FeatureCollection of the polygons before the last Add or Cut; any other change to the drawing clears it
  let busy = false; // true while we replace the drawing ourselves, so that does not clear prev
  const showUndo = () => { $('t-undo').hidden = !prev; };
  $('t-undo').addEventListener('click', () => {
    if (!prev) return;
    busy = true;
    try { draw().load(prev); say('Undone.'); } catch (e) { say(e.message); }
    busy = false;
    prev = null;
    showUndo();
  });
  return {
    // n = number of drawn polygons: Cut needs something to cut from.
    sync(n) { if (!busy) this.reset(); $('t-cut').disabled = !n; $('t-cut').title = n ? 'Cut area: sketch a freehand shape to remove from the range' : CUT_OFF; },
    reset() { if (busy) return; prev = null; showUndo(); },
    apply(op, sketch) {
      const d = draw(), before = { type: 'FeatureCollection', features: d.all() };
      let next;
      try { next = reshape(op, before.features.map(f => f.geometry), sketch, polygonClipping); } catch (e) { say(`Could not ${op} that area: ${e.message}`); return; }
      busy = true;
      try { d.load({ type: 'FeatureCollection', features: next.map(geometry => ({ type: 'Feature', geometry, properties: {} })) }); prev = before; }
      catch (e) { say(`Could not ${op} that area: ${/holes/.test(e.message) ? 'the editor cannot hold a hole, so sketch across the edge of the range instead' : e.message}`); d.load(before); }
      busy = false;
      if (prev === before) say(op === 'add' ? 'Area added.' : next.length ? 'Area cut.' : 'Everything was cut. Undo to get it back.');
      showUndo();
    },
  };
}
