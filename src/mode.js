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

// True when the outer ring's handles would overlap at this zoom, so draw.js hides them.
export const crowded = (f, project) => { const r = f?.geometry?.coordinates?.[0]; return !!r && medianGap(r, project) < MIN_GAP; };

// True when two edges of a polygon's rings properly cross, within a ring or across rings (touching is allowed). shortcut: O(n²) over all edges, fine for ~2k vertices, use a sweep if ranges grow past ~10k.
export function crosses(rings) {
  const o = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  const e = rings.flatMap((r, k) => r.slice(1).map((q, i) => [r[i], q, k, i, r.length - 1]));
  for (let x = 0; x < e.length; x++) for (let y = x + 1; y < e.length; y++) {
    const [a, b, k, i, n] = e[x], [c, d, l, j] = e[y];
    if (k === l && (j - i === 1 || (i === 0 && j === n - 1))) continue; // neighbours share a corner
    if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) < Math.min(a[0], b[0])) continue; // cheap x-overlap reject
    if (o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0) return true;
  }
  return false;
}

// Status line after selecting a shape: name only the drags that work at this zoom.
export const selectSay = (f, project) => `Shape selected. ${crowded(f, project) ? 'Drag the shape to move it, zoom in to drag single corner points' : 'Drag a corner point to reshape, drag the shape to move it'}, or press Delete.`;

// Patch-mode addition to the tool hint: the base range and community ranges are not in the editor, so clicking them selects nothing.
export const patchHint = m => m === 'select' ? ' In patch mode only shapes you added with Add area, Cut area or Polygon can be selected; the range itself cannot. To reshape a community range, use its Copy & edit.'
  : m === 'polygon' || m === 'freehand' ? ' In patch mode, shapes you draw are added to the official range. Use Cut area to remove.' : '';

// Extra hint for a selected polygon feature: hidden handles at this zoom, and holes that cannot be dragged.
export function editHint(f, project) {
  const rings = f?.geometry?.coordinates ?? [], out = [];
  if (crowded(f, project)) out.push('Corner points are hidden at this zoom: zoom in to drag single points; dragging now moves the whole shape.');
  if (crosses(rings)) out.push('A border now crosses itself or another border (outer edge or hole), so this range cannot be proposed: press Undo or drag the point back.');
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
