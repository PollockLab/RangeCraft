// What the editor is holding, and what the selected shape can do at this zoom. Pure helpers; app.js wires them to the DOM.
import { parseInatSlug } from './inat.js';

const MIN_GAP = 8; // px between neighbouring vertex handles below which they cannot be grabbed one by one

// "copy of USGS GAP, 2018-08-15" / "patch on official range" / "your drawing" / '' when the editor is empty.
export function modeLabel({ copy, patch }, shapes) {
  if (patch) return `patch on ${parseInatSlug(patch.base) ? 'iNaturalist' : 'official'} range`;
  if (copy) return `copy of ${copy.derived.by}, ${copy.derived.created}`;
  return shapes ? 'your drawing' : '';
}

// Median on-screen distance between consecutive vertices of a ring; project maps [lng, lat] to {x, y}.
export function medianGap(ring, project) {
  const p = ring.map(project), d = p.slice(1).map((q, i) => Math.hypot(q.x - p[i].x, q.y - p[i].y)).sort((a, b) => a - b);
  return d.length ? d[d.length >> 1] : Infinity;
}

// Extra hint for a selected polygon feature: crowded handles at this zoom, and holes that cannot be dragged.
export function editHint(f, project) {
  const rings = f?.geometry?.coordinates ?? [], out = [];
  if (rings[0] && medianGap(rings[0], project) < MIN_GAP) out.push('Zoom in to drag single points; at this zoom drag moves the whole shape.');
  if (rings.length > 1) out.push('Hole edges cannot be dragged; use Add area or Cut area.');
  return out.join(' ');
}

// Refresh the "Editing: ..." indicator (n = finished shapes), its Stop button, and the community-row Edit buttons.
export function syncMode($, state, n) {
  const label = modeLabel(state, n);
  $('mode').textContent = label && `Editing: ${label}`;
  $('mode-stop').hidden = !state.patch; // Stop reuses the patch exit button
  for (const b of document.querySelectorAll('#versions button.edit[data-copy]')) copyBtn(b, !!state.patch);
}

// Community-row Edit button: in patch mode it leaves the patch and copies that range, so say so.
export function copyBtn(b, inPatch) {
  b.textContent = inPatch ? 'Copy & edit' : 'Edit';
  b.title = `Edit a copy of this range. Your version is saved as a new revision linked to this one; the original stays.${inPatch ? ' This stops patch editing (unsaved patch shapes are lost).' : ''}`;
}
