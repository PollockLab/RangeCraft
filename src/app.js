import { speciesName, occurrenceTiles, loadIndex, loadExperts, loadRange, REPO, RELAY_URL } from './api.js';
import * as relay from './relay.js';
import { initSearch } from './search.js';
import { buildCollection, download, proposeUrl, ORCID_RE, INAT_RE, GITHUB_RE } from './export.js';
import { findOfficial, fetchOutline, sdmTiles, sdmBounds, gbifSearchUrl } from './official.js';
import { loadConsensus, loadConsensusSummary, shareFill, summaryText, kOfN, PALETTE } from './consensus.js';
import { initDraw } from './draw.js';
import { renderBoard, findExpert, expertiseLine, shownName } from './board.js';
import { buildHash, parseHash } from './share.js';

const $ = id => document.getElementById(id);
const COLORS = ['#e4572e', '#17bebb', '#ffc914', '#76b041', '#9b5de5', '#f15bb5'];
const state = { taxon: null, index: null, experts: null, shown: new Set(), official: null };

const map = new maplibregl.Map({
  container: 'map', style: 'https://tiles.openfreemap.org/styles/positron', center: [0, 20], zoom: 1.5,
});
map.addControl(new maplibregl.NavigationControl(), 'top-right');

const say = t => { $('msg').textContent = t; };
const mapReady = new Promise(res => map.once('load', res));

// ---- drawing tools ----
let draw;
const TOOLS = { polygon: 't-polygon', freehand: 't-freehand', select: 't-select' };
const syncTools = () => { for (const [m, id] of Object.entries(TOOLS)) $(id).setAttribute('aria-pressed', draw?.mode() === m); };
mapReady.then(() => { draw = initDraw(map, id => { $('t-delete').disabled = id == null; syncTools(); }); });
for (const [m, id] of Object.entries(TOOLS)) $(id).addEventListener('click', () => { if (draw) { draw.setMode(m); syncTools(); } });
$('t-delete').addEventListener('click', () => { draw?.removeSelected(); });

// Load GeoJSON from a file input or a drop on the map; replaces what is in the editor.
async function loadFile(file) {
  if (!file) return;
  try {
    if (!draw) await mapReady;
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

// ---- taxon selection ----
async function selectTaxon({ key, name }) {
  state.taxon = { key: String(key), name };
  setRustgis(null);
  $('selected').textContent = `${name} (GBIF ${key})`;
  $('share').hidden = false;
  await mapReady;
  setOccurrences();
  setOfficialUi(null);
  state.officialReady = loadOfficialMatch(state.taxon);
  loadAgreement(state.taxon);
  await showVersions();
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

const fmtScore = (s, r) => {
  if (!s) return 'not yet scored';
  const bits = [];
  if (s.window_all) bits.push(`${Math.round((s.inside_all / s.window_all) * 100)}% of all nearby GBIF records inside`);
  bits.push(s.window_post ? `${s.inside_post}/${s.window_post} records since edit inside` : 'no records since edit yet');
  if (s.skill != null) bits.push(`skill ${Number(s.skill).toFixed(2)} (new records inside vs expected by chance)`);
  if (r.edit_date) bits.push(`edited ${r.edit_date}`);
  return bits.join(', ');
};

async function showVersions() {
  clearRanges();
  const ul = $('versions');
  state.index ??= await loadIndex();
  state.experts ??= await loadExperts();
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
    lab.append(`${shownName(r.author)}, ${r.created}`);
    const sc = document.createElement('div');
    sc.className = 'muted';
    sc.textContent = fmtScore(r.score, r);
    const edit = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Edit a copy' });
    cb.addEventListener('change', () => { setRustgis(cb.checked ? r.file : null); toggleRange(r, color, cb.checked).catch(e => say(e.message)); writeHash(); });
    edit.addEventListener('click', async () => {
      try { const fc = await loadRange(r.file); draw.load(fc); setRustgis(r.file); say('Loaded into the editor. Modify it, then export or propose.'); }
      catch (e) { say(e.message); }
    });
    li.append(cb, lab, sc);
    const ex = expertiseLine(findExpert(state.experts, r.author), state.taxon.key);
    if (ex) li.append(ex);
    li.append(edit);
    return li;
  }));
  rs.forEach((r, i) => toggleRange(r, COLORS[i % COLORS.length], true).catch(e => say(e.message)));
}

// ---- export / propose ----
function current() {
  if (!state.taxon) { say('Select a species first.'); return null; }
  const features = draw?.all() ?? [];
  if (!features.length) { say('Draw at least one polygon first.'); return null; }
  const author = $('author').value.trim();
  if (!author) { say('Enter a display name.'); $('author').focus(); return null; }
  const github = $('github').value.trim();
  if (github && !GITHUB_RE.test(github)) { say('GitHub username: letters, digits, hyphens, up to 39.'); $('github').focus(); return null; }
  const orcid = $('orcid').value.trim(), inat = $('inat').value.trim();
  if (orcid && !ORCID_RE.test(orcid)) { say('ORCID must look like 0000-0002-1825-0097.'); $('orcid').focus(); return null; }
  if (inat && !INAT_RE.test(inat)) { say('iNaturalist username: letters, digits, _ or -.'); $('inat').focus(); return null; }
  return buildCollection(features, { taxonKey: state.taxon.key, scientificName: state.taxon.name, author, github, orcid, inat, sources: $('sources').value.trim() });
}
$('export').addEventListener('click', () => { const fc = current(); if (fc) { download(fc); say('Downloaded.'); } });
$('propose').addEventListener('click', () => {
  const fc = current();
  if (!fc) return;
  if (!fc.properties.sources) { say('Add sources and evidence before proposing.'); $('sources').focus(); return; }
  const url = proposeUrl(fc);
  if (url) { window.open(url, '_blank', 'noopener'); say('Opened GitHub. Commit the new file to open a pull request.'); }
  else { download(fc); say(`Range too large for a link. Downloaded; upload it at github.com/PollockLab/rangecraft under data/ranges/${fc.properties.taxonKey}/ via "Add file > Upload files", then open a pull request.`); }
});

// ---- relay: submit without a GitHub account ----
const stashDraft = () => relay.saveDraft({ features: draw?.all() ?? [], ...Object.fromEntries(['author', 'github', 'orcid', 'inat', 'sources'].map(k => [k, $(k).value])) });
async function initRelay() {
  if (!RELAY_URL) return;
  const err = relay.takeSession();
  const draft = relay.takeDraft();
  if (draft) {
    for (const k of ['author', 'github', 'orcid', 'inat', 'sources']) if (draft[k]) $(k).value = draft[k];
    mapReady.then(() => { try { draw.load({ type: 'FeatureCollection', features: draft.features }); } catch (e) { say(`Could not restore your drawing: ${e.message}`); } });
  }
  let enabled;
  try { enabled = await relay.providers(); } catch { return; } // relay down: keep the GitHub route only
  if (!enabled.length) return;
  $('relay').hidden = false;
  $('propose').textContent = 'Have a GitHub account? Propose via GitHub';
  $('propose').classList.remove('primary');
  const s = relay.session();
  $('relay-who').textContent = s ? `Signed in as ${s.name} (${s.provider}${s.verified ? ', verified' : ', unverified'}).` : 'Sign in to submit without a GitHub account.';
  $('relay-submit').hidden = !s;
  $('relay-buttons').replaceChildren(...enabled.filter(p => p !== 'email').map(p => {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: `${s ? 'Switch to' : 'Sign in with'} ${relay.LABELS[p]}` });
    b.addEventListener('click', () => { stashDraft(); location.href = relay.signInUrl(p); });
    return b;
  }));
  $('relay-email').hidden = !enabled.includes('email');
  if (err) say(err === 'denied' ? 'Sign-in was cancelled.' : 'Sign-in failed. Try again or use another provider.');
}
$('relay-mail-send').addEventListener('click', async () => {
  try { stashDraft(); await relay.emailStart($('relay-mail').value.trim(), $('author').value.trim()); say('Check your inbox, the link is valid for 15 minutes. Your drawing is restored when you open it.'); }
  catch (e) { say(e.message); }
});
$('relay-submit').addEventListener('click', async () => {
  const s = relay.session();
  if (!s) { say('Your sign-in expired. Sign in again.'); $('relay-submit').hidden = true; return; }
  const fc = current();
  if (!fc) return;
  if (!fc.properties.sources) { say('Add sources and evidence before submitting.'); $('sources').focus(); return; }
  $('relay-submit').disabled = true;
  say('Submitting...');
  try {
    const url = await relay.submit(fc, fc.properties.sources, s.token);
    $('relay-link').replaceChildren('Submitted: ', Object.assign(document.createElement('a'), { href: url, textContent: url, target: '_blank', rel: 'noopener' }));
    say('Pull request opened. Reviewers will take it from here.');
  } catch (e) { say(e.message); }
  $('relay-submit').disabled = false;
});
initRelay();

$('occ-toggle').addEventListener('change', e => {
  if (map.getLayer('occ')) map.setLayoutProperty('occ', 'visibility', e.target.checked ? 'visible' : 'none');
  writeHash();
});

// ---- contributors ----
async function showBoard() {
  state.experts ??= await loadExperts();
  renderBoard(state.experts, { table: $('board'), empty: $('board-empty') });
}

// ---- official outline + SDM ----
function setOfficialUi(match) {
  state.official = match ? { ...match, fc: null } : null;
  for (const id of ['official-line', 'sdm']) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of ['official', 'sdm']) if (map.getSource(id)) map.removeSource(id);
  $('official').hidden = !match;
  $('official-load').hidden = false;
  $('sdm-toggle').checked = false;
  if (match) {
    $('official-note').textContent = `${match.common} (${match.sci}): official expert outline available for reference. Coarse outlines can spill past coastlines.`;
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
    if (fit && !b.isEmpty()) map.fitBounds(b, { padding: 40, duration: 0 });
    say('Official outline shown (dashed), reference only.');
    writeHash();
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
async function loadAgreement(taxon) {
  for (const id of ['agree-fill']) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource('agree')) map.removeSource('agree');
  $('agreement').hidden = true;
  const [fc, sum] = await Promise.all([loadConsensus(taxon.key), loadConsensusSummary(taxon.key)]);
  if (state.taxon !== taxon || !fc) return;
  map.addSource('agree', { type: 'geojson', data: fc });
  map.addLayer({ id: 'agree-fill', type: 'fill', source: 'agree', paint: { 'fill-color': shareFill, 'fill-opacity': 0.55 },
    layout: { visibility: $('agree-toggle').checked ? 'visible' : 'none' } }, 'occ');
  const n = fc.properties?.voters?.length ?? fc.features[0].properties.voters;
  $('agree-summary').textContent = summaryText(sum);
  $('agree-legend').replaceChildren(`k of ${n} experts agree: few `, ...PALETTE.map(c => Object.assign(document.createElement('span'), {
    style: `display:inline-block;width:1rem;height:.8rem;background:${c}` })), ' all');
  $('agreement').hidden = false;
}
$('agree-toggle').addEventListener('change', e => {
  if (map.getLayer('agree-fill')) map.setLayoutProperty('agree-fill', 'visibility', e.target.checked ? 'visible' : 'none');
  writeHash();
});
map.on('click', 'agree-fill', e => {
  if (['polygon', 'freehand'].includes(draw?.mode())) return;
  new maplibregl.Popup().setLngLat(e.lngLat).setText(kOfN(e.features[0].properties)).addTo(map);
});

// ---- how it works ----
if (localStorage.getItem('rc-how') === 'off') $('how').hidden = true;
$('how-close').addEventListener('click', () => { $('how').hidden = true; localStorage.setItem('rc-how', 'off'); });

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
// ---- shareable links: the hash mirrors the view, so the address bar is always a link to it ----
let restoring = false;
function writeHash() {
  if (restoring || !state.taxon) return;
  const boxes = [...document.querySelectorAll('#versions input[type=checkbox]')];
  const on = boxes.filter(b => b.checked).map(b => b.id.slice(2));
  const c = map.getCenter();
  const h = buildHash({
    taxon: state.taxon.key, ranges: on.length < boxes.length ? on : null,
    official: !!state.official?.fc, sdm: $('sdm-toggle').checked,
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
    $('q').value = name;
    await selectTaxon({ key: s.taxon, name });
    if (s.ranges) for (const b of document.querySelectorAll('#versions input[type=checkbox]')) {
      if (!s.ranges.includes(b.id.slice(2)) && b.checked) { b.checked = false; b.dispatchEvent(new Event('change')); }
    }
    for (const k of ['occ', 'agree']) if ($(`${k}-toggle`).checked !== s[k]) { $(`${k}-toggle`).checked = s[k]; $(`${k}-toggle`).dispatchEvent(new Event('change')); }
    await state.officialReady;
    if (s.official && state.official) await showOfficial({ fit: !s.at });
    if (s.sdm && state.official) { $('sdm-toggle').checked = true; $('sdm-toggle').dispatchEvent(new Event('change')); }
    if (s.at) map.jumpTo({ zoom: s.at[0], center: [s.at[2], s.at[1]] });
  } catch (e) { say(`Could not load taxon ${s.taxon}: ${e.message}`); }
  finally { restoring = false; writeHash(); lastHash = location.hash; }
}
let lastHash = '';
addEventListener('hashchange', fromHash);
fromHash();

$('share').addEventListener('click', async () => {
  writeHash();
  try { await navigator.clipboard.writeText(location.href); say('Link copied. It opens this species with the same layers and view.'); }
  catch { say(`Copy this link: ${location.href}`); }
});
