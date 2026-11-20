// Patch mode: edit the official outline as your own add/cut shapes. The map shows the applied result; only the shapes are exported.
import polygonClipping from 'https://cdn.jsdelivr.net/npm/polygon-clipping@0.15.7/+esm';
import { loadRange } from './api.js';
import { fetchOutline } from './official.js';
import { applyPatch, toPatch } from './patch.js';
import { DRAFT } from './draw.js';
import { revisionDiff } from './diff.js';

const SRC = 'patch-result', IDS = [`${SRC}-fill`, `${SRC}-line`], SH = 'patch-shapes', SHIDS = [`${SH}-fill`, `${SH}-line`, `${SH}-cut`];
const GREEN = '#2a9d3f', RED = '#d62828', km = n => Math.round(n).toLocaleString('en-US');
const HINT = 'Cut area draws freehand: click once, move around the area, click again to finish. For vertex-by-vertex shapes use Polygon.';

export function initPatch({ map, state, $, say, draw, sync, showOfficial }) {
  const bases = new Map(); // official slug -> outline FeatureCollection (view only, never exported)
  const base = slug => { if (!bases.has(slug)) bases.set(slug, fetchOutline(slug).catch(e => { bases.delete(slug); throw e; })); return bases.get(slug); };
  const fc = coords => ({ type: 'FeatureCollection', features: coords.map(c => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: c } })) });
  const asPatch = () => ({ features: state.patch.shapes.map(s => ({ properties: { op: s.op }, geometry: s.geometry })) });

  const applied = () => fc(applyPatch(state.patch.baseFc, asPatch(), polygonClipping));
  const shapes = () => ({ type: 'FeatureCollection', features: state.patch.shapes.map(s => ({ type: 'Feature', properties: { op: s.op }, geometry: s.geometry })) });
  function render() {
    const data = applied();
    if (map.getSource(SRC)) { map.getSource(SRC).setData(data); return map.getSource(SH).setData(shapes()); }
    map.addSource(SRC, { type: 'geojson', data });
    map.addLayer({ id: IDS[0], type: 'fill', source: SRC, paint: { 'fill-color': DRAFT, 'fill-opacity': 0.25 } });
    map.addLayer({ id: IDS[1], type: 'line', source: SRC, paint: { 'line-color': DRAFT, 'line-width': 3 } });
    const by = (a, b) => ['match', ['get', 'op'], 'cut', a, b];
    map.addSource(SH, { type: 'geojson', data: shapes() });
    map.addLayer({ id: SHIDS[0], type: 'fill', source: SH, paint: { 'fill-color': by(RED, GREEN), 'fill-opacity': 0.15 } });
    const isCut = ['==', ['get', 'op'], 'cut'];
    map.addLayer({ id: SHIDS[1], type: 'line', source: SH, filter: ['!', isCut], paint: { 'line-color': GREEN, 'line-width': 2.5 } });
    map.addLayer({ id: SHIDS[2], type: 'line', source: SH, filter: isCut, paint: { 'line-color': RED, 'line-width': 2.5, 'line-dasharray': [2, 1.5] } });
  }
  function exit() {
    for (const id of [...SHIDS, ...IDS]) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of [SH, SRC]) if (map.getSource(id)) map.removeSource(id);
    state.patch = null;
    $('open-propose').textContent = 'Propose your range';
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
    $('open-propose').textContent = 'Propose this edit';
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
    sketch(op, geometry) {
      if (new Set(geometry.coordinates[0].map(String)).size < 3) return say(HINT.replace('Cut area', op === 'add' ? 'Add area' : 'Cut area'));
      const before = applied();
      state.patch.shapes.push({ op, geometry });
      const d = revisionDiff(before, applied(), polygonClipping), n = op === 'add' ? d.addedKm2 : d.removedKm2;
      if (n < 1) { state.patch.shapes.pop(); return say('Nothing changed: draw a larger shape that overlaps the range.'); }
      render(); sync(); say(op === 'add' ? `Added ${km(n)} km² to the official range.` : `Cut ${km(n)} km² from the official range.`);
    },
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
