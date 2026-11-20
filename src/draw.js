// Terra Draw wiring: polygon, freehand and edit modes on the MapLibre map. The official outline
// is a plain map layer, so it never enters this store.
import { TerraDraw, TerraDrawPolygonMode, TerraDrawFreehandMode, TerraDrawSelectMode, TerraDrawRenderMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'https://cdn.jsdelivr.net/npm/terra-draw-maplibre-gl-adapter@1.5.0/dist/terra-draw-maplibre-gl-adapter.module.js';

const EDIT = { feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true, snappable: true } } };

// Flatten a GeoJSON object (FeatureCollection, Feature or geometry) into single Polygon geometries.
export function polygonsOf(gj) {
  const geoms = gj?.type === 'FeatureCollection' ? gj.features.map(f => f?.geometry) : gj?.type === 'Feature' ? [gj.geometry] : [gj];
  return geoms.flatMap(g => g?.type === 'Polygon' ? [g] : g?.type === 'MultiPolygon' ? g.coordinates.map(coordinates => ({ type: 'Polygon', coordinates })) : []);
}

export function initDraw(map, onSelect = () => {}) {
  const td = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map }),
    modes: [
      new TerraDrawPolygonMode({ snapping: { toCoordinate: true } }),
      new TerraDrawFreehandMode(),
      new TerraDrawSelectMode({ flags: { polygon: EDIT, freehand: EDIT } }),
      new TerraDrawRenderMode({ modeName: 'view', styles: {} }),
    ],
  });
  td.start();
  let selected = null;
  td.on('select', id => { selected = id; onSelect(id); });
  td.on('deselect', () => { selected = null; onSelect(null); });
  return {
    mode: () => td.getMode(),
    setMode: m => td.setMode(m),
    // Finished polygons only, not helper points or the one being drawn.
    all: () => td.getSnapshot().filter(f => f.geometry.type === 'Polygon' && !f.properties.currentlyDrawing),
    removeSelected() { if (selected == null) return false; td.removeFeatures([selected]); selected = null; onSelect(null); return true; },
    // Replace the store with the polygons in gj; returns how many were added.
    load(gj) {
      const polys = polygonsOf(gj);
      td.clear();
      const res = td.addFeatures(polys.map(geometry => ({ type: 'Feature', geometry, properties: { mode: 'polygon' } })));
      const bad = res.filter(r => !r.valid);
      if (bad.length) throw new Error(`${bad.length} of ${polys.length} polygons are invalid: ${bad[0].reason}`);
      return polys.length;
    },
  };
}
