// Patch mode: edit the official outline as your own add/cut shapes. The map shows the applied result; only the shapes are exported.
import polygonClipping from 'https://cdn.jsdelivr.net/npm/polygon-clipping@0.15.7/+esm';
import { loadRange } from './api.js';
import { fetchOutline } from './official.js';
import { applyPatch, toPatch } from './patch.js';
import { DRAFT } from './draw.js';

const SRC = 'patch-result', IDS = [`${SRC}-fill`, `${SRC}-line`];

export function initPatch({ map, state, $, say, draw, sync, showOfficial }) {
  const bases = new Map(); // official slug -> outline FeatureCollection (view only, never exported)
  const base = slug => { if (!bases.has(slug)) bases.set(slug, fetchOutline(slug).catch(e => { bases.delete(slug); throw e; })); return bases.get(slug); };
  const fc = coords => ({ type: 'FeatureCollection', features: coords.map(c => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: c } })) });
  const asPatch = () => ({ features: state.patch.shapes.map(s => ({ properties: { op: s.op }, geometry: s.geometry })) });

  function render() {
    const data = fc(applyPatch(state.patch.baseFc, asPatch(), polygonClipping));
    if (map.getSource(SRC)) return map.getSource(SRC).setData(data);
    map.addSource(SRC, { type: 'geojson', data });
    map.addLayer({ id: IDS[0], type: 'fill', source: SRC, paint: { 'fill-color': DRAFT, 'fill-opacity': 0.25 } });
    map.addLayer({ id: IDS[1], type: 'line', source: SRC, paint: { 'line-color': DRAFT, 'line-width': 3 } });
  }
  function exit() {
    for (const id of IDS) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SRC)) map.removeSource(SRC);
    state.patch = null;
    $('official-edit').textContent = 'Edit (saved as a patch)';
  }
  // shapes: the earlier patch's shapes when editing a patch, so the new file is cumulative against the official base.
  // Returns false when the species changed while loading (nothing is entered).
  async function enter(slug, shapes = [], parent = null, taxon = state.taxon) {
    const baseFc = await base(slug);
    if (state.taxon !== taxon) return false;
    if (state.patch) exit();
    state.copy = null;
    draw().load({ type: 'FeatureCollection', features: [] });
    state.patch = { base: slug, baseFc, shapes, parent };
    if (!state.official?.fc) await showOfficial();
    if (state.taxon !== taxon) return false;
    render(); sync();
    $('t-cut').disabled = false; $('t-cut').title = 'Cut area: sketch a shape to remove from the official range (saved as a cut shape)';
    $('official-edit').textContent = 'Stop patch editing';
    return true;
  }
  $('official-edit').addEventListener('click', async () => {
    if (state.patch) { exit(); draw().load({ type: 'FeatureCollection', features: [] }); say('Patch editing stopped.'); return; }
    say('Loading the official outline...');
    try { if (await enter(state.official.slug)) say('Patch mode: use Add area and Cut area. Only your shapes are saved, never the outline.'); } catch (e) { say(e.message); }
  });

  return {
    active: () => !!state.patch,
    exit,
    sketch(op, geometry) { state.patch.shapes.push({ op, geometry }); render(); sync(); say(op === 'add' ? 'Area added to your patch.' : 'Area cut in your patch.'); },
    // Edit an existing patch revision: start from its shapes, with it as the parent.
    async edit(r) { const t = state.taxon, p = await loadRange(r.file); return enter(p.properties.base, p.features.map(f => ({ op: f.properties.op, geometry: f.geometry })), r.file, t); },
    enter,
    // Polygons drawn with the Polygon tool in patch mode count as adds.
    build: (features, meta) => toPatch([...state.patch.shapes, ...features.map(f => ({ op: 'add', geometry: f.geometry }))], { ...meta, base: state.patch.base, parent: state.patch.parent }),
    // Map data for a range file: a patch is shown as its applied result, anything else as is.
    async display(data) {
      const p = data.properties;
      return p?.basis === 'official-patch' ? fc(applyPatch(await base(p.base), data, polygonClipping)) : data;
    },
  };
}
