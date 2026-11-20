// Area change between a revision and its parent. Pure: the clip function (polygon-clipping) is injected, as in reshape.js.
const R = 6371, rad = Math.PI / 180;

// Spherical ring area in km2 (Chamberlain-Duquette), holes subtracted. polys = MultiPolygon coordinates.
const ring = r => Math.abs(r.reduce((s, [x, y], i) => { const [x2, y2] = r[(i + 1) % r.length]; return s + (x2 - x) * rad * (2 + Math.sin(y * rad) + Math.sin(y2 * rad)); }, 0)) * R * R / 2;
export const areaKm2 = polys => polys.reduce((s, p) => s + p.reduce((t, r, i) => t + (i ? -1 : 1) * ring(r), 0), 0);

export const multi = fc => (fc?.features ?? []).flatMap(f => f.geometry?.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates : []);

// { added, removed } as MultiPolygon coordinates plus km2. parent null (a root revision) counts everything as added.
export function revisionDiff(parentFc, childFc, clip) {
  const p = multi(parentFc), c = multi(childFc);
  const added = !c.length ? [] : p.length ? clip.difference(c, p) : clip.union(c);
  const removed = p.length && c.length ? clip.difference(p, c) : p;
  return { added, removed, addedKm2: areaKm2(added), removedKm2: areaKm2(removed) };
}

const fmt = n => Math.round(n).toLocaleString('en-US');
// Rounded-to-zero halves are dropped, so a pure cut reads "−9,331 km² removed."
export const changeText = d => [fmt(d.addedKm2) !== '0' && `+${fmt(d.addedKm2)} km² added`, fmt(d.removedKm2) !== '0' && `−${fmt(d.removedKm2)} km² removed`].filter(Boolean).join(', ').replace(/^$/, 'No area change') + '.';
