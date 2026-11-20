import { speciesName, occurrenceTiles, loadIndex, loadLeaderboard, loadRange } from './api.js';
import { initSearch } from './search.js';
import { buildCollection, download, proposeUrl } from './export.js';

const $ = id => document.getElementById(id);
const COLORS = ['#e4572e', '#17bebb', '#ffc914', '#76b041', '#9b5de5', '#f15bb5'];
const state = { taxon: null, index: null, shown: new Set() };

// mapbox-gl-draw hardcodes mapbox class names; point them at maplibre's.
Object.assign(MapboxDraw.constants.classes, {
  CONTROL_BASE: 'maplibregl-ctrl', CONTROL_PREFIX: 'maplibregl-ctrl-', CONTROL_GROUP: 'maplibregl-ctrl-group',
});

const map = new maplibregl.Map({
  container: 'map', style: 'https://tiles.openfreemap.org/styles/positron', center: [0, 20], zoom: 1.5,
});
map.addControl(new maplibregl.NavigationControl(), 'top-right');
const draw = new MapboxDraw({ displayControlsDefault: false, controls: { polygon: true, trash: true } });
map.addControl(draw, 'top-left');

const say = t => { $('msg').textContent = t; };
const mapReady = new Promise(res => map.once('load', res));

// ---- taxon selection ----
async function selectTaxon({ key, name }) {
  state.taxon = { key: String(key), name };
  history.replaceState(null, '', `#taxon=${key}`);
  $('selected').textContent = `${name} (GBIF ${key})`;
  await mapReady;
  setOccurrences();
  await showVersions();
}

function setOccurrences() {
  for (const id of ['occ']) { if (map.getLayer(id)) map.removeLayer(id); if (map.getSource(id)) map.removeSource(id); }
  map.addSource('occ', { type: 'raster', tiles: [occurrenceTiles(state.taxon.key)], tileSize: 256, attribution: '&copy; GBIF' });
  map.addLayer({ id: 'occ', type: 'raster', source: 'occ', layout: { visibility: $('occ-toggle').checked ? 'visible' : 'none' } });
}

// ---- community ranges ----
function clearRanges() {
  for (const l of map.getStyle().layers.filter(l => l.id.startsWith('range-'))) map.removeLayer(l.id);
  for (const s of Object.keys(map.getStyle().sources).filter(s => s.startsWith('range-'))) map.removeSource(s);
  state.shown.clear();
}

async function toggleRange(r, color, on) {
  const id = `range-${r.id}`;
  if (!on) { map.setLayoutProperty(`${id}-fill`, 'visibility', 'none'); map.setLayoutProperty(`${id}-line`, 'visibility', 'none'); return; }
  if (!map.getSource(id)) {
    const data = await loadRange(r.file);
    map.addSource(id, { type: 'geojson', data });
    map.addLayer({ id: `${id}-fill`, type: 'fill', source: id, paint: { 'fill-color': color, 'fill-opacity': 0.3 } }, 'occ');
    map.addLayer({ id: `${id}-line`, type: 'line', source: id, paint: { 'line-color': color, 'line-width': 2 } }, 'occ');
  }
  map.setLayoutProperty(`${id}-fill`, 'visibility', 'visible');
  map.setLayoutProperty(`${id}-line`, 'visibility', 'visible');
}

const fmtScore = s => s
  ? `precision ${(s.precision * 100).toFixed(0)}%, ${s.prospective_inside}/${s.prospective_total} new records inside`
  : 'not yet scored';

async function showVersions() {
  clearRanges();
  const ul = $('versions');
  state.index ??= await loadIndex();
  const rs = state.index.filter(r => String(r.taxonKey) === state.taxon.key).sort((a, b) => b.created.localeCompare(a.created));
  if (!rs.length) { ul.innerHTML = '<li class="muted">No community ranges for this species yet. Draw the first one.</li>'; return; }
  ul.replaceChildren(...rs.map((r, i) => {
    const color = COLORS[i % COLORS.length];
    const li = document.createElement('li');
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', id: `v-${r.id}`, checked: true });
    const lab = document.createElement('label');
    lab.htmlFor = cb.id;
    lab.style.fontWeight = '400';
    lab.innerHTML = '<span class="swatch" aria-hidden="true"></span> ';
    lab.firstChild.style.cssText = `display:inline-block;width:.8rem;height:.8rem;background:${color};border-radius:3px`;
    lab.append(`${r.author}, ${r.created}`);
    const sc = document.createElement('div');
    sc.className = 'muted';
    sc.textContent = fmtScore(r.score);
    const edit = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Edit a copy' });
    cb.addEventListener('change', () => toggleRange(r, color, cb.checked).catch(e => say(e.message)));
    edit.addEventListener('click', async () => {
      try { const fc = await loadRange(r.file); draw.deleteAll(); draw.add({ type: 'FeatureCollection', features: fc.features.filter(f => /Polygon/.test(f.geometry.type)) }); say('Loaded into the editor. Modify it, then export or propose.'); }
      catch (e) { say(e.message); }
    });
    li.append(cb, lab, sc, edit);
    return li;
  }));
  rs.forEach((r, i) => toggleRange(r, COLORS[i % COLORS.length], true).catch(e => say(e.message)));
}

// ---- export / propose ----
function current() {
  if (!state.taxon) { say('Select a species first.'); return null; }
  const features = draw.getAll().features;
  if (!features.length) { say('Draw at least one polygon first.'); return null; }
  const author = $('author').value.trim();
  if (!author) { say('Enter your GitHub username as author.'); $('author').focus(); return null; }
  return buildCollection(features, { taxonKey: state.taxon.key, scientificName: state.taxon.name, author, sources: $('sources').value.trim() });
}
$('export').addEventListener('click', () => { const fc = current(); if (fc) { download(fc); say('Downloaded.'); } });
$('propose').addEventListener('click', () => {
  const fc = current();
  if (!fc) return;
  const url = proposeUrl(fc);
  if (url) { window.open(url, '_blank', 'noopener'); say('Opened GitHub. Commit the new file to open a pull request.'); }
  else { download(fc); say(`Range too large for a link. Downloaded; upload it at github.com/PollockLab/RangeCraft under data/ranges/${fc.properties.taxonKey}/ via "Add file > Upload files", then open a pull request.`); }
});

$('occ-toggle').addEventListener('change', e => {
  if (map.getLayer('occ')) map.setLayoutProperty('occ', 'visibility', e.target.checked ? 'visible' : 'none');
});

// ---- leaderboard ----
async function showBoard() {
  const rows = (await loadLeaderboard()).sort((a, b) => b.credit - a.credit);
  $('board-empty').hidden = rows.length > 0;
  $('board').hidden = !rows.length;
  $('board').tBodies[0].replaceChildren(...rows.map((r, i) => {
    const tr = document.createElement('tr');
    for (const v of [i + 1, r.author, r.ranges, r.prospective_inside, Number(r.credit).toFixed(1)]) tr.append(Object.assign(document.createElement('td'), { textContent: v }));
    return tr;
  }));
}

// ---- tabs ----
const tabs = [['tab-map', 'view-map'], ['tab-board', 'view-board']];
function openTab(tabId) {
  for (const [t, v] of tabs) {
    $(t).setAttribute('aria-selected', t === tabId);
    $(t).tabIndex = t === tabId ? 0 : -1;
    $(v).hidden = t !== tabId;
  }
  if (tabId === 'tab-board') showBoard();
  else map.resize();
}
tabs.forEach(([t], i) => {
  $(t).addEventListener('click', () => openTab(t));
  $(t).addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length][0];
    openTab(n); $(n).focus();
  });
});

// ---- boot ----
initSearch($('q'), $('results'), selectTaxon);
async function fromHash() {
  const key = new URLSearchParams(location.hash.slice(1)).get('taxon');
  if (!/^\d+$/.test(key || '')) return;
  try { const name = await speciesName(key); $('q').value = name; await selectTaxon({ key, name }); }
  catch (e) { say(`Could not load taxon ${key}: ${e.message}`); }
}
addEventListener('hashchange', fromHash);
fromHash();
