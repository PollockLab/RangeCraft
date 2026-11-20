// Range check wiring: toggle, counting, map layer, popup. Logic lives in rangecheck.js.
import { loadRange, densityTile } from './api.js';
import * as rc from './rangecheck.js';

const $ = id => document.getElementById(id);

// state: { taxon, official }. Returns { clear, legend }; clear() resets the toggle and layer (call on taxon change).
export function initRangeCheck({ map, state, onChange, drawing }) {
  const LABELS = { outside: 'Records outside range: may be too small', gap: 'In range, no records: survey gap' };
  let rcRun = 0;
  function clear(msg = '') {
    rcRun++;
    if (map.getLayer('rc-fill')) map.removeLayer('rc-fill');
    if (map.getSource('rc')) map.removeSource('rc');
    $('rc-toggle').checked = false;
    $('rc-summary').textContent = msg;
    onChange();
  }
  async function rangeCheckFeatures() {
    if (state.official?.fc) return state.official.fc;
    const boxes = [...document.querySelectorAll('#versions input:checked')];
    const fcs = await Promise.all(boxes.map(b => loadRange(b.dataset.file)));
    return { type: 'FeatureCollection', features: fcs.flatMap(fc => fc.features ?? []) };
  }
  async function runRangeCheck() {
    const run = ++rcRun, taxon = state.taxon;
    const stale = () => run !== rcRun || state.taxon !== taxon;
    try {
      const fc = await rangeCheckFeatures();
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
      const res = rc.classify(counts, fc, size);
      map.addSource('rc', { type: 'geojson', data: rc.toGeoJSON(res.cells) });
      map.addLayer({ id: 'rc-fill', type: 'fill', source: 'rc', paint: {
        'fill-color': ['match', ['get', 'status'], 'outside', rc.COLORS.outside, rc.COLORS.gap],
        // red fades for stray records: 1-2 records are faint, 100+ solid
        'fill-opacity': ['case', ['==', ['get', 'status'], 'gap'], 0.3, ['interpolate', ['linear'], ['get', 'count'], 1, 0.12, 3, 0.3, 10, 0.5, 100, 0.75]] } }, 'occ');
      $('rc-summary').textContent = rc.summaryLine(res);
      onChange();
    } catch (e) { if (!stale()) clear(`Range check failed: ${e.message}`); }
  }
  $('rc-toggle').addEventListener('change', e => { if (e.target.checked) runRangeCheck(); else clear(); });
  map.on('click', 'rc-fill', e => {
    if (drawing()) return;
    const p = e.features[0].properties, el = document.createElement('div');
    el.append(`${LABELS[p.status]} (${p.count} record${p.count === 1 ? '' : 's'}).`);
    if (p.status === 'gap') {
      for (const [text, href] of [['Look on iNaturalist', rc.inatCellUrl(state.taxon.name, p)], ['Look on GBIF', rc.gbifCellUrl(state.taxon.key, p)]]) {
        el.append(Object.assign(document.createElement('a'), { href, textContent: text, target: '_blank', rel: 'noopener' }));
      }
      el.append(Object.assign(document.createElement('small'), { textContent: 'No records is not absence: it may only mean nobody has looked.' }));
    }
    new maplibregl.Popup().setLngLat(e.lngLat).setDOMContent(el).addTo(map);
  });
  const legend = () => map.getLayer('rc-fill') ? Object.keys(LABELS).map(k => ({ label: LABELS[k], swatch: rc.COLORS[k] })) : [];
  return { clear, legend };
}
