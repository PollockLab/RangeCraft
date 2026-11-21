import { loadRange, REPO } from './api.js';

// Shareable view state in the URL hash, e.g. #taxon=2427072&ranges=2427072/a&official=1&rc=1&at=4/50.1/-80.2
const ID_RE = /^\d+\/\w[\w.-]*$/;
const DEFAULT_ON = ['occ', 'agree'], DEFAULT_OFF = ['official', 'sdm', 'rc'];

export function buildHash(s) {
  const p = new URLSearchParams({ taxon: s.taxon });
  if (s.ranges) p.set('ranges', s.ranges.join(','));
  for (const k of DEFAULT_OFF) if (s[k]) p.set(k, '1');
  for (const k of DEFAULT_ON) if (s[k] === false) p.set(k, '0');
  if (s.at) p.set('at', [s.at[0].toFixed(2), s.at[1].toFixed(4), s.at[2].toFixed(4)].join('/'));
  return `#${p.toString().replaceAll('%2F', '/').replaceAll('%2C', ',')}`;
}

// Untrusted input: anything malformed is dropped, never thrown.
export function parseHash(hash) {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const taxon = p.get('taxon');
  if (!/^\d{1,12}$/.test(taxon || '')) return null;
  const s = { taxon };
  if (p.has('ranges')) s.ranges = p.get('ranges').split(',').filter(id => ID_RE.test(id)).slice(0, 50);
  for (const k of DEFAULT_OFF) s[k] = p.get(k) === '1';
  for (const k of DEFAULT_ON) s[k] = p.get(k) !== '0';
  const pv = p.get('preview') || ''; // a range proposed in a pull request: <commit sha>/<taxon>/<file>
  if (new RegExp(`^[0-9a-f]{40}/${taxon}/[\\w.-]+\\.geojson$`).test(pv)) s.preview = pv;
  const at = (p.get('at') || '').split('/').map(Number);
  if (at.length === 3 && at.every(Number.isFinite) && at[0] >= 0 && at[0] <= 22 && Math.abs(at[1]) <= 90 && Math.abs(at[2]) <= 180) s.at = at;
  return s;
}

// Add the proposed range to the index so it lists and draws next to the published ones. Never throws.
export async function addPreview(index, preview) {
  const [sha, taxon, name] = preview.split('/');
  const file = `https://raw.githubusercontent.com/${REPO}/${sha}/data/ranges/${taxon}/${name}`;
  if (index.some(r => r.file === file)) return;
  try {
    const p = (await loadRange(file)).properties ?? {};
    index.push({ id: `pr-${sha.slice(0, 7)}`, taxonKey: taxon, file, author: `${p.author || 'Proposed'} (proposed)`, created: String(p.created ?? ''), basis: p.basis });
  } catch { /* the PR commit is gone or not public: show the published ranges only */ }
}
