// Red List export panel wiring: code selects and the download button. Format logic lives in iucn.js.
import { buildIucn, iucnFilename, CODES, DEFAULTS } from './iucn.js';
import { loadRange } from './api.js';
import { download } from './export.js';
import { shownName } from './board.js';

export function initIucnUi({ $, state, draw, say, writeHash }) {
  for (const [k, labels] of Object.entries(CODES)) {
    const sel = Object.assign(document.createElement('select'), { id: `iucn-${k}` });
    sel.append(...labels.map((l, i) => Object.assign(document.createElement('option'), { value: i + 1, textContent: `${i + 1} ${l}`, selected: i + 1 === DEFAULTS[k] })));
    const field = Object.assign(document.createElement('div'), { className: 'field' });
    field.append(Object.assign(document.createElement('label'), { htmlFor: sel.id, textContent: k[0] + k.slice(1).toLowerCase() }), sel);
    $('iucn-codes').append(field);
  }
  $('export-iucn').addEventListener('click', async () => {
    try {
      if (!state.taxon) throw new Error('Select a species first.');
      let features = draw()?.all() ?? [], compiler = $('author').value.trim();
      const drawn = features.length > 0;
      if (!features.length) { // no drawing: use the ticked community ranges
        const rs = [...document.querySelectorAll('#versions input:checked')].map(b => state.index.find(r => `v-${r.id}` === b.id)).filter(Boolean);
        if (!rs.length) throw new Error('Draw a polygon or tick a community range first.');
        features = (await Promise.all(rs.map(r => loadRange(r.file)))).flatMap(fc => fc.features ?? []);
        compiler = [...new Set(rs.map(r => shownName(r.author)))].join('; ');
      }
      writeHash();
      const m = { sciName: state.taxon.name, compiler, url: location.href, source: $('sources').value.trim(), year: new Date().getFullYear(), derived: drawn ? state.copy?.derived : undefined };
      for (const k of Object.keys(CODES)) m[k.toLowerCase()] = $(`iucn-${k}`).value;
      download(buildIucn(features, m), iucnFilename(m.sciName, m.year));
      say('Downloaded IUCN-format GeoJSON. ID_NO is blank for the assessor.');
    } catch (e) { say(e.message); }
  });
}
