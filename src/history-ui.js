// History panel for a community range: its revision log, forks, and an added/removed overlay for the selected revision.
import polygonClipping from 'https://cdn.jsdelivr.net/npm/polygon-clipping@0.15.7/+esm';
import { loadRange, REPO } from './api.js';
import { buildGraph, log } from './lineage.js';
import { revisionDiff, changeText, areaKm2, multi } from './diff.js';
import { shownName } from './board.js';
import { fetchOutline } from './official.js';
import { applyPatch } from './patch.js';

const SRC = 'history-diff', LAYERS = [['history-add', '#2a9d3f', 'add'], ['history-rem', '#d62828', 'rem']];
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

export function initHistory({ map, state, say, edit, view }) {
  let open = null; // { panel, button }

  function clearOverlay() {
    for (const [id] of LAYERS) for (const l of [`${id}-line`, id]) if (map.getLayer(l)) map.removeLayer(l);
    if (map.getSource(SRC)) map.removeSource(SRC);
    view('history', null);
  }
  function clear() { clearOverlay(); open?.panel.remove(); open?.button.setAttribute('aria-expanded', false); open = null; }

  function overlay(d) {
    clearOverlay();
    const f = (kind, coordinates) => ({ type: 'Feature', properties: { kind }, geometry: { type: 'MultiPolygon', coordinates } });
    map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [f('add', d.added), f('rem', d.removed)] } });
    for (const [id, color, kind] of LAYERS) {
      map.addLayer({ id, type: 'fill', source: SRC, filter: ['==', ['get', 'kind'], kind], paint: { 'fill-color': color, 'fill-opacity': 0.6 } });
      map.addLayer({ id: `${id}-line`, type: 'line', source: SRC, filter: ['==', ['get', 'kind'], kind], paint: { 'line-color': color, 'line-width': 2 } });
    }
  }

  // One selectable revision row. Its diff is against its parent in the graph; a root counts as all added.
  async function revision(n, onPick) {
    const r = n.range, [fc, pfc] = await Promise.all([loadRange(r.file), n.parent ? loadRange(n.parent.range.file) : null]);
    const pr = fc.properties ?? {}, ops = op => multi({ features: fc.features.filter(f => f.properties?.op === op) });
    const isPatch = x => x?.properties?.basis === 'official-patch', applied = (b, x) => ({ features: [{ geometry: { type: 'MultiPolygon', coordinates: applyPatch(b, x, polygonClipping) } }] });
    let d;
    if (isPatch(fc) && isPatch(pfc)) { const b = await fetchOutline(pr.base); d = revisionDiff(applied(b, pfc), applied(b, fc), polygonClipping); } // a patch on a patch: applied result vs the parent's, same base
    else d = isPatch(fc) ? { added: ops('add'), removed: ops('cut'), addedKm2: areaKm2(ops('add')), removedKm2: areaKm2(ops('cut')) } : revisionDiff(pfc, fc, polygonClipping); // a first patch: its own shapes
    const src = String(pr.sources ?? '').split('\n')[0], edit = n.parent || pr.basis === 'official-patch';
    // An unmessaged root is the first upload: its sources are a citation, not a change message, so they go in the tooltip.
    const head = pr.message ? `Revision by ${shownName(r.author)}, ${r.created}: '${pr.message.length > 140 ? `${pr.message.slice(0, 139)}…` : pr.message}'. ` : `${edit ? 'Revision' : 'Initial range'} by ${shownName(r.author)}, ${r.created}. `;
    const b = el('button', { type: 'button', className: 'rev', title: pr.message || src }, head, el('span', { className: 'muted', textContent: edit ? changeText(d) : '' }));
    b.addEventListener('click', () => { overlay(d); view('history', fc); say(edit ? 'Green: added vs the previous revision. Red: removed.' : 'Green: the initial range.'); onPick(b, r); });
    return b;
  }

  async function fill(panel, r) {
    const graph = buildGraph(state.index.filter(x => String(x.taxonKey) === state.taxon.key)), node = graph.get(r.id);
    if (!node) return;
    const pick = (b, rr) => { for (const x of panel.querySelectorAll('.rev')) x.setAttribute('aria-pressed', x === b); const e = panel.querySelector('.hist-edit'); e.hidden = false; e.onclick = () => edit(rr); reveal(panel); };
    const list = (nodes, label) => nodes.length ? [el('div', { className: 'muted', textContent: label }), ...nodes] : [];
    const settle = async ns => (await Promise.allSettled(ns.map(n => revision(n, pick)))).map((s, i) => s.status === 'fulfilled' ? el('div', {}, s.value) : el('div', { className: 'muted', textContent: `${ns[i].range.id}: ${s.reason.message}` }));
    const [rev, forks] = await Promise.all([settle(log(graph, r.id)), settle(node.children)]);
    if (open?.panel !== panel) return;
    panel.querySelector('.hist-body').replaceChildren(...list(rev, 'Revisions, oldest first'), ...list(forks, 'Forks of this revision'));
  }

  // Scroll the log clear of the sticky propose card that covers the bottom of the side panel.
  function reveal(panel) { const over = panel.getBoundingClientRect().bottom - document.getElementById('propose-card').getBoundingClientRect().top; if (over > 0) document.getElementById('panel').scrollBy({ top: over + 8 }); }

  // The History button for a range row; the panel opens under the row's <li>.
  function button(r) {
    const b = el('button', { type: 'button', className: 'hist', textContent: 'History', title: 'Revision log, forks and what each revision added or removed' });
    b.setAttribute('aria-expanded', false);
    b.addEventListener('click', () => {
      const was = open?.button === b;
      clear();
      if (was) return;
      const close = el('button', { type: 'button', textContent: 'Close' });
      close.addEventListener('click', clear);
      const git = el('a', { href: `https://github.com/${REPO}/commits/main/${r.file}`, target: '_blank', rel: 'noopener', textContent: 'View in git' });
      const ed = el('button', { type: 'button', className: 'hist-edit', hidden: true, textContent: 'Edit from this revision', title: 'Start a new revision from this one. Later revisions are kept.' });
      const panel = el('div', { className: 'hist-panel' }, el('div', { className: 'hist-body muted', textContent: 'Loading...' }), el('div', {}, ed, ' ', git, ' ', close));
      b.closest('li').append(panel);
      b.setAttribute('aria-expanded', true);
      open = { panel, button: b };
      fill(panel, r).then(() => reveal(panel)).catch(e => say(e.message));
    });
    return b;
  }

  return { button, clear };
}
