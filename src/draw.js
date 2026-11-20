// Terra Draw wiring: polygon, freehand, add/cut sketch and edit modes on the MapLibre map. The official outline
// is a plain map layer, so it never enters this store.
import { TerraDraw, TerraDrawPolygonMode, TerraDrawFreehandMode, TerraDrawSelectMode, TerraDrawRenderMode } from 'terra-draw';
import { createUndo } from './undo.js';
import { crowded } from './mode.js';
import { TerraDrawMapLibreGLAdapter } from 'https://cdn.jsdelivr.net/npm/terra-draw-maplibre-gl-adapter@1.5.0/dist/terra-draw-maplibre-gl-adapter.module.js';

// Terra Draw's polygon mode hard-codes a "Feature has holes" check. Holes are plain GeoJSON and render and survive vertex edits
// (only the outer ring is editable), so keep the base checks and skip the mode's own.
class HolePolygonMode extends TerraDrawPolygonMode {
  validateFeature(f) { return this.validateModeFeature(f, () => ({ valid: true })); }
}

const touch = matchMedia('(pointer: coarse)').matches;
// Bigger vertex and midpoint handles on touch so they can be grabbed with a finger.
const SELECT_STYLE = { selectionPointWidth: touch ? 12 : 8, midPointWidth: touch ? 10 : 6, selectionPointOutlineWidth: 2 };

export const DRAFT = '#0b3d91'; // dark blue outline so the user's own drawing stands out from the basemap and community ranges
const DRAFT_STYLE = { fillColor: DRAFT, fillOpacity: 0.2, outlineColor: DRAFT, outlineWidth: 3 };
// selfIntersectable: Terra Draw's kink check also flags holes touching the outer ring, which blocked every vertex drag on real ranges.
const EDIT = { feature: { draggable: true, selfIntersectable: true, coordinates: { midpoints: true, draggable: true, deletable: true, snappable: true } } };
const MOVE_ONLY = { feature: { draggable: true } }; // no coordinates flag: Terra Draw creates no vertex or midpoint points, so none can steal a drag

// Flatten a GeoJSON object (FeatureCollection, Feature or geometry) into single Polygon geometries.
export function polygonsOf(gj) {
  return partsOf(gj).map(p => p.geometry);
}
// Same, keeping each feature's IUCN codes (properties.iucn) on every part: [{ geometry, iucn }].
function partsOf(gj) {
  const fs = gj?.type === 'FeatureCollection' ? gj.features : gj?.type === 'Feature' ? [gj] : [{ geometry: gj }];
  return fs.flatMap(f => { const g = f?.geometry, iucn = f?.properties?.iucn; return g?.type === 'Polygon' ? [{ geometry: g, iucn }] : g?.type === 'MultiPolygon' ? g.coordinates.map(coordinates => ({ geometry: { type: 'Polygon', coordinates }, iucn })) : []; });
}

export function initDraw(map, onSelect = () => {}, onChange = () => {}, onSketch = () => {}, onEdit = () => {}, onDrawn = () => {}) {
  const td = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map }),
    modes: [
      new HolePolygonMode({ snapping: { toCoordinate: true }, styles: DRAFT_STYLE }),
      new TerraDrawFreehandMode({ styles: DRAFT_STYLE }),
      new TerraDrawSelectMode({ styles: SELECT_STYLE, flags: { polygon: EDIT, freehand: EDIT } }),
      new TerraDrawRenderMode({ modeName: 'view', styles: {} }),
    ],
  });
  td.start();
  // Terra Draw's layers are added once, so layers added later (GBIF, ranges, outline) would cover its handles: keep them on top.
  const raise = () => {
    const ids = map.getLayersOrder(), mine = ids.filter(id => id.startsWith('td-'));
    if (mine.some((id, i) => id !== ids[ids.length - mine.length + i])) for (const id of mine) map.moveLayer(id);
  };
  map.on('styledata', raise); raise();
  // Dim the GBIF layer (same 0.35 as the range check) while a shape is selected, so handles stay readable.
  const dimOcc = on => map.getLayer('occ') && map.setPaintProperty('occ', 'raster-opacity', on || document.getElementById('rc-toggle')?.checked ? 0.35 : 1);
  let selected = null, swapping = false, hidden = false;
  // Hide handles while crowded; flags are read when a feature is selected, so a selected shape is reselected quietly.
  const setHandles = () => {
    const f = selected != null && td.getSnapshot().find(x => x.id === selected), hide = !!f && crowded(f, c => map.project(c));
    if (hide === hidden) return;
    hidden = hide;
    td.updateModeOptions('select', { flags: { polygon: hide ? MOVE_ONLY : EDIT, freehand: hide ? MOVE_ONLY : EDIT } });
    if (f && td.getMode() === 'select') { swapping = true; td.deselectFeature(f.id); td.selectFeature(f.id); swapping = false; selected = f.id; onSelect(f.id); }
  };
  map.on('zoomend', setHandles);
  td.on('select', id => { if (swapping) return; selected = id; queueMicrotask(setHandles); dimOcc(true); onSelect(id); }); // microtask: select() reads its flags before this fires and builds points after
  td.on('deselect', () => { if (swapping) return; selected = null; dimOcc(false); onSelect(null); });
  // Undo/redo: snapshots of the finished polygons (never helper points), recorded when a change ends.
  const undo = createUndo(50);
  const snap = () => td.getSnapshot().filter(f => f.geometry.type === 'Polygon' && !f.properties.currentlyDrawing)
    .map(({ geometry, properties: { mode, iucn } }) => structuredClone({ geometry, properties: { mode, ...(iucn && { iucn }) } }));
  const restore = s => {
    td.clear(); selected = null; dimOcc(false); onSelect(null);
    td.addFeatures(s.map(f => ({ type: 'Feature', ...structuredClone(f) })));
    onChange();
    return true;
  };
  undo.reset([]);
  // Add/Cut tools draw with the freehand mode; the finished sketch is handed to onSketch(op, polygon) and removed.
  let sketchOp = null;
  td.on('finish', (id, ctx) => {
    if (!sketchOp) { undo.record(snap()); onChange(); if (ctx?.action === 'draw') onDrawn(); return; }
    const f = td.getSnapshot().find(x => x.id === id);
    td.removeFeatures([id]);
    if (f) onSketch(sketchOp, f.geometry);
  });
  // Sketch strokes are not edits of the range; vertex drags (update) go to onEdit, which stays cheap.
  td.on('change', (_ids, type) => { if (!sketchOp) type === 'update' ? onEdit() : onChange(); });
  return {
    // Terra Draw has no finish() API; its modes finish on a keyup of keyEvents.finish (Enter) on the map container.
    // Returns false (and does nothing) while fewer than 3 points are placed: the in-progress ring holds the points, the pointer and the closing vertex.
    finish() {
      const f = td.getSnapshot().find(x => x.properties.currentlyDrawing && x.geometry.type === 'Polygon');
      if (!f || f.geometry.coordinates[0].length < 5) return false;
      map.getCanvas().dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }));
      return true;
    },
    selected: () => selected,
    mode: () => sketchOp ?? td.getMode(),
    setMode(m) { sketchOp = m === 'add' || m === 'cut' ? m : null; td.setMode(sketchOp ? 'freehand' : m === 'static' ? 'select' : m); }, // idle = select mode, so a click on any drawn shape selects it,
    // Finished polygons only, not helper points or the one being drawn.
    all: () => td.getSnapshot().filter(f => f.geometry.type === 'Polygon' && !f.properties.currentlyDrawing),
    setCodes: (id, iucn) => td.updateFeatureProperties(id, { iucn }),
    removeSelected() { if (selected == null) return false; td.removeFeatures([selected]); selected = null; dimOcc(false); onSelect(null); undo.record(snap()); onChange(); return true; },
    canUndo: undo.canUndo, canRedo: undo.canRedo,
    undo() { const s = undo.undo(); return s ? restore(s) : false; },
    redo() { const s = undo.redo(); return s ? restore(s) : false; },
    resetHistory: () => undo.reset(snap()),
    // Replace the store with the polygons in gj; returns how many were added.
    load(gj) {
      const polys = partsOf(gj);
      td.clear();
      onChange();
      const res = td.addFeatures(polys.map(({ geometry, iucn }) => ({ type: 'Feature', geometry, properties: { ...(iucn && { iucn }), mode: 'polygon' } })));
      const bad = res.filter(r => !r.valid);
      undo.record(snap());
      onChange();
      if (bad.length) throw new Error(`${bad.length} of ${polys.length} polygons are invalid: ${bad[0].reason}`);
      return polys.length;
    },
  };
}
