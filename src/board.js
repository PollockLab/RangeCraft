// Contributors view and per-taxon expertise, from data/experts.json (public track record).
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const num = n => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n ?? 0));
const ORCID = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/, INAT = /^[A-Za-z0-9_-]{3,40}$/;
const link = (href, text) => el('a', { href, textContent: text, rel: 'noopener', target: '_blank' });

// Unverified commit names carry a namespace prefix so they cannot claim a GitHub login's credit.
export const shownName = a => String(a ?? '').replace(/^(unverified|source):/, '');
export const findExpert = (experts, author) => experts.find(e => e.author?.toLowerCase() === String(author).toLowerCase());

function ids(e) {
  const out = [];
  if (ORCID.test(e.orcid || '')) out.push(link(`https://orcid.org/${e.orcid}`, 'ORCID'));
  if (INAT.test(e.inat_login || '')) out.push(link(`https://www.inaturalist.org/people/${e.inat_login}`, 'iNaturalist'));
  out.push(el('span', { className: `badge${e.verified ? ' verified' : ''}`, textContent: e.verified ? '✓ verified link' : 'self-declared' }));
  return out.flatMap((x, i) => (i ? [' ', x] : [x]));
}

// One-line expertise for a taxon, or null when the author has no public record.
export function expertiseLine(expert, taxonKey) {
  if (!expert) return null;
  const t = expert.taxa?.[taxonKey] || {};
  const bits = [`${num(t.inat_rg_obs_species)} research-grade iNat obs of this species`, `${num(t.inat_ids_species)} IDs`, `${num(t.papers_on_taxon)} papers on this taxon`];
  if (t.inat_rg_obs_order) bits.push(`${num(t.inat_rg_obs_order)} obs in its order`);
  return el('div', { className: 'muted expert' }, bits.join(' · '), ' · ', ...ids(expert));
}

export function renderBoard(experts, { table, empty }) {
  const rows = [...experts].sort((a, b) => (b.works_total || 0) - (a.works_total || 0));
  empty.hidden = rows.length > 0;
  table.hidden = !rows.length;
  table.tBodies[0].replaceChildren(...rows.map(e => el('tr', {},
    el('td', { textContent: e.display || shownName(e.author) }),
    el('td', {}, ...ids(e)),
    el('td', { textContent: e.works_total ?? '-' }),
    el('td', { textContent: e.h_index ?? '-' }),
    el('td', { textContent: Object.keys(e.taxa || {}).length }))));
}
