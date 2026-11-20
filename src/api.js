// Data access: GBIF suggest/tiles and the repo's static JSON files.
export const REPO = 'PollockLab/rangecraft';
// Base URL of the deployed relay worker (see worker/README.md). Empty hides sign-in and relay submit.
export const RELAY_URL = '';

export async function suggest(q, signal) {
  const r = await fetch(`https://api.gbif.org/v1/species/suggest?q=${encodeURIComponent(q)}&rank=SPECIES&limit=8`, { signal });
  if (!r.ok) throw new Error(`GBIF ${r.status}`);
  return (await r.json()).map(s => ({ key: s.key, name: s.scientificName, label: s.canonicalName || s.scientificName, vernacular: s.vernacularName }));
}

export async function speciesName(key) {
  const r = await fetch(`https://api.gbif.org/v1/species/${encodeURIComponent(key)}`);
  if (!r.ok) throw new Error(`GBIF ${r.status}`);
  const s = await r.json();
  return s.canonicalName || s.scientificName;
}

export const occurrenceTiles = key =>
  `https://api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}@1x.png?taxonKey=${encodeURIComponent(key)}&srs=EPSG:3857&style=classic.poly&bin=hex`;

// Missing or malformed file => fallback, so the UI shows an empty state.
async function json(path, fallback) {
  try {
    const r = await fetch(path, { cache: 'no-cache' });
    if (!r.ok) return fallback;
    const d = await r.json();
    return Array.isArray(d) ? d : fallback;
  } catch { return fallback; }
}
export const loadIndex = () => json('data/ranges/index.json', []);
export const loadExperts = () => json('data/experts.json', []);
export async function loadRange(file) {
  const r = await fetch(file.startsWith('data/') ? file : `data/ranges/${file}`);
  if (!r.ok) throw new Error(`${file}: ${r.status}`);
  return r.json();
}
