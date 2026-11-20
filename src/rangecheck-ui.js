// Range check wiring: toggle, counting, map layer, popup. Logic lives in rangecheck.js.
import { loadRange, densityTile } from './api.js';
import * as rc from './rangecheck.js';

const $ = id => document.getElementById(id);

// state: { taxon, official }. Returns { clear, legend }; clear() resets the toggle and layer (call on taxon change).
export function initRangeCheck({ map, state, onChange, drawing, draft = () => [] }) {
  const LABELS = { outside: 'records outside range (range may be too small, or misIDs)', gap: 'no records yet (check effort or habitat)', unmapped: 'not mapped by this source' };
  const LAYERS = ['rc-fill', 'rc-hatch'];
  let rcRun = 0, hasUnmapped = false;
  function clear(msg = '') {
    rcRun++;
    for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource('rc')) map.removeSource('rc');
    $('rc-toggle').checked = false;
    $('rc-summary').textContent = msg;
    onChange();
  }
  // What the check compares against: { fc, ref, coverage }. A drawing wins, then the official outline, then the ticked community ranges.
  async function reference() {
    const mine = draft();
    if (mine.length) return { fc: { type: 'FeatureCollection', features: mine }, ref: 'your draft' };
    if (state.official?.fc) return { fc: state.official.fc, ref: 'official outline' };
    const boxes = [...document.querySelectorAll('#versions input:checked')];
    const fcs = await Promise.all(boxes.map(b => loadRange(b.dataset.file)));
    // Restrict only when every compared range has a coverage note; one full-extent range makes records anywhere meaningful.
    const covered = fcs.length > 0 && fcs.every(fc => fc.properties?.coverage);
    return { fc: { type: 'FeatureCollection', features: fcs.flatMap(fc => fc.features ?? []) }, ref: [...new Set(boxes.map(b => b.dataset.author))].join(' + '), coverage: covered ? rc.CONUS : null };
  }
  async function runRangeCheck() {
    const run = ++rcRun, taxon = state.taxon;
    const stale = () => run !== rcRun || state.taxon !== taxon;
    try {
      const { fc, ref, coverage } = await reference();
      const box = rc.bbox(fc);
      if (!box) { clear('Show a community range or load the official outline first.'); return; }
      const { size, tiles } = rc.pickZoom(box), counts = new Map();
      let next = 0, done = 0;
      $('rc-summary').textContent = 'Counting GBIF records...';
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (next < tiles.length && !stale()) {
          const t = tiles[next++];
          rc.addTile(counts, t, await densityTile(taxon.key, t));
          if (!stale()) $('rc-summary').textContent = `Counting GBIF records... ${Math.round((100 * ++done) / tiles.length)}%`;
        }
      }));
      if (stale()) return;
      const res = rc.classify(counts, fc, size, { coverage });
      hasUnmapped = res.unmapped > 0;
      for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource('rc')) map.removeSource('rc');
      if (!map.hasImage('rc-hatch')) map.addImage('rc-hatch', hatch());
      map.addSource('rc', { type: 'geojson', data: rc.toGeoJSON(res.cells) });
      map.addLayer({ id: 'rc-hatch', type: 'fill', source: 'rc', filter: ['==', ['get', 'status'], 'unmapped'], paint: { 'fill-pattern': 'rc-hatch' } }, 'occ');
      map.addLayer({ id: 'rc-fill', type: 'fill', source: 'rc', filter: ['!=', ['get', 'status'], 'unmapped'], paint: {
        'fill-color': ['match', ['get', 'status'], 'outside', rc.COLORS.outside, rc.COLORS.gap],
        // red fades for stray records: 1-2 records are faint, 100+ solid
        'fill-opacity': ['case', ['==', ['get', 'status'], 'gap'], 0.3, ['interpolate', ['linear'], ['get', 'count'], 1, 0.12, 3, 0.3, 10, 0.5, 100, 0.75]] } }, 'occ');
      $('rc-summary').textContent = rc.summaryLine(res, ref, coverage && 'conterminous US');
      onChange();
    } catch (e) { if (!stale()) clear(`Range check failed: ${e.message}`); }
  }
  $('rc-toggle').addEventListener('change', e => { if (e.target.checked) runRangeCheck(); else clear(); });
  // Re-run when the compared layer changes (official toggle, ticks, drawing); debounced because drawing fires many changes.
  let timer;
  const refresh = () => { if ($('rc-toggle').checked) { clearTimeout(timer); timer = setTimeout(runRangeCheck, 500); } };
  $('versions').addEventListener('change', refresh);
  const hatch = () => {
    const c = Object.assign(document.createElement('canvas'), { width: 8, height: 8 }), g = c.getContext('2d');
    g.strokeStyle = '#8a8a8a'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(0, 8); g.lineTo(8, 0); g.moveTo(-1, 1); g.lineTo(1, -1); g.moveTo(7, 9); g.lineTo(9, 7); g.stroke();
    return g.getImageData(0, 0, 8, 8);
  };
  for (const id of LAYERS) map.on('click', id, e => {
    if (drawing()) return;
    const p = e.features[0].properties, el = document.createElement('div');
    el.append(p.status === 'gap' ? `${LABELS.gap}.` : `${LABELS[p.status]} (${p.count} record${p.count === 1 ? '' : 's'}).`);
    if (p.status === 'gap') {
      for (const [text, href] of [['Look on iNaturalist', rc.inatCellUrl(state.taxon.name, p)], ['Look on GBIF', rc.gbifCellUrl(state.taxon.key, p)]]) {
        el.append(Object.assign(document.createElement('a'), { href, textContent: text, target: '_blank', rel: 'noopener' }));
      }
      el.append(Object.assign(document.createElement('small'), { textContent: 'No records is not absence: it may only mean nobody has looked.' }));
    }
    new maplibregl.Popup().setLngLat(e.lngLat).setDOMContent(el).addTo(map);
  });
  const legend = () => map.getLayer('rc-fill') ? Object.keys(LABELS).filter(k => k !== 'unmapped' || hasUnmapped).map(k => ({ label: LABELS[k], swatch: rc.COLORS[k] })) : [];
  return { clear, legend, refresh };
}
