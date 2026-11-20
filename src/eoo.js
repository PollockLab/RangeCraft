// IUCN screening metrics. Pure. Projection choice: Lambert azimuthal equal-area (sphere R=6371 km) centred on the mean of the input
// points, so areas are equal-area-correct and distortion stays small for regional ranges. Antimeridian-crossing input is not handled.
import { inside } from './rangecheck.js';
const R = 6371, rad = Math.PI / 180;

function project(pts) {
  if (!pts.length) return [];
  const l0 = (pts.reduce((s, p) => s + p[0], 0) / pts.length) * rad, f0 = (pts.reduce((s, p) => s + p[1], 0) / pts.length) * rad;
  return pts.map(([lon, lat]) => {
    const l = lon * rad - l0, f = lat * rad, k = Math.sqrt(2 / (1 + Math.sin(f0) * Math.sin(f) + Math.cos(f0) * Math.cos(f) * Math.cos(l)));
    return [R * k * Math.cos(f) * Math.sin(l), R * k * (Math.cos(f0) * Math.sin(f) - Math.sin(f0) * Math.cos(f) * Math.cos(l))];
  });
}

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
function hull(pts) { // Andrew's monotone chain
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]), half = arr => { const h = []; for (const q of arr) { while (h.length > 1 && cross(h.at(-2), h.at(-1), q) <= 0) h.pop(); h.push(q); } return h.slice(0, -1); };
  return p.length < 3 ? p : [...half(p), ...half([...p].reverse())];
}

const rings = f => f.geometry?.type === 'Polygon' ? [f.geometry.coordinates[0]] : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates.map(p => p[0]) : [];

// Convex-hull area in km2 over polygon vertices; null when there is no polygon (or the hull is degenerate).
// IUCN: polygons with presence code 3-6 (possibly extant, possibly extinct, extinct, uncertain) are left out; presence(f) gives the code (default 1).
const extant = (features, presence) => features.filter(f => { const c = Number(presence(f)); return !(c >= 3 && c <= 6); });
export function eoo(features, presence = () => 1) {
  const h = hull(project(extant(features, presence).flatMap(rings).flat()));
  if (h.length < 3) return null;
  return Math.abs(h.reduce((s, p, i) => s + p[0] * h[(i + 1) % h.length][1] - h[(i + 1) % h.length][0] * p[1], 0)) / 2;
}

// Occupied 2x2 km cells x 4 = km2 for [lon, lat] points; null when empty. With features, only points inside their presence 1-2 polygons count.
export function aoo(points, features, presence = () => 1) {
  if (features) { const t = inside({ features: extant(features, presence) }); points = points.filter(p => t(...p)); }
  if (!points.length) return null;
  return new Set(project(points).map(([x, y]) => `${Math.floor(x / 2)},${Math.floor(y / 2)}`)).size * 4;
}
