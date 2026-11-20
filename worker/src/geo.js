// JS port of the core scripts/rangelib.py checks, plus the trusted rebuild of a submitted file.
// shortcut: no self-intersection test and overlapping polygons are not unioned before the bbox
// ratio; CI (rangelib.load_range) is the full check and fails the PR if either matters.
export class RangeError extends Error {}

const MAX_PARTS = 200, MAX_BBOX_RATIO = 50, BASES = ['expert-outline-edit', 'new'];
// Client properties we keep. Everything else (github, orcid, inat_login, identity, submitter...) is dropped.
const KEEP = ['taxonKey', 'scientificName', 'author', 'sources', 'basis', 'parent', 'derived_from', 'derived_from_license'];

const ringArea = r => Math.abs(r.reduce((s, [x1, y1], i) => { const [x2, y2] = r[(i + 1) % r.length]; return s + x1 * y2 - x2 * y1; }, 0)) / 2;

function checkRing(ring, where) {
  if (!Array.isArray(ring) || ring.length < 4) throw new RangeError(`${where}: ring needs 4+ positions`);
  for (const p of ring) {
    if (!Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) throw new RangeError(`${where}: non-numeric coordinate`);
    if (p[0] < -180 || p[0] > 180 || p[1] < -90 || p[1] > 90) throw new RangeError('coordinates outside lon [-180,180] / lat [-90,90]');
  }
  const [a, b] = [ring[0], ring.at(-1)];
  if (a[0] !== b[0] || a[1] !== b[1]) throw new RangeError(`${where}: ring is not closed`);
}

export function validateRange(fc) {
  if (!fc || typeof fc !== 'object' || fc.type !== 'FeatureCollection') throw new RangeError('root must be a GeoJSON FeatureCollection');
  if (!Array.isArray(fc.features) || !fc.features.length) throw new RangeError('FeatureCollection has no features');
  let parts = 0, area = 0, x0 = 181, y0 = 91, x1 = -181, y1 = -91;
  fc.features.forEach((f, i) => {
    const g = f?.geometry;
    if (!g || !['Polygon', 'MultiPolygon'].includes(g.type) || !Array.isArray(g.coordinates)) throw new RangeError(`feature ${i}: not a Polygon/MultiPolygon`);
    for (const poly of g.type === 'Polygon' ? [g.coordinates] : g.coordinates) {
      if (!Array.isArray(poly) || !poly.length) throw new RangeError(`feature ${i}: empty polygon`);
      poly.forEach(r => checkRing(r, `feature ${i}`));
      parts++;
      area += ringArea(poly[0]) - poly.slice(1).reduce((s, r) => s + ringArea(r), 0);
      for (const [x, y] of poly[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    }
  });
  if (!(area > 0)) throw new RangeError('geometry is empty or has zero area');
  if (parts > MAX_PARTS) throw new RangeError(`${parts} parts exceeds the limit of ${MAX_PARTS}`);
  const ratio = (x1 - x0) * (y1 - y0) / area;
  if (ratio > MAX_BBOX_RATIO) throw new RangeError(`bbox is ${Math.round(ratio)}x the geometry area (limit ${MAX_BBOX_RATIO}x)`);
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);

// Merge collection and first-feature props like rangelib does, then keep only the whitelist.
export function cleanProps(fc, session, today) {
  const raw = { ...(fc.features[0].properties || {}), ...(fc.properties || {}) };
  if (!/^\d+$/.test(String(raw.taxonKey ?? ''))) throw new RangeError(`taxonKey ${JSON.stringify(raw.taxonKey)} is not numeric`);
  const p = { taxonKey: Number(raw.taxonKey) };
  for (const k of KEEP.slice(1)) { const v = str(raw[k], k === 'sources' ? 4000 : 300); if (v) p[k] = v; }
  p.author ||= session.name;
  if (p.basis && !BASES.includes(p.basis)) throw new RangeError(`basis must be one of ${BASES.join(', ')}`);
  if (p.basis === 'expert-outline-edit' && !p.derived_from) throw new RangeError('basis expert-outline-edit requires derived_from');
  return { ...p, created: today, submitter: { provider: session.provider, id: session.id, ...(session.login && { login: session.login }), name: session.name, verified: !!session.verified } };
}

// Validate and rebuild: only geometry and whitelisted properties survive, submitter comes from the session.
export function buildFile(fc, session, now = new Date()) {
  validateRange(fc);
  const props = cleanProps(fc, session, now.toISOString().slice(0, 10));
  return {
    type: 'FeatureCollection',
    features: fc.features.map(f => ({ type: 'Feature', properties: { ...props }, geometry: { type: f.geometry.type, coordinates: f.geometry.coordinates } })),
    properties: props,
  };
}

export const slug = s => String(s || 'anon').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'anon';
