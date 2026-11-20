// IUCN Mapping Standards v1.16 polygon attributes, for assessors loading a range into SIS.
// Code lists: Presence/Origin/Seasonal as in the Mapping Standards (Presence checked against docs notes).
export const CODES = {
  PRESENCE: ['Extant', 'Probably Extant', 'Possibly Extant', 'Possibly Extinct', 'Extinct', 'Presence Uncertain'],
  ORIGIN: ['Native', 'Reintroduced', 'Introduced', 'Vagrant', 'Origin Uncertain', 'Assisted Colonisation'],
  SEASONAL: ['Resident', 'Breeding Season', 'Non-breeding Season', 'Passage', 'Seasonal Occurrence Uncertain'],
};
export const DEFAULTS = { PRESENCE: 1, ORIGIN: 1, SEASONAL: 1 };

const code = (k, v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > CODES[k].length) throw new Error(`${k} must be 1-${CODES[k].length}, got ${v}`);
  return n;
};

// Polygon features only; ID_NO is left blank for the assessor (SIS assigns it). COMPILER may be blank.
export function buildIucn(features, m) {
  if (!m.sciName) throw new Error('SCI_NAME is required.');
  const d = m.derived; // { by, created, file } when the drawing is an edited copy of a community range
  const props = {
    ID_NO: '', SCI_NAME: m.sciName,
    PRESENCE: code('PRESENCE', m.presence ?? DEFAULTS.PRESENCE), ORIGIN: code('ORIGIN', m.origin ?? DEFAULTS.ORIGIN), SEASONAL: code('SEASONAL', m.seasonal ?? DEFAULTS.SEASONAL),
    COMPILER: m.compiler || '', YEAR: m.year ?? new Date().getFullYear(),
    CITATION: `RangeCraft community range, ${m.url}${d ? `. Derived from ${d.by} ${d.created}, ${d.file}` : ''}`,
    SOURCE: [d && `Derived from ${d.by} ${d.created}; edited in RangeCraft`, m.source].filter(Boolean).join('. '), DIST_COMM: 'Drawn in RangeCraft. Planning aid, not ground truth.',
  };
  return { type: 'FeatureCollection', features: features.map(f => ({ type: 'Feature', properties: { ...props }, geometry: f.geometry })) };
}

export const iucnFilename = (sciName, year) => `${String(sciName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'range'}-iucn-${year}.geojson`;
