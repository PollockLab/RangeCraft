// Range check: compare GBIF's native square bins with a range. Pure logic, no DOM or network.
export const COLORS = { outside: '#d62828', gap: '#1d6fd1', unmapped: '#8a8a8a' };
// shortcut: conterminous US as a coarse ring (24.5-49 N, -125 to -66.9 W, with the Great Lakes border cut in so southern Ontario and Quebec fall outside). Upgrade to a real outline if edge bins matter.
export const CONUS = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-125, 24.5], [-125, 48.4], [-123, 49], [-95.2, 49], [-94.6, 48.7], [-89.6, 48], [-84.5, 46.5], [-82.4, 43], [-83.1, 42], [-79, 42.8], [-79, 43.3], [-76.5, 43.6], [-75, 45], [-71.5, 45], [-70.3, 46.4], [-69.2, 47.4], [-67.8, 47.1], [-67, 44.8], [-66.9, 24.5], [-125, 24.5]]] } }] };
export const SQUARE = 128; // GBIF bin size in 4096-unit tile pixels
const ZOOMS = [4, 3, 2]; // finest first; bins are 360 / 2^(z+1) * SQUARE / 4096 degrees
export const binSize = z => (360 / 2 ** (z + 1)) * (SQUARE / 4096);

const polys = fc => (fc.features ?? []).flatMap(f => f.geometry?.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates : []);

// [west, south, east, north] over every outer ring; null when there are no polygons.
export function bbox(fc) {
  let b = null;
  for (const p of polys(fc)) for (const [x, y] of p[0]) b = b ? [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)] : [x, y, x, y];
  return b;
}

const inRing = (x, y, r) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > y) !== (r[j][1] > y) && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  return c;
};

// Prepares polygons once (with their boxes) and returns a point-in-range test. Holes are respected.
export function inside(fc) {
  const ps = polys(fc).map(p => ({ p, b: bbox({ features: [{ geometry: { type: 'Polygon', coordinates: p } }] }) }));
  return (x, y) => ps.some(({ p, b }) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && inRing(x, y, p[0]) && !p.slice(1).some(h => inRing(x, y, h)));
}


// Tiles (EPSG:4326, z) covering the box plus a buffer, clamped to the world.
export function tilesFor(box, z, bufferFrac = 0.15) {
  const buf = Math.max(1, bufferFrac * Math.max(box[2] - box[0], box[3] - box[1]));
  const tw = 360 / 2 ** (z + 1), th = 180 / 2 ** z, nx = 2 ** (z + 1), ny = 2 ** z;
  const x0 = Math.max(0, Math.floor((box[0] - buf + 180) / tw)), x1 = Math.min(nx - 1, Math.floor((box[2] + buf + 180) / tw));
  const y0 = Math.max(0, Math.floor((90 - (box[3] + buf)) / th)), y1 = Math.min(ny - 1, Math.floor((90 - (box[1] - buf)) / th));
  const tiles = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push({ z, x, y });
  return tiles;
}

// Finest zoom with <= maxTiles requests and <= maxCells bins over the range box (z=2 is the floor). Antimeridian wraps are not handled.
export function pickZoom(box, { maxTiles = 64, maxCells = 40000 } = {}) {
  for (const z of ZOOMS) {
    const tiles = tilesFor(box, z), sz = binSize(z);
    if (z === 2 || (tiles.length <= maxTiles && ((box[2] - box[0]) / sz) * ((box[3] - box[1]) / sz) <= maxCells)) return { z, size: sz, tiles };
  }
}

// Bin index of a longitude/latitude; bin (i, j) is centred at (-180 + (i + .5) size, 90 - (j + .5) size).
const centre = (i, j, size) => [-180 + (i + 0.5) * size, 90 - (j + 0.5) * size];

// Adds the squares of one tile (centres in 4096 tile units) into counts, a Map "i,j" -> records.
export function addTile(counts, tile, squares) {
  const size = binSize(tile.z), tw = 360 / 2 ** (tile.z + 1), th = 180 / 2 ** tile.z;
  for (const { x, y, props } of squares) {
    const i = Math.round((tile.x * tw + (x / 4096) * tw) / size - 0.5), j = Math.round((tile.y * th + (y / 4096) * th) / size - 0.5);
    counts.set(`${i},${j}`, (counts.get(`${i},${j}`) ?? 0) + (props.total ?? 0));
  }
}

// Each bin is its own cell. Outside: has records, centre not in range (drawn when count >= outsideMin).
// Gap: centre in range, no records. Confirmed (counted, not drawn): centre in range, with records.
// With coverage (a polygon FeatureCollection) bins centred outside it are 'unmapped': neutral cells, left out of every percentage.
export function classify(counts, fc, size, { outsideMin = 1, coverage = null } = {}) {
  const test = inside(fc), box = bbox(fc), cells = [], covered = coverage && inside(coverage);
  let total = 0, outRecords = 0, confirmed = 0, gaps = 0, unmapped = 0;
  for (const [k, count] of counts) {
    const [i, j] = k.split(',').map(Number), [x, y] = centre(i, j, size);
    if (covered && !covered(x, y)) {
      unmapped += count; cells.push({ status: 'unmapped', count, ...cellBox(i, j, size) }); continue;
    }
    total += count;
    if (test(x, y)) confirmed++;
    else { outRecords += count; if (count >= outsideMin) cells.push({ status: 'outside', count, ...cellBox(i, j, size) }); }
  }
  for (let j = Math.floor((90 - box[3]) / size); j <= Math.floor((90 - box[1]) / size); j++)
    for (let i = Math.floor((box[0] + 180) / size); i <= Math.floor((box[2] + 180) / size); i++) {
      if (counts.has(`${i},${j}`)) continue;
      const [x, y] = centre(i, j, size);
      if (test(x, y)) { gaps++; cells.push({ status: 'gap', count: 0, ...cellBox(i, j, size) }); }
    }
  return { cells, total, unmapped, confirmed, gaps, outsidePct: total ? (100 * outRecords) / total : 0, gapPct: confirmed + gaps ? (100 * gaps) / (confirmed + gaps) : 0 };
}
const cellBox = (i, j, size) => ({ w: -180 + i * size, s: 90 - (j + 1) * size, e: -180 + (i + 1) * size, n: 90 - j * size });

// ref names what was compared ("official outline", "your draft"); covered names the coverage area when the check was restricted to it.
export const summaryLine = (r, ref, covered) => {
  const lead = ref ? `vs ${ref}: ` : '', note = covered ? ` Compared within the source's coverage (${covered}); bins outside it are not mapped by this source.` : '';
  return (r.total
    ? `${lead}${Math.round(r.outsidePct)}% of records fall outside this range; ${Math.round(r.gapPct)}% of the range has no records.`
    : `${lead}No GBIF records with coordinates found around this range.`) + note;
};

export const gbifCellUrl = (key, c) =>
  `https://www.gbif.org/occurrence/search?taxon_key=${encodeURIComponent(key)}&geometry=${encodeURIComponent(`POLYGON((${c.w} ${c.s},${c.e} ${c.s},${c.e} ${c.n},${c.w} ${c.n},${c.w} ${c.s}))`)}`;
export const inatCellUrl = (name, c) =>
  `https://www.inaturalist.org/observations?taxon_name=${encodeURIComponent(name)}&swlat=${c.s}&swlng=${c.w}&nelat=${c.n}&nelng=${c.e}&verifiable=any`;

export const toGeoJSON = cells => ({
  type: 'FeatureCollection',
  features: cells.map(c => ({ type: 'Feature', properties: { status: c.status, count: c.count, w: c.w, s: c.s, e: c.e, n: c.n },
    geometry: { type: 'Polygon', coordinates: [[[c.w, c.s], [c.e, c.s], [c.e, c.n], [c.w, c.n], [c.w, c.s]]] } })),
});
