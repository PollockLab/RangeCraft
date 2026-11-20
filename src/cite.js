// Cite records: turn GBIF occurrences in a bin into source lines for the proposal. Formatting and dedupe are pure.
import { recordParams } from './rangecheck.js';
const API = 'https://api.gbif.org/v1/occurrence/search';

export const citeLine = o => `GBIF occurrence ${o.key} (${[o.basisOfRecord, o.year, o.institutionCode && o.catalogNumber ? `catalogue ${o.institutionCode}:${o.catalogNumber}` : o.catalogNumber && `catalogue ${o.catalogNumber}`].filter(Boolean).join(', ')}) https://www.gbif.org/occurrence/${o.key}`;

// Appends lines not already present (matched on the occurrence URL); returns { text, added }.
export function addLines(text, lines) {
  const have = new Set(text.match(/gbif\.org\/occurrence\/\d+/g) ?? []), fresh = [];
  for (const l of lines) { const id = l.match(/gbif\.org\/occurrence\/\d+/)[0]; if (!have.has(id)) { have.add(id); fresh.push(l); } }
  return { text: fresh.length ? [text.replace(/\s+$/, ''), ...fresh].filter(Boolean).join('\n') : text, added: fresh.length };
}

// Up to 5 records in the bin, preferring preserved specimens, within the records filter. Throws on HTTP errors.
export async function fetchCites(key, c, fetchFn = fetch, filter = 'all') {
  const geometry = encodeURIComponent(`POLYGON((${c.w} ${c.s},${c.e} ${c.s},${c.e} ${c.n},${c.w} ${c.n},${c.w} ${c.s}))`);
  const get = async extra => {
    const r = await fetchFn(`${API}?taxonKey=${encodeURIComponent(key)}&geometry=${geometry}&limit=5${extra}`);
    if (!r.ok) throw new Error(`GBIF ${r.status}`);
    return (await r.json()).results ?? [];
  };
  const f = recordParams(filter);
  if (filter === 'specimens') return (await get(f)).map(citeLine);
  const specimens = await get(`${f}&basisOfRecord=PRESERVED_SPECIMEN`);
  return (specimens.length ? specimens : await get(f)).map(citeLine);
}
