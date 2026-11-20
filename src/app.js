import { speciesName, occurrenceTiles, loadIndex, loadExperts, loadRange, REPO, RELAY_URL } from './api.js';
import { initSearch } from './search.js';
import { buildCollection, download, proposeUrl, ORCID_RE, INAT_RE, GITHUB_RE } from './export.js';
import { findOfficial, fetchOutline, sdmTiles, sdmBounds, gbifSearchUrl } from './official.js';
import { loadConsensus, loadConsensusSummary, shareFill, summaryText, kOfN, PALETTE } from './consensus.js';
import { initDraw, DRAFT } from './draw.js';
import { renderBoard, findExpert, expertiseLine, shownName, fmtScore } from './board.js';
import { buildHash, parseHash } from './share.js';
import { initGroups, speciesByGroup } from './groups.js';
import { initLegend } from './legend.js';
import { initIucnUi } from './iucn-ui.js';
import { initRangeCheck } from './rangecheck-ui.js';
import { initReshape } from './reshape-ui.js';
import { initEoo } from './eoo-ui.js';
import { initCopy } from './copy.js';
import { initHistory } from './history-ui.js';
import { initSteps } from './steps.js';
import { initSaved } from './saved.js';
import { initRelayUi } from './relay-ui.js';
import { initPatch } from './patch-ui.js';

const $ = id => document.getElementById(id);
const COLORS = ['#e4572e', '#17bebb', '#ffc914', '#76b041', '#9b5de5', '#f15bb5'];
const state = { taxon: null, index: null, experts: null, shown: new Set(), official: null, copy: null }; // copy: { id, derived } while the editor holds an edited copy of a community range

const narrow = matchMedia('(max-width: 700px)').matches, touch = matchMedia('(pointer: coarse)').matches;
const map = new maplibregl.Map({
  container: 'map', style: 'https://tiles.openfreemap.org/styles/positron', center: [0, 20], zoom: 1.5, attributionControl: false,
});
const attrib = new maplibregl.AttributionControl({ compact: narrow });
map.addControl(attrib);
// Start collapsed so it stays clear of the legend; MapLibre re-opens it when sources add attributions, so collapse again once settled.
const collapseAttrib = () => { const c = attrib._container; c.removeAttribute('open'); c.classList.remove('maplibregl-compact-show'); };
if (narrow) map.once('idle', () => setTimeout(collapseAttrib, 0));
if (!touch) map.addControl(new maplibregl.NavigationControl(), 'top-right'); // touch: pinch zooms, and the toolbar needs the width
// Leave room for the toolbar (top) so a fitted range is not hidden under it.
const fitPad = narrow ? { top: 70, bottom: 20, left: 20, right: 20 } : 40;

const setLegend = initLegend(map);
const rangeCheck = initRangeCheck({ map, state, onChange: () => { updateLegend(); eooUi(); }, drawing: () => ['polygon', 'freehand'].includes(draw?.mode()), draft: () => draw?.all() ?? [], say: t => say(t) });
const eooUi = initEoo({ $, draw: () => draw, points: () => rangeCheck.points(), presence: f => iucn.presence(f) });
const say = t => { $('msg').textContent = t; };
const steps = initSteps({ state, draw: () => draw, $ }); steps();
const mapReady = new Promise(res => map.once('load', res));

// ---- drawing tools ----
let draw;
const TOOLS = { polygon: 't-polygon', freehand: 't-freehand', add: 't-add', cut: 't-cut', select: 't-select' };
const HINTS = {
  polygon: 'Click to add points, click the first point to finish. Esc cancels.',
  freehand: 'Click to start, move to draw, click again to finish. Esc cancels.',
  add: 'Draw around the area to add (click to start, click again to finish). Esc cancels.',
  cut: 'Draw around the area to cut away (click to start, click again to finish). Esc cancels.',
  select: 'Click a shape to select it, then drag it or its vertices. Delete removes it.',
};
const touchHint = m => m === 'polygon' ? 'Tap to add points, then tap Done (or the first point).' : HINTS[m]?.replace(' Esc cancels.', ' Tap Cancel to stop.').replace(/\bClick\b/g, 'Tap').replace(/\bclick\b/g, 'tap');
const syncTools = () => {
  for (const [m, id] of Object.entries(TOOLS)) $(id).setAttribute('aria-pressed', draw?.mode() === m);
  const m = draw?.mode();
  $('hint').textContent = (touch ? touchHint(m) : HINTS[m]) ?? '';
  $('hint').dataset.idle = !HINTS[m];
  $('draw-actions').hidden = !touch || !HINTS[m] || m === 'select';
};
const setTool = m => { if (draw) { draw.setMode(m); syncTools(); } };
// The propose card appears once at least one finished shape exists.
const syncCard = () => { const n = (draw?.all().length ?? 0) + (state.patch?.shapes.length ?? 0); $('change-field').hidden = !(state.copy || state.patch); $('propose-box').hidden = !n; eooUi(); $('draw-hint').hidden = !!n; reshape.sync(n || state.patch); dimSource(n); rangeCheck.refresh(); steps(); };
const reshape = initReshape({ draw: () => draw, say });
const { copyRange, dimSource } = initCopy({ map, state, draw: () => draw, reshape, setRustgis });
const lineage = initHistory({ map, state, say });
const patch = initPatch({ map, state, $, say, draw: () => draw, sync: () => syncCard(), showOfficial: () => showOfficial() });
// After a finished polygon/freehand shape, leave the drawing tool (deferred: Terra Draw is still closing the mode).
const drawn = () => setTimeout(() => { setTool('static'); say('Range drawn. Check it, then propose it below.'); });
mapReady.then(() => { draw = initDraw(map, id => { $('t-delete').disabled = id == null; iucn.select(id); syncTools(); }, syncCard, (op, sk) => patch.active() ? patch.sketch(op, sk) : reshape.apply(op, sk), () => reshape.reset(), drawn); syncTools(); });
$('open-propose').addEventListener('click', () => openPropose($('propose-form').hidden));
function openPropose(open) { $('propose-form').hidden = !open; $('open-propose').setAttribute('aria-expanded', open); }
syncTools();
for (const [m, id] of Object.entries(TOOLS)) $(id).addEventListener('click', () => setTool(m));
addEventListener('keydown', e => {
  if (!draw || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (e.key === 'Escape' && draw.mode() !== 'static') setTool('static');
  else if ((e.key === 'Delete' || e.key === 'Backspace') && draw.removeSelected()) e.preventDefault();
});
$('draw-done').addEventListener('click', () => draw?.finish());
$('draw-cancel').addEventListener('click', () => setTool('static'));
$('t-delete').addEventListener('click', () => { draw?.removeSelected(); });

// Load GeoJSON from a file input or a drop on the map; replaces what is in the editor.
async function loadFile(file) {
  if (!file) return;
  try {
    if (!draw) await mapReady;
    state.copy = null;
    const n = draw.load(JSON.parse(await file.text()));
    if (!n) throw new Error('No polygons found in that file.');
    say(`Loaded ${n} polygon${n === 1 ? '' : 's'} from ${file.name}. Modify them, then export or propose.`);
  } catch (e) { say(`Could not load ${file.name}: ${e.message}`); }
}
$('load-file').addEventListener('change', e => { loadFile(e.target.files[0]); e.target.value = ''; });
$('map').addEventListener('dragover', e => e.preventDefault());
$('map').addEventListener('drop', e => { e.preventDefault(); loadFile(e.dataTransfer.files[0]); });

// "Open in RustGIS" needs a CORS-fetchable URL, so only published community files qualify.
function setRustgis(file) {
  const a = $('rustgis');
  a.hidden = !file;
  if (file) a.href = `https://web.rustgis.app/?blank&data=${encodeURIComponent(`https://raw.githubusercontent.com/${REPO}/main/${file.startsWith('data/') ? file : `data/ranges/${file}`}`)}`;
}

// Until a species is picked, the layer toggles do nothing (disabled with a reason) and the drawing toolbar is hidden.
const LOCKED = ['occ-toggle', 'rc-toggle', ...Object.values(TOOLS).filter(id => id !== 't-cut')], NEED = 'Pick a species first';
function lock(on) {
  for (const id of LOCKED) { const e = $(id); e.dataset.tip ??= e.title; e.disabled = on; e.title = on ? NEED : e.dataset.tip; }
  $('tools').hidden = on;
  $('draw-hint').textContent = on ? 'Pick a species to start.' : 'Draw on the map to propose a range';
}
lock(true);
for (const b of document.querySelectorAll('#intro .example')) b.addEventListener('click', () => selectTaxon({ key: b.dataset.key, name: b.dataset.name }));

// ---- taxon selection ----
async function selectTaxon({ key, name }, { fit = true } = {}) {
  if (state.taxon && String(key) !== state.taxon.key && draw?.all().length) {
    if (!confirm(`Discard your unsaved drawing for ${state.taxon.name}?`)) { $('q').value = state.taxon.name; writeHash(); return; }
    state.copy = null; setTool('static'); draw.load({ type: 'FeatureCollection', features: [] }); // load fires syncCard: resets undo, dimmed source, range check
  }
  say('');
  state.taxon = { key: String(key), name };
  state.copy = null;
  lineage.clear(); patch.exit();
  setRustgis(null);
  $('selected').textContent = `${name} (GBIF ${key})`;
  $('selected').hidden = $('intro').hidden = true; if (!$('how').dataset.seen) { $('how').dataset.seen = '1'; $('how').open = false; } // collapse on the first pick only; rc-how is untouched
  lock(false);
  steps();
  $('share').hidden = false;
  $('q').value = name;
  await mapReady;
  setOccurrences();
  rangeCheck.clear();
  setOfficialUi(null);
  state.officialReady = loadOfficialMatch(state.taxon);
  loadAgreement(state.taxon);
  await showVersions(fit);
  updateLegend();
  writeHash();
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

async function fitRanges(rs) {
  const taxon = state.taxon, b = new maplibregl.LngLatBounds();
  const walk = c => (typeof c[0] === 'number' ? b.extend(c) : c.forEach(walk));
  try { for (const r of rs) for (const f of (await loadRange(r.file)).features ?? []) walk(f.geometry.coordinates); } catch { return; }
  if (state.taxon === taxon && !b.isEmpty()) map.fitBounds(b, { padding: fitPad, duration: 0, maxZoom: 6 });
}

function updateLegend() {
  const items = [];
  if (state.taxon) {
    if ($('occ-toggle').checked) items.push({ label: 'GBIF occurrences', swatch: 'linear-gradient(90deg,#ffe066,#e5383b)' });
    if (state.official?.fc) items.push({ label: 'Official range (reference)', dashed: true });
    if (state.official && $('sdm-toggle').checked) items.push({ label: 'Habitat model', swatch: 'linear-gradient(90deg,#440154,#21918c,#fde725)' });
    items.push(...rangeCheck.legend());
    for (const b of document.querySelectorAll('#versions input:checked')) items.push({ label: b.dataset.label, swatch: b.dataset.color });
    if (draw?.all().length) items.push({ label: 'Your draft', swatch: DRAFT });
    if (!$('agree-body').hidden && $('agree-toggle').checked) items.push({ label: 'Agreement (few to all)', palette: PALETTE });
  }
  setLegend(items);
}
$('panel').addEventListener('change', updateLegend);

async function toggleRange(r, color, on) {
  const id = `range-${r.id}`;
  if (!on) { map.setLayoutProperty(`${id}-fill`, 'visibility', 'none'); map.setLayoutProperty(`${id}-line`, 'visibility', 'none'); return; }
  if (!map.getSource(id)) {
    const data = await patch.display(await loadRange(r.file));
    map.addSource(id, { type: 'geojson', data });
    map.addLayer({ id: `${id}-fill`, type: 'fill', source: id, paint: { 'fill-color': color, 'fill-opacity': 0.3 } }, 'occ');
    map.addLayer({ id: `${id}-line`, type: 'line', source: id, paint: { 'line-color': color, 'line-width': 2 } }, 'occ');
  }
  map.setLayoutProperty(`${id}-fill`, 'visibility', 'visible');
  map.setLayoutProperty(`${id}-line`, 'visibility', 'visible');
}

async function showVersions(fit = true) {
  clearRanges();
  const ul = $('versions');
  state.index ??= await loadIndex();
  state.experts ??= await loadExperts();
  const rs = state.index.filter(r => String(r.taxonKey) === state.taxon.key).sort((a, b) => b.created.localeCompare(a.created));
  if (!rs.length) {
    const first = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Draw the first range' });
    first.addEventListener('click', () => { setTool('polygon'); say('Draw on the map, then propose it from the card at the bottom of the panel.'); });
    const li = document.createElement('li');
    li.append('No community ranges for this species yet. ', first);
    ul.replaceChildren(li);
    return;
  }
  ul.replaceChildren(...rs.map((r, i) => {
    const color = COLORS[i % COLORS.length];
    const li = document.createElement('li');
    const row = Object.assign(document.createElement('div'), { className: 'lyr' });
    const more = Object.assign(document.createElement('div'), { className: 'more', hidden: true });
    const tgl = Object.assign(document.createElement('button'), { type: 'button', className: 'more-btn', textContent: '⋯', title: 'Score and coverage' });
    tgl.setAttribute('aria-expanded', false);
    tgl.addEventListener('click', () => { more.hidden = !more.hidden; tgl.setAttribute('aria-expanded', !more.hidden); });
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', id: `v-${r.id}`, checked: true });
    cb.dataset.color = color;
    cb.dataset.file = r.file;
    cb.dataset.author = r.display ?? shownName(r.author);
    cb.dataset.label = `${shownName(r.author)}, ${r.created}`;
    const lab = document.createElement('label');
    lab.htmlFor = cb.id;
    lab.style.fontWeight = '400';
    lab.innerHTML = '<span class="swatch" aria-hidden="true"></span> ';
    lab.firstChild.style.cssText = `display:inline-block;width:.8rem;height:.8rem;background:${color};border-radius:3px`;
    lab.append(`${shownName(r.author)}, ${r.created}`);
    const sc = document.createElement('div');
    sc.className = 'muted';
    sc.textContent = fmtScore(r.score, r);
    const edit = Object.assign(document.createElement('button'), { type: 'button', className: 'edit', textContent: 'Edit', title: 'Edit this range. Your version is saved as a new revision linked to this one; the original stays.' });
    cb.addEventListener('change', () => { setRustgis(cb.checked ? r.file : null); toggleRange(r, color, cb.checked).catch(e => say(e.message)); writeHash(); });
    edit.addEventListener('click', async () => {
      try { await (r.basis === 'official-patch' ? patch.edit(r) : copyRange(r)); say('Copied into the editor. Drag vertices with Edit, or use Add area / Cut area to reshape.'); }
      catch (e) { say(e.message); }
    });
    const check = Object.assign(document.createElement('span'), { className: 'check' });
    check.append(cb, lab);
    row.append(check, edit, lineage.button(r), tgl);
    more.append(sc);
    const ex = expertiseLine(findExpert(state.experts, r.author), state.taxon.key);
    if (ex) more.append(ex);
    li.append(row);
    loadRange(r.file).then(fc => {
      if (fc.properties?.coverage) li.append(Object.assign(document.createElement('div'), { className: 'muted cov', textContent: fc.properties.coverage }));
    }).catch(() => {}).finally(() => li.append(more));
    return li;
  }));
  rs.forEach((r, i) => toggleRange(r, COLORS[i % COLORS.length], true).catch(e => say(e.message)));
  if (fit) fitRanges(rs);
}

// ---- export / propose ----
// needName: proposing needs a display name, plain exports do not (COMPILER stays blank).
function current(needName = false) {
  if (!state.taxon) { say('Select a species first.'); return null; }
  const features = draw?.all() ?? [];
  if (!features.length && !state.patch?.shapes.length) { say('Draw at least one polygon first.'); return null; }
  const author = $('author').value.trim();
  if (needName && !author) { say('Enter a display name.'); $('author').setAttribute('aria-invalid', 'true'); openPropose(true); $('author').focus(); return null; }
  const github = $('github').value.trim();
  if (github && !GITHUB_RE.test(github)) { say('GitHub username: letters, digits, hyphens, up to 39.'); $('github').focus(); return null; }
  const orcid = $('orcid').value.trim(), inat = $('inat').value.trim();
  if (orcid && !ORCID_RE.test(orcid)) { say('ORCID must look like 0000-0002-1825-0097.'); $('orcid').focus(); return null; }
  if (inat && !INAT_RE.test(inat)) { say('iNaturalist username: letters, digits, _ or -.'); $('inat').focus(); return null; }
  const message = $('change-msg').value.trim();
  if (needName && (state.copy || state.patch) && !message) { say('Say what changed and why.'); $('change-msg').focus(); return null; }
  const meta = { message, taxonKey: state.taxon.key, scientificName: state.taxon.name, author, github, orcid, inat, sources: $('sources').value.trim(), derived: state.copy?.derived };
  return state.patch ? patch.build(features, meta) : buildCollection(features, meta);
}
$('export').addEventListener('click', () => { const fc = current(); if (fc) { download(fc); say('Downloaded.'); } });
$('propose').addEventListener('click', () => {
  const fc = current(true);
  if (!fc) return;
  if (!fc.properties.sources) { say('Add sources and evidence before proposing.'); $('sources').focus(); return; }
  const url = proposeUrl(fc);
  if (url) { window.open(url, '_blank', 'noopener'); say('Opened GitHub. Commit the new file to open a pull request.'); }
  else { download(fc); say(`Range too large for a link. Downloaded; upload it at github.com/PollockLab/rangecraft under data/ranges/${fc.properties.taxonKey}/ via "Add file > Upload files", then open a pull request.`); }
});

const iucn = initIucnUi({ $, state, draw: () => draw, say, writeHash, onChange: () => eooUi() });

initRelayUi({ $, say, current, openPropose, draw: () => draw, mapReady });

$('occ-toggle').addEventListener('change', e => {
  if (map.getLayer('occ')) map.setLayoutProperty('occ', 'visibility', e.target.checked ? 'visible' : 'none');
  writeHash();
});

// ---- contributors ----
async function showBoard() {
  state.experts ??= await loadExperts();
  state.index ??= await loadIndex();
  renderBoard(state.experts, { table: $('board'), empty: $('board-empty'), ranges: state.index });
}

// ---- official outline + SDM ----
function setOfficialUi(match) {
  state.official = match ? { ...match, fc: null } : null;
  for (const id of ['official-line', 'sdm']) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of ['official', 'sdm']) if (map.getSource(id)) map.removeSource(id);
  $('official').hidden = !match;
  $('official-load').hidden = false;
  $('sdm-toggle').checked = false;
  updateLegend();
  if (match) {
    $('official-note').textContent = `${match.common} (${match.sci})`;
    $('gbif-out').href = gbifSearchUrl(state.taxon.key);
  }
}

async function loadOfficialMatch(taxon) {
  try {
    const m = await findOfficial(taxon.key, taxon.name);
    if (state.taxon === taxon) setOfficialUi(m);
  } catch (e) { if (state.taxon === taxon) say(`Official outline list unavailable: ${e.message}`); }
}

$('official-load').addEventListener('click', () => showOfficial());
$('rc-toggle').addEventListener('change', writeHash);
async function showOfficial({ fit = true } = {}) {
  const o = state.official, taxon = state.taxon;
  say('Loading official outline...');
  try {
    const fc = await fetchOutline(o.slug);
    if (state.taxon !== taxon) return;
    o.fc = fc;
    map.addSource('official', { type: 'geojson', data: fc });
    map.addLayer({ id: 'official-line', type: 'line', source: 'official', paint: { 'line-color': '#111', 'line-width': 2, 'line-dasharray': [3, 2] } });
    $('official-load').hidden = true;
    const b = new maplibregl.LngLatBounds();
    for (const f of fc.features) f.geometry.coordinates.flat(f.geometry.type === 'Polygon' ? 1 : 2).forEach(c => b.extend(c));
    if (fit && !b.isEmpty()) map.fitBounds(b, { padding: fitPad, duration: 0 });
    say('Official outline shown (dashed), reference only.');
    updateLegend();
    writeHash();
    rangeCheck.refresh();
  } catch (e) { say(e.message); }
}
$('sdm-toggle').addEventListener('change', async e => {
  if (e.target.checked && !map.getSource('sdm')) {
    const bounds = await sdmBounds(state.official.slug);
    if (map.getSource('sdm') || !$('sdm-toggle').checked) return;
    map.addSource('sdm', { type: 'raster', tiles: [sdmTiles(state.official.slug)], tileSize: 256, attribution: 'SDM: Biodiversite Quebec', ...(bounds && { bounds }) });
    map.addLayer({ id: 'sdm', type: 'raster', source: 'sdm', paint: { 'raster-opacity': 0.6 } }, 'occ');
  }
  if (map.getLayer('sdm')) map.setLayoutProperty('sdm', 'visibility', e.target.checked ? 'visible' : 'none');
  writeHash();
});

// ---- agreement layer ----
let noun = 'experts';
async function loadAgreement(taxon) {
  for (const id of ['agree-fill']) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource('agree')) map.removeSource('agree');
  $('agree-body').hidden = true;
  state.index ??= await loadIndex();
  const [fc, sum] = await Promise.all([loadConsensus(taxon.key), loadConsensusSummary(taxon.key)]);
  if (state.taxon !== taxon || !fc) return;
  const n = fc.properties?.voters?.length ?? fc.features[0].properties.voters;
  if (n < 2) return;
  map.addSource('agree', { type: 'geojson', data: fc });
  map.addLayer({ id: 'agree-fill', type: 'fill', source: 'agree', paint: { 'fill-color': shareFill, 'fill-opacity': 0.55 },
    layout: { visibility: $('agree-toggle').checked ? 'visible' : 'none' } }, 'occ');
  const rs = state.index.filter(r => String(r.taxonKey) === taxon.key);
  noun = rs.length && rs.every(r => r.identity === 'source') ? 'sources' : 'experts';
  $('agree-summary').textContent = summaryText(sum, noun);
  $('agree-legend').replaceChildren(`k of ${n} ${noun} agree: few `, ...PALETTE.map(c => Object.assign(document.createElement('span'), {
    style: `display:inline-block;width:1rem;height:.8rem;background:${c}` })), ' all');
  $('agree-body').hidden = false;
  $('agree-sw').style.background = `linear-gradient(90deg,${PALETTE.join(',')})`;
  updateLegend();
}
$('agree-toggle').addEventListener('change', e => {
  if (map.getLayer('agree-fill')) map.setLayoutProperty('agree-fill', 'visibility', e.target.checked ? 'visible' : 'none');
  writeHash();
});
map.on('click', 'agree-fill', e => {
  if (['polygon', 'freehand'].includes(draw?.mode())) return;
  new maplibregl.Popup().setLngLat(e.lngLat).setText(kOfN(e.features[0].properties, noun)).addTo(map);
});

initSaved($);

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
initGroups({ chips: $('chips'), note: $('chips-note'), list: $('group-list'), load: async () => speciesByGroup(await loadIndex()), onSelect: selectTaxon, onSearch: () => $('q').focus() });
// ---- shareable links: the hash mirrors the view, so the address bar is always a link to it ----
let restoring = false;
function writeHash() {
  if (restoring || !state.taxon) return;
  const boxes = [...document.querySelectorAll('#versions input[type=checkbox]')];
  const on = boxes.filter(b => b.checked).map(b => b.id.slice(2));
  const c = map.getCenter();
  const h = buildHash({
    taxon: state.taxon.key, ranges: on.length < boxes.length ? on : null,
    official: !!state.official?.fc, sdm: $('sdm-toggle').checked, rc: $('rc-toggle').checked,
    occ: $('occ-toggle').checked, agree: $('agree-toggle').checked, at: [map.getZoom(), c.lat, c.lng],
  });
  if (h !== location.hash) history.replaceState(null, '', h);
}
map.on('moveend', writeHash);

async function fromHash() {
  const s = parseHash(location.hash);
  if (!s || (state.taxon?.key === s.taxon && location.hash === lastHash)) return;
  restoring = true;
  try {
    const name = await speciesName(s.taxon);
    await selectTaxon({ key: s.taxon, name }, { fit: !s.at && !s.official });
    if (s.ranges) for (const b of document.querySelectorAll('#versions input[type=checkbox]')) {
      if (!s.ranges.includes(b.id.slice(2)) && b.checked) { b.checked = false; b.dispatchEvent(new Event('change')); }
    }
    for (const k of ['occ', 'agree']) if ($(`${k}-toggle`).checked !== s[k]) { $(`${k}-toggle`).checked = s[k]; $(`${k}-toggle`).dispatchEvent(new Event('change')); }
    await state.officialReady;
    if (s.official && state.official) await showOfficial({ fit: !s.at });
    if (s.sdm && state.official) { $('sdm-toggle').checked = true; $('sdm-toggle').dispatchEvent(new Event('change')); }
    if (s.rc) { $('rc-toggle').checked = true; $('rc-toggle').dispatchEvent(new Event('change')); }
    if (s.at) map.jumpTo({ zoom: s.at[0], center: [s.at[2], s.at[1]] });
  } catch (e) { say(`Could not load taxon ${s.taxon}: ${e.message}`); }
  finally { restoring = false; updateLegend(); writeHash(); lastHash = location.hash; }
}
let lastHash = '';
addEventListener('hashchange', fromHash);
fromHash();

$('share').addEventListener('click', async () => {
  writeHash();
  try { await navigator.clipboard.writeText(location.href); say('Link copied. It opens this species with the same layers and view.'); }
  catch { say(`Copy this link: ${location.href}`); }
});
// A drag pans the map instead of drawing; say how freehand tools work so the gesture doesn't fail silently.
map.on('dragend', () => { if (draw?.mode() === 'freehand') say('Dragging moves the map. To draw, click once to start, move the pointer, then click again to finish.'); });
