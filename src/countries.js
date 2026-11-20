// Countries whose borders a drawn range touches (IUCN gap: keep the map's country list consistent with SIS). Pure; the clip function is
// injected (polygon-clipping's intersection). Only extant polygons count (presence 1-2, same filter as EOO). Natural Earth 1:110m is coarse: small islands and slivers can be missed.
import { extant } from './eoo.js';

const polys = f => f.geometry?.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates : [];
const box = ps => ps.flatMap(p => p[0]).reduce(([a, b, c, d], [x, y]) => [Math.min(a, x), Math.min(b, y), Math.max(c, x), Math.max(d, y)], [Infinity, Infinity, -Infinity, -Infinity]);

// Returns [{ name, iso }] sorted by name.
export function countriesIn(features, countries, presence, intersection) {
  const mine = extant(features, presence).flatMap(polys);
  if (!mine.length) return [];
  const [a, b, c, d] = box(mine);
  return countries.features.filter(f => {
    const ps = polys(f), [x, y, z, w] = box(ps);
    return x <= c && z >= a && y <= d && w >= b && mine.some(m => ps.some(p => intersection(m, p).length));
  }).map(f => ({ name: f.properties.NAME, iso: f.properties.ISO_A2 })).sort((p, q) => p.name.localeCompare(q.name));
}
