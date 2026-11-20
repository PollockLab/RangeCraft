// IUCN Mapping Standards v1.16 polygon attributes, for assessors loading a range into SIS.
// Code lists: Presence/Origin/Seasonal as in the Mapping Standards (Presence checked against docs notes).
export const CODES = {
  PRESENCE: ['Extant', 'Probably Extant', 'Possibly Extant', 'Possibly Extinct', 'Extinct', 'Presence Uncertain'],
  ORIGIN: ['Native', 'Reintroduced', 'Introduced', 'Vagrant', 'Origin Uncertain', 'Assisted Colonisation'],
  SEASONAL: ['Resident', 'Breeding Season', 'Non-breeding Season', 'Passage', 'Seasonal Occurrence Uncertain'],
};
export const MAP_STATUS = ['Done', 'Incomplete', 'Not possible'];
export const DEFAULTS = { PRESENCE: 1, ORIGIN: 1, SEASONAL: 1 };

const code = (k, v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > CODES[k].length) throw new Error(`${k} must be 1-${CODES[k].length}, got ${v}`);
  return n;
};

// Polygon features only; a feature's own PRESENCE/ORIGIN/SEASONAL (f.properties; an official-patch 'recode' shape's presence counts as PRESENCE) win over the defaults in m; ID_NO is left blank for the assessor (SIS assigns it). COMPILER may be blank.
export function buildIucn(features, m) {
  if (!m.sciName) throw new Error('SCI_NAME is required.');
  const d = m.derived; // { by, created, file } when the drawing is an edited copy of a community range
  const status = m.mapStatus ?? 'Incomplete';
  if (!MAP_STATUS.includes(status)) throw new Error(`Map status must be one of ${MAP_STATUS.join(', ')}, got ${status}`);
  const dflt = Object.fromEntries(Object.keys(CODES).map(k => [k, code(k, m[k.toLowerCase()] ?? DEFAULTS[k])])); // validates the panel defaults even with no features
  const props = {
    ID_NO: '', SCI_NAME: m.sciName,
    COMPILER: m.compiler || '', YEAR: m.year ?? new Date().getFullYear(),
    CITATION: `RangeCraft community range, ${m.url}${d ? `. Derived from ${d.by} ${d.created}, ${d.file}` : ''}`,
    SOURCE: [d && `Derived from ${d.by} ${d.created}; edited in RangeCraft`, m.source].filter(Boolean).join('. '), DIST_COMM: `Map status: ${status}.${m.countries?.length ? ` Countries: ${m.countries.join(', ')}.` : ''}${m.source ? ` ${m.source}` : ''}`,
  };
  return { type: 'FeatureCollection', features: features.map(f => ({ type: 'Feature', properties: { ...props, ...Object.fromEntries(Object.keys(CODES).map(k => [k, code(k, f.properties?.[k] ?? (k === 'PRESENCE' && f.properties?.op === 'recode' ? f.properties.presence : undefined) ?? dflt[k])])) }, geometry: f.geometry })) };
}

export const iucnFilename = (sciName, year) => `${String(sciName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'range'}-iucn-${year}.geojson`;
