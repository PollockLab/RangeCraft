// Life-form browsing: species that have ranges, grouped by iconic taxon derived from the GBIF classification.
export const GROUPS = [
  { id: 'all', label: 'All', icon: '🌍' }, { id: 'plants', label: 'Plants', icon: '🌿' }, { id: 'fungi', label: 'Fungi and lichens', icon: '🍄' },
  { id: 'insects', label: 'Insects', icon: '🐞' }, { id: 'spiders', label: 'Spiders and allies', icon: '🕷️' }, { id: 'molluscs', label: 'Molluscs', icon: '🐚' },
  { id: 'birds', label: 'Birds', icon: '🐦' }, { id: 'mammals', label: 'Mammals', icon: '🦌' }, { id: 'fish', label: 'Fish', icon: '🐟' },
  { id: 'amphibians', label: 'Amphibians', icon: '🐸' }, { id: 'reptiles', label: 'Reptiles', icon: '🐍' }, { id: 'other', label: 'Other animals', icon: '🐾' },
];
const FISH = new Set(['Actinopterygii', 'Chondrichthyes', 'Elasmobranchii', 'Holocephali', 'Myxini', 'Petromyzonti', 'Cephalaspidomorphi', 'Sarcopterygii']);
const BY_CLASS = { Insecta: 'insects', Arachnida: 'spiders', Aves: 'birds', Mammalia: 'mammals', Amphibia: 'amphibians', Reptilia: 'reptiles' };

// s: GBIF species record. null for kingdoms outside the groups (they still appear under All).
export function groupOf(s) {
  if (s?.kingdom === 'Plantae') return 'plants';
  if (s?.kingdom === 'Fungi') return 'fungi';
  if (s?.kingdom !== 'Animalia') return null;
  if (s.phylum === 'Mollusca') return 'molluscs';
  return BY_CLASS[s.class] ?? (FISH.has(s.class) ? 'fish' : 'other');
}

const cache = new Map();
export function classify(key, f = fetch) {
  if (!cache.has(key)) cache.set(key, f(`https://api.gbif.org/v1/species/${encodeURIComponent(key)}`).then(r => (r.ok ? r.json() : null)).then(groupOf).catch(() => null));
  return cache.get(key);
}

// => { all: [...], plants: [...], ... } of { key, name, sources }, sorted by name.
export async function speciesByGroup(index, f) {
  const sp = new Map();
  for (const r of index) {
    if (!sp.has(r.taxonKey)) sp.set(r.taxonKey, { key: r.taxonKey, name: r.scientificName, sources: 0 });
    sp.get(r.taxonKey).sources++;
  }
  const list = [...sp.values()].sort((a, b) => a.name.localeCompare(b.name));
  const gs = await Promise.all(list.map(s => classify(s.key, f)));
  const by = Object.fromEntries(GROUPS.map(g => [g.id, []]));
  by.all = list;
  list.forEach((s, i) => gs[i] && by[gs[i]].push(s));
  return by;
}

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

// Chips with counts plus the species list of the picked group. onSelect({key, name}); onSearch() hands over to free search.
export function initGroups({ chips, list, load, onSelect, onSearch }) {
  let by = null, active = null;
  const draw = () => {
    chips.replaceChildren(...GROUPS.map(g => {
      const n = by?.[g.id].length;
      const b = el('button', { type: 'button', className: 'chip', disabled: n === 0, title: n === 0 ? 'No species with ranges yet' : '' },
        el('span', { textContent: g.icon }), ` ${g.label} `, el('b', { textContent: n ?? '…' }));
      b.dataset.group = g.id;
      b.setAttribute('aria-pressed', active === g.id);
      b.addEventListener('click', () => { active = active === g.id ? null : g.id; draw(); });
      return b;
    }));
    list.hidden = !active;
    if (!active) return;
    list.replaceChildren(...(by?.[active] ?? []).map(s => {
      const b = el('button', { type: 'button', textContent: s.name }, el('span', { className: 'muted', textContent: ` ${s.sources} source${s.sources === 1 ? '' : 's'}` }));
      b.addEventListener('click', () => onSelect({ key: s.key, name: s.name }));
      return el('li', {}, b);
    }), el('li', {}, el('button', { type: 'button', textContent: 'Search all species', onclick: onSearch })));
  };
  draw();
  load().then(r => { by = r; draw(); }).catch(() => { by = Object.fromEntries(GROUPS.map(g => [g.id, []])); draw(); });
}
