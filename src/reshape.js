// Pure geometry for Add area / Cut area. The clip function is injected (polygon-clipping's union/difference
// take Polygon or MultiPolygon coordinates and return MultiPolygon coordinates), so this runs in node without the CDN.
export const MIN_AREA = 1e-6; // square degrees, about 0.01 km2: smaller pieces are slivers

const ringArea = r => Math.abs(r.reduce((s, [x, y], i) => { const [x2, y2] = r[(i + 1) % r.length]; return s + x * y2 - x2 * y; }, 0)) / 2;
// Area of a polygon (coordinates = [outer, ...holes]) in square degrees.
export const polygonArea = rings => rings.reduce((s, r, i) => s + (i ? -1 : 1) * ringArea(r), 0);

export const totalArea = gs => gs.reduce((s, g) => s + polygonArea(g.coordinates), 0);

// op: 'add' | 'cut'; current: Polygon geometries (the whole drawn range); sketch: a Polygon geometry.
// Returns Polygon geometries (holes kept, slivers dropped). Cut on an empty range returns [].
export function reshape(op, current, sketch, clip) {
  const cur = current.map(g => g.coordinates);
  const res = op === 'add' ? clip.union(...cur, sketch.coordinates) : cur.length ? clip.difference(clip.union(...cur), sketch.coordinates) : [];
  return res.filter(p => polygonArea(p) >= MIN_AREA).map(coordinates => ({ type: 'Polygon', coordinates }));
}
