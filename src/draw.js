// Terra Draw wiring: polygon, freehand, add/cut sketch and edit modes on the MapLibre map. The official outline
// is a plain map layer, so it never enters this store.
import { TerraDraw, TerraDrawPolygonMode, TerraDrawFreehandMode, TerraDrawSelectMode, TerraDrawRenderMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'https://cdn.jsdelivr.net/npm/terra-draw-maplibre-gl-adapter@1.5.0/dist/terra-draw-maplibre-gl-adapter.module.js';

// Terra Draw's polygon mode hard-codes a "Feature has holes" check. Holes are plain GeoJSON and render and survive vertex edits
// (only the outer ring is editable), so keep the base checks and skip the mode's own.
class HolePolygonMode extends TerraDrawPolygonMode {
  validateFeature(f) { return this.validateModeFeature(f, () => ({ valid: true })); }
}

const EDIT = { feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true, snappable: true } } };

// Flatten a GeoJSON object (FeatureCollection, Feature or geometry) into single Polygon geometries.
export function polygonsOf(gj) {
  const geoms = gj?.type === 'FeatureCollection' ? gj.features.map(f => f?.geometry) : gj?.type === 'Feature' ? [gj.geometry] : [gj];
  return geoms.flatMap(g => g?.type === 'Polygon' ? [g] : g?.type === 'MultiPolygon' ? g.coordinates.map(coordinates => ({ type: 'Polygon', coordinates })) : []);
}

export function initDraw(map, onSelect = () => {}, onChange = () => {}, onSketch = () => {}, onEdit = () => {}, onDrawn = () => {}) {
  const td = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map }),
    modes: [
      new HolePolygonMode({ snapping: { toCoordinate: true } }),
      new TerraDrawFreehandMode(),
      new TerraDrawSelectMode({ flags: { polygon: EDIT, freehand: EDIT } }),
      new TerraDrawRenderMode({ modeName: 'view', styles: {} }),
    ],
  });
  td.start();
  let selected = null;
  td.on('select', id => { selected = id; onSelect(id); });
  td.on('deselect', () => { selected = null; onSelect(null); });
  // Add/Cut tools draw with the freehand mode; the finished sketch is handed to onSketch(op, polygon) and removed.
  let sketchOp = null;
  td.on('finish', (id, ctx) => {
    if (!sketchOp) { onChange(); if (ctx?.action === 'draw') onDrawn(); return; }
    const f = td.getSnapshot().find(x => x.id === id);
    td.removeFeatures([id]);
    if (f) onSketch(sketchOp, f.geometry);
  });
  // Sketch strokes are not edits of the range; vertex drags (update) go to onEdit, which stays cheap.
  td.on('change', (_ids, type) => { if (!sketchOp) type === 'update' ? onEdit() : onChange(); });
  return {
    // Terra Draw has no finish() API; its modes finish on a keyup of keyEvents.finish (Enter) on the map container.
    finish: () => map.getCanvas().dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' })),
    mode: () => sketchOp ?? td.getMode(),
    setMode(m) { sketchOp = m === 'add' || m === 'cut' ? m : null; td.setMode(sketchOp ? 'freehand' : m); },
    // Finished polygons only, not helper points or the one being drawn.
    all: () => td.getSnapshot().filter(f => f.geometry.type === 'Polygon' && !f.properties.currentlyDrawing),
    removeSelected() { if (selected == null) return false; td.removeFeatures([selected]); selected = null; onSelect(null); onChange(); return true; },
    // Replace the store with the polygons in gj; returns how many were added.
    load(gj) {
      const polys = polygonsOf(gj);
      td.clear();
      onChange();
      const res = td.addFeatures(polys.map(geometry => ({ type: 'Feature', geometry, properties: { mode: 'polygon' } })));
      const bad = res.filter(r => !r.valid);
      onChange();
      if (bad.length) throw new Error(`${bad.length} of ${polys.length} polygons are invalid: ${bad[0].reason}`);
      return polys.length;
    },
  };
}
