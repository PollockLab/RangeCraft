// Compare-panel row for the iNaturalist model range: a reference layer, and a base for patch editing.
import { inatId, inatRange, inatSlug, inatNote, inatTaxonUrl } from './inat.js';

const PURPLE = '#7b2cbf', EDIT = 'Edit (saved as a patch)';

export function initInat({ map, state, $, say, patch, legend }) {
  let cur = null; // { id, version, slug } for the selected taxon, once its range is found
  const clear = () => {
    for (const id of ['inat-line']) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource('inat')) map.removeSource('inat');
    cur = null;
    $('inat').hidden = true; $('inat-row').hidden = true; $('inat-toggle').checked = false;
  };
  function show(on) {
    if (on && !map.getSource('inat')) {
      inatRange(cur.id, cur.version).then(fc => {
        if (!cur || map.getSource('inat') || !$('inat-toggle').checked) return;
        map.addSource('inat', { type: 'geojson', data: fc, attribution: 'iNaturalist geomodel, CC BY 4.0' });
        map.addLayer({ id: 'inat-line', type: 'line', source: 'inat', layout: { 'line-cap': 'round' }, paint: { 'line-color': PURPLE, 'line-width': 2.5, 'line-dasharray': [0.1, 2] } }, 'occ');
      }).catch(e => say(e.message));
    }
    if (map.getLayer('inat-line')) map.setLayoutProperty('inat-line', 'visibility', on ? 'visible' : 'none');
  }
  $('inat-toggle').addEventListener('change', e => { if (cur) show(e.target.checked); });
  $('inat-edit').addEventListener('click', async () => {
    if (state.patch) return $('official-edit').click(); // same stop path as the official edit button
    say('Loading the iNaturalist range...');
    try { if (await patch.enter(cur.slug)) say('Patch mode: use Add area and Cut area. Only your shapes are saved, never the iNaturalist range.'); legend(); } catch (e) { say(e.message); }
  });

  return {
    // Resolve the taxon's iNat range (latest model version) and show the row, or a short note when there is none.
    async load(taxon) {
      clear();
      let id, fc;
      try { id = await inatId(taxon.key); fc = id && await inatRange(id, 'latest'); } catch (e) { if (state.taxon === taxon) { $('inat').hidden = false; $('inat-note').textContent = `iNaturalist range unavailable: ${e.message}`; } return; }
      if (state.taxon !== taxon) return;
      $('inat').hidden = false;
      $('inat-note').textContent = fc ? '' : 'No iNaturalist model range for this species.';
      if (!fc) return;
      const version = fc.properties.geomodel_version;
      cur = { id, version, slug: inatSlug(id, version) };
      $('inat-row').hidden = false;
      $('inat-info').replaceChildren(`${inatNote(version)} `, Object.assign(document.createElement('a'), { href: inatTaxonUrl(id), target: '_blank', rel: 'noopener', textContent: 'View taxon on iNaturalist' }));
    },
    // Legend rows; also keeps the edit button in step with patch mode (called whenever the legend refreshes).
    legend() {
      const b = $('inat-edit'), mine = !!cur && state.patch?.base === cur.slug;
      b.textContent = mine ? 'Stop patch editing' : EDIT;
      b.disabled = !!state.patch && !mine; // another base is being edited: stop it first
      return cur && $('inat-toggle').checked ? [{ label: 'iNaturalist model range (reference)', dashed: 'dotted' }] : [];
    },
  };
}
