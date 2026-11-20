// Patch mode: edit the official outline as your own add/cut shapes. The map shows the applied result; only the shapes are exported.
import polygonClipping from 'https://cdn.jsdelivr.net/npm/polygon-clipping@0.15.7/+esm';
import { loadRange } from './api.js';
import { fetchOutline } from './official.js';
import { applyPatch, toPatch } from './patch.js';
import { DRAFT } from './draw.js';
import { revisionDiff } from './diff.js';

const SRC = 'patch-result', IDS = [`${SRC}-fill`, `${SRC}-line`], SH = 'patch-shapes', SHIDS = [`${SH}-fill`, `${SH}-line`, `${SH}-cut`, `${SH}-ext`];
const GREEN = '#2a9d3f', RED = '#d62828', BROWN = '#8d6e63', km = n => Math.round(n).toLocaleString('en-US');
const cells = n => `${n.toLocaleString('en-US')} grid cell${n === 1 ? '' : 's'}`;
const HINT = 'Cut area draws freehand: click once, move around the area, click again to finish. For vertex-by-vertex shapes use Polygon.';

export function initPatch({ map, state, $, say, draw, sync, showOfficial, recordsIn, legend }) {
  const bases = new Map(); // official slug -> outline FeatureCollection (view only, never exported)
  const base = slug => { if (!bases.has(slug)) bases.set(slug, fetchOutline(slug).catch(e => { bases.delete(slug); throw e; })); return bases.get(slug); };
  const fc = coords => ({ type: 'FeatureCollection', features: coords.map(c => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: c } })) });
  const props = s => s.op === 'recode' ? { op: s.op, presence: s.presence } : { op: s.op };
  const asPatch = () => ({ features: state.patch.shapes.map(s => ({ properties: props(s), geometry: s.geometry })) });

  const applied = () => fc(applyPatch(state.patch.baseFc, asPatch(), polygonClipping));
  const shapes = () => ({ type: 'FeatureCollection', features: state.patch.shapes.map(s => ({ type: 'Feature', properties: props(s), geometry: s.geometry })) });
  // The add/cut shape layers, shared by patch editing and by viewing published patches.
  function shapeLayers(data) {
    if (map.getSource(SH)) return map.getSource(SH).setData(data);
    const by = (a, b) => ['match', ['get', 'op'], 'cut', a, 'recode', BROWN, b];
    map.addSource(SH, { type: 'geojson', data });
    map.addLayer({ id: SHIDS[0], type: 'fill', source: SH, paint: { 'fill-color': by(RED, GREEN), 'fill-opacity': 0.15 } });
    const is = op => ['==', ['get', 'op'], op];
    map.addLayer({ id: SHIDS[1], type: 'line', source: SH, filter: ['!', ['in', ['get', 'op'], ['literal', ['cut', 'recode']]]], paint: { 'line-color': GREEN, 'line-width': 2.5 } });
    map.addLayer({ id: SHIDS[2], type: 'line', source: SH, filter: is('cut'), paint: { 'line-color': RED, 'line-width': 2.5, 'line-dasharray': [2, 1.5] } });
    map.addLayer({ id: SHIDS[3], type: 'line', source: SH, filter: is('recode'), layout: { 'line-cap': 'round' }, paint: { 'line-color': BROWN, 'line-width': 3, 'line-dasharray': [0.5, 2] } }); // dotted: extirpated, area kept
  }
  function removeShapes() {
    for (const id of SHIDS) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SH)) map.removeSource(SH);
  }
  function render() {
    const data = applied();
    if (map.getSource(SRC)) { map.getSource(SRC).setData(data); return shapeLayers(shapes()); }
    map.addSource(SRC, { type: 'geojson', data });
    map.addLayer({ id: IDS[0], type: 'fill', source: SRC, paint: { 'fill-color': DRAFT, 'fill-opacity': 0.25 } });
    map.addLayer({ id: IDS[1], type: 'line', source: SRC, paint: { 'line-color': DRAFT, 'line-width': 3 } });
    shapeLayers(shapes());
  }
  // Published patches being viewed (list toggle, History revision): key -> its op features. Never drawn while editing.
  const views = new Map();
  function paintViews() {
    const features = [...views.values()].flat();
    if (!features.length || state.patch) removeShapes(); else shapeLayers({ type: 'FeatureCollection', features });
    legend();
  }
  const PH = $('change-msg').placeholder;
  let cutRun = 0; // bumped by every new shape and by exit, so a slow record count never overwrites a newer message
  const reason = $('cut-reason');
  function exit() {
    cutRun++; reason.hidden = true;
    removeShapes();
    for (const id of IDS) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SRC)) map.removeSource(SRC);
    state.patch = null; reason.onchange = null;
    views.clear(); legend();
    $('open-propose').textContent = 'Propose your range';
    $('official-edit').textContent = 'Edit (saved as a patch)';
    $('change-msg').placeholder = PH;
  }
  // shapes: the earlier patch's shapes when editing a patch, so the new file is cumulative against the official base.
  // Returns false when the species changed while loading (nothing is entered).
  async function enter(slug, shapes = [], parent = null, taxon = state.taxon) {
    const baseFc = await base(slug);
    if (state.taxon !== taxon) return false;
    if (state.patch) exit();
    views.clear(); removeShapes();
    state.copy = null;
    draw().load({ type: 'FeatureCollection', features: [] });
    state.patch = { base: slug, baseFc, shapes, parent };
    if (!state.official?.fc) await showOfficial();
    if (state.taxon !== taxon) return false;
    render(); sync();
    $('open-propose').textContent = 'Propose this edit';
    $('t-cut').disabled = false; $('t-cut').title = 'Cut area: sketch a shape to remove from the official range (saved as a cut shape)';
    $('official-edit').textContent = 'Stop patch editing';
    $('change-msg').placeholder = 'e.g. Cut the north edge: records there are introduced (cite them)';
    return true;
  }
  $('official-edit').addEventListener('click', async () => {
    if (state.patch) { exit(); draw().load({ type: 'FeatureCollection', features: [] }); say('Patch editing stopped.'); return; }
    say('Loading the official outline...');
    try { if (await enter(state.official.slug)) say('Patch mode: use Add area and Cut area. Only your shapes are saved, never the outline.'); } catch (e) { say(e.message); }
  });

  return {
    active: () => !!state.patch,
    // Show a published patch's add/cut shapes (data = its file; anything else, or null, clears the key).
    view(key, data) {
      const f = data?.properties?.basis === 'official-patch' ? data.features.filter(x => x.properties?.op) : [];
      if (state.patch || (!f.length && !views.has(key))) return;
      if (f.length) views.set(key, f); else views.delete(key);
      paintViews();
    },
    viewOps: () => new Set([...views.values()].flat().map(f => f.properties.op).concat((state.patch?.shapes ?? []).map(s => s.op))),
    exit,
    sketch(op, geometry) {
      if (new Set(geometry.coordinates[0].map(String)).size < 3) return say(HINT.replace('Cut area', op === 'add' ? 'Add area' : 'Cut area'));
      const before = applied();
      state.patch.shapes.push({ op, geometry });
      const d = revisionDiff(before, applied(), polygonClipping), n = op === 'add' ? d.addedKm2 : d.removedKm2;
      if (n < 1) { state.patch.shapes.pop(); return say('Nothing changed: draw a larger shape that overlaps the range.'); }
      render(); sync(); cutRun++;
      reason.hidden = op === 'add';
      if (op === 'add') return say(`Added ${km(n)} km² to the official range.`);
      // Reason for the cut: a mapping error removes the area; extirpated keeps it as a recode (IUCN presence 5 Extinct / 4 Possibly Extinct).
      const shape = state.patch.shapes.at(-1), head = `Cut ${km(n)} km² from the official range.`, run = cutRun, taxon = state.taxon;
      reason.querySelector('input[value=cut]').checked = true;
      let k = null;
      const report = () => {
        const ext = shape.op === 'recode';
        if (ext) return say(k ? `Kept ${km(n)} km² as ${shape.presence === 5 ? 'Extinct' : 'Possibly Extinct'} (presence ${shape.presence}). ${cells(k)} with GBIF records ${k === 1 ? 'falls' : 'fall'} in this area: check record dates support extirpation.` : `Kept ${km(n)} km² as ${shape.presence === 5 ? 'Extinct' : 'Possibly Extinct'} (presence ${shape.presence}).${k === 0 ? ' No GBIF records fall in this area.' : ''}`);
        if (k == null) return say(`${head} Counting records in the cut...`);
        say(k ? `${head} ${cells(k)} with GBIF records ${k === 1 ? 'falls' : 'fall'} in the cut: cite why ${k === 1 ? 'it is' : 'they are'} excluded (e.g. introduced, misidentified, historical) in What changed and why.` : `${head} No GBIF records fall in the cut.`);
      };
      reason.onchange = e => {
        if (run !== cutRun || !state.patch?.shapes.includes(shape)) return;
        const v = e.target.value;
        if (v === 'cut') { shape.op = 'cut'; delete shape.presence; } else { shape.op = 'recode'; shape.presence = Number(v); }
        render(); sync(); legend(); report();
      };
      report();
      recordsIn({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: d.removed } }] }).then(r => {
        if (r == null || run !== cutRun || state.taxon !== taxon) return;
        k = r; report();
      }).catch(() => run === cutRun && say(`${head} Could not count GBIF records in the cut.`));
    },
    // Edit an existing patch revision: start from its shapes, with it as the parent.
    async edit(r) { const t = state.taxon, p = await loadRange(r.file); return enter(p.properties.base, p.features.map(f => ({ op: f.properties.op, ...(f.properties.presence && { presence: f.properties.presence }), geometry: f.geometry })), r.file, t); },
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
