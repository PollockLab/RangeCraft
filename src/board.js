// Contributors view and per-taxon expertise, from data/experts.json (public track record).
import { byAuthor, parentOf } from './lineage.js';
import { REPO } from './api.js';
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

// Open pull requests that touch data/ranges/, as [{ login, url, number }]: contributors whose range awaits review. Public GitHub API, first `max` PRs; any failure yields what was found so far.
export async function pendingContributors(max = 10, get = fetch) {
  const api = `https://api.github.com/repos/${REPO}/pulls`, out = [];
  try {
    const prs = await (await get(`${api}?state=open&per_page=${max}`)).json();
    if (!Array.isArray(prs)) return out;
    await Promise.all(prs.slice(0, max).map(async pr => {
      try {
        const files = await (await get(`${api}/${pr.number}/files?per_page=100`)).json();
        if (Array.isArray(files) && files.some(f => f.filename?.startsWith('data/ranges/'))) out.push({ login: pr.user?.login, url: pr.html_url, number: pr.number });
      } catch { /* rate limited or offline: skip this PR */ }
    }));
  } catch { /* GitHub unreachable: no pending list */ }
  return out.filter(p => p.login).sort((a, b) => a.number - b.number);
}

export function renderPending(el, pending) {
  el.hidden = !pending.length;
  el.replaceChildren('Pending review: ', ...pending.flatMap((p, i) => [i ? ', ' : '', link(p.url, `${p.login} (#${p.number})`)]));
}

export function renderBoard(experts, { table, empty, ranges = [] }) {
  const mine = byAuthor(ranges), byFile = new Map(ranges.map(r => [r.file, r]));
  const rows = [...experts].sort((a, b) => (b.works_total || 0) - (a.works_total || 0));
  empty.hidden = rows.length > 0;
  empty.querySelector('button').onclick = () => document.getElementById('tab-map').click();
  table.hidden = !rows.length;
  table.tBodies[0].replaceChildren(...rows.flatMap(e => {
    const revs = mine.get(String(e.author).toLowerCase()) ?? [], tl = el('tr', { hidden: true }, el('td', { colSpan: 5 }, timeline(revs, byFile)));
    const name = el('button', { type: 'button', className: 'linkbtn', textContent: e.display || shownName(e.author), title: `${revs.length} revision${revs.length === 1 ? '' : 's'} over time` });
    name.setAttribute('aria-expanded', false);
    name.addEventListener('click', () => { tl.hidden = !tl.hidden; name.setAttribute('aria-expanded', !tl.hidden); });
    return [el('tr', {},
      el('td', {}, name),
      el('td', {}, ...ids(e)),
      el('td', { textContent: e.works_total ?? '-' }),
      el('td', { textContent: e.h_index ?? '-' }),
      el('td', { textContent: Object.keys(e.taxa || {}).length })), tl];
  }));
}

// A contributor's revisions, oldest first: species, date, and whose range an edit builds on.
function timeline(revs, byFile) {
  if (!revs.length) return el('span', { className: 'muted', textContent: 'No revisions yet.' });
  return el('ul', { className: 'timeline' }, ...revs.map(r => {
    const p = byFile.get(parentOf(r));
    const from = p ? shownName(p.author) : r.basis === 'official-patch' ? 'official outline' : null;
    return el('li', { textContent: `${r.scientificName ?? r.taxonKey}, ${r.created}${r.message ? `: ${r.message}` : ''}${from ? ` (edit of ${from})` : ''}` });
  }));
}

export const fmtScore = (s, r) => {
  if (!s) return 'not yet scored';
  const bits = [];
  if (s.window_all) bits.push(`${Math.round((s.inside_all / s.window_all) * 100)}% of all nearby GBIF records inside`);
  bits.push(s.window_post ? `${s.inside_post}/${s.window_post} records since edit inside` : 'no records since edit yet');
  if (s.skill != null) bits.push(`skill ${Number(s.skill).toFixed(2)} (new records inside vs expected by chance)`);
  if (r.edit_date) bits.push(`added ${r.edit_date}${r.identity === 'source' && r.created && r.created !== r.edit_date ? ` (source ${r.created})` : ''}`);
  return bits.join(', ');
};
