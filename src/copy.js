// Edit a copy of a community range: load it into the editor without losing parts, remember where it came from, dim the source layer.
import { loadRange } from './api.js';
import { polygonsOf } from './draw.js';
import { totalArea } from './reshape.js';

export function initCopy({ map, state, draw, reshape, setRustgis }) {
  // While a copy is being edited, fade the community layer it came from so the copy drawn on top stands out.
  function dimSource(n) {
    for (const l of map.getStyle().layers.filter(l => l.id.startsWith('range-'))) {
      const dim = n && l.id.startsWith(`range-${state.copy?.id}-`), fill = l.type === 'fill';
      map.setPaintProperty(l.id, fill ? 'fill-opacity' : 'line-opacity', dim ? (fill ? 0.06 : 0.25) : (fill ? 0.3 : 1));
    }
  }

  // Copy a community range into the editor; nothing may be lost silently, so the copy must keep 95% of the source area.
  async function copyRange(r) {
    const fc = await loadRange(r.file), p = fc.properties ?? {}, src = totalArea(polygonsOf(fc));
    reshape.reset();
    state.copy = { id: r.id, derived: { by: p.derived_from || p.author || r.author, created: p.created || r.created, file: r.file.startsWith('data/') ? r.file : `data/ranges/${r.file}` } };
    try {
      draw().load(fc);
      if (!(totalArea(draw().all().map(f => f.geometry)) >= 0.95 * src)) throw new Error('only part of the range loaded');
    } catch (e) { draw().load({ type: 'FeatureCollection', features: [] }); state.copy = null; throw new Error(`Could not copy that range (${e.message}). The editor was emptied.`); }
    setRustgis(r.file);
  }

  return { copyRange, dimSource };
}
