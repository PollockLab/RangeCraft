// Red List export panel wiring: code selects and the download button. Format logic lives in iucn.js.
import { buildIucn, iucnFilename, CODES, DEFAULTS, MAP_STATUS } from './iucn.js';
import { loadRange } from './api.js';
import { download } from './export.js';
import { shownName } from './board.js';

// Returns { select(id) }: call it when the selected polygon changes so the code selects edit that polygon's codes.
export function initIucnUi({ $, state, draw, say, writeHash }) {
  const defaults = Object.fromEntries(Object.keys(CODES).map(k => [k, DEFAULTS[k]])), perFeature = new Map(); // Terra Draw id -> own codes
  let selected = null;
  const show = () => { for (const k of Object.keys(CODES)) $(`iucn-${k}`).value = (selected != null && perFeature.get(selected)?.[k]) || defaults[k]; $('iucn-sel').hidden = selected == null; };
  for (const [k, labels] of Object.entries(CODES)) {
    const sel = Object.assign(document.createElement('select'), { id: `iucn-${k}` });
    sel.append(...labels.map((l, i) => Object.assign(document.createElement('option'), { value: i + 1, textContent: `${i + 1} ${l}`, selected: i + 1 === DEFAULTS[k] })));
    const field = Object.assign(document.createElement('div'), { className: 'field' });
    field.append(Object.assign(document.createElement('label'), { htmlFor: sel.id, textContent: k[0] + k.slice(1).toLowerCase() }), sel);
    sel.addEventListener('change', () => { if (selected != null) perFeature.set(selected, { ...perFeature.get(selected), [k]: sel.value }); else defaults[k] = sel.value; });
    $('iucn-codes').append(field);
  }
  $('iucn-status').append(...MAP_STATUS.map(v => Object.assign(document.createElement('option'), { value: v, textContent: v, selected: v === 'Incomplete' })));
  $('export-iucn').addEventListener('click', async () => {
    try {
      if (!state.taxon) throw new Error('Select a species first.');
      let features = (draw()?.all() ?? []).map(f => ({ geometry: f.geometry, properties: perFeature.get(f.id) })), compiler = $('author').value.trim();
      const drawn = features.length > 0;
      if (!features.length) { // no drawing: use the ticked community ranges
        const rs = [...document.querySelectorAll('#versions input:checked')].map(b => state.index.find(r => `v-${r.id}` === b.id)).filter(Boolean);
        if (!rs.length) throw new Error('Draw a polygon or tick a community range first.');
        features = (await Promise.all(rs.map(r => loadRange(r.file)))).flatMap(fc => fc.features ?? []);
        compiler = [...new Set(rs.map(r => shownName(r.author)))].join('; ');
      }
      writeHash();
      const m = { sciName: state.taxon.name, compiler, url: location.href, source: $('sources').value.trim(), mapStatus: $('iucn-status').value, year: new Date().getFullYear(), derived: drawn ? state.copy?.derived : undefined };
      for (const k of Object.keys(CODES)) m[k.toLowerCase()] = defaults[k];
      download(buildIucn(features, m), iucnFilename(m.sciName, m.year));
      say('Downloaded IUCN-format GeoJSON. ID_NO is blank for the assessor.');
    } catch (e) { say(e.message); }
  });
  return { select(id) { selected = id; show(); } };
}
