// Range check: compare GBIF's native square bins with a range. Pure logic, no DOM or network.
export const COLORS = { outside: '#d62828', outsideLow: '#8c3b3b', gap: '#1d6fd1', lowgap: '#9aa5b1', survey: '#00a39a', unmapped: '#8a8a8a' };
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
// With suit (lon, lat) => 0..100 | null, the threshold is the score 90% of in-range bins with records reach; bins below it (or null) are low suitability:
// in-range gaps split into gap / lowgap, outside bins into outside / outsideLow, and suitable record-free bins one ring from the range become 'survey'.
// Without suit, or without any in-range record to set a threshold, nothing is split and threshold is null.
export function classify(counts, fc, size, { outsideMin = 1, coverage = null, suit = null } = {}) {
  const test = inside(fc), box = bbox(fc), cells = [], covered = coverage && inside(coverage), outs = [], vals = [], seen = new Map();
  const rin = (i, j) => { const k = `${i},${j}`; if (!seen.has(k)) seen.set(k, test(...centre(i, j, size))); return seen.get(k); };
  let total = 0, outRecords = 0, lowRecords = 0, confirmed = 0, gaps = 0, unmapped = 0;
  for (const [k, count] of counts) {
    const [i, j] = k.split(',').map(Number), [x, y] = centre(i, j, size);
    if (covered && !covered(x, y)) {
      unmapped += count; cells.push({ status: 'unmapped', count, ...cellBox(i, j, size) }); continue;
    }
    total += count;
    if (rin(i, j)) { confirmed++; if (suit) { const v = suit(x, y); if (v != null) vals.push(v); } }
    else { outRecords += count; if (count >= outsideMin) outs.push({ i, j, x, y, count }); }
  }
  vals.sort((a, b) => a - b);
  const threshold = vals.length ? vals[Math.floor(0.1 * vals.length)] : null;
  const ok = (x, y) => { if (threshold == null) return true; const v = suit(x, y); return v != null && v >= threshold; };
  for (const o of outs) {
    const good = ok(o.x, o.y); if (!good) lowRecords += o.count;
    cells.push({ status: good ? 'outside' : 'outsideLow', count: o.count, ...cellBox(o.i, o.j, size) });
  }
  const j0 = Math.floor((90 - box[3]) / size), j1 = Math.floor((90 - box[1]) / size), i0 = Math.floor((box[0] + 180) / size), i1 = Math.floor((box[2] + 180) / size);
  let lowGaps = 0, survey = 0;
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      if (counts.has(`${i},${j}`) || !rin(i, j)) continue;
      const [x, y] = centre(i, j, size), good = ok(x, y);
      gaps++; if (!good) lowGaps++;
      cells.push({ status: good ? 'gap' : 'lowgap', count: 0, score: threshold == null ? null : suit(x, y), ...cellBox(i, j, size) });
    }
  if (threshold != null) for (let j = j0 - 1; j <= j1 + 1; j++) // one bin ring around the range: suitable, no records, a neighbour inside
    for (let i = i0 - 1; i <= i1 + 1; i++) {
      if (counts.has(`${i},${j}`) || rin(i, j)) continue;
      const [x, y] = centre(i, j, size);
      if ((covered && !covered(x, y)) || !ok(x, y) || ![-1, 0, 1].some(dj => [-1, 0, 1].some(di => (di || dj) && rin(i + di, j + dj)))) continue;
      survey++; cells.push({ status: 'survey', count: 0, score: suit(x, y), ...cellBox(i, j, size) });
    }
  return { cells, total, unmapped, confirmed, gaps, lowGaps, survey, lowRecords, threshold, outsidePct: total ? (100 * outRecords) / total : 0, gapPct: confirmed + gaps ? (100 * gaps) / (confirmed + gaps) : 0 };
}
const cellBox = (i, j, size) => ({ w: -180 + i * size, s: 90 - (j + 1) * size, e: -180 + (i + 1) * size, n: 90 - j * size });

// Raw SDM scores are 0-100 and uncalibrated across species, hence the per-species threshold. why: 'none' (no model), 'unreadable', or 'ok'.
export const sdmNote = (r, why) => why === 'none' ? 'No habitat model for this species, so gaps are not habitat-checked.'
  : why === 'unreadable' ? 'The habitat model could not be read, so gaps are not habitat-checked.'
  : r.threshold == null ? 'No in-range bin has records, so no habitat threshold could be set and gaps are not habitat-checked.'
  : `Suitable means a habitat score of at least ${r.threshold}, which 90% of in-range bins with records reach.`;

// Score at lon/lat from a decoded RGBA image of box [w, s, e, n] (equirectangular, width px wide); null outside it or on nodata (alpha 0).
export function sampler(box, width, data) {
  const height = data.length / 4 / width;
  return (lon, lat) => {
    const x = Math.floor(((lon - box[0]) / (box[2] - box[0])) * width), y = Math.floor(((box[3] - lat) / (box[3] - box[1])) * height);
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    const o = (y * width + x) * 4;
    return data[o + 3] ? data[o] : null;
  };
}

// [west, south, east, north] of GBIF tiles, grown by one bin.
export const tilesBox = (tiles, size) => tiles.reduce((b, t) => {
  const tw = 360 / 2 ** (t.z + 1), th = 180 / 2 ** t.z, w = t.x * tw - 180, n = 90 - t.y * th;
  return [Math.min(b[0], w - size), Math.min(b[1], n - th - size), Math.max(b[2], w + tw + size), Math.max(b[3], n + size)];
}, [180, 90, -180, -90]);

// ref names what was compared ("official outline", "your draft"); covered names the coverage area when the check was restricted to it.
export const summaryLine = (r, ref, covered) => {
  const lead = ref ? `vs ${ref}: ` : '', note = covered ? ` Compared within the source's coverage (${covered}); bins outside it are not mapped by this source.` : '';
  return (r.total
    ? `${lead}${Math.round(r.outsidePct)}% of records fall outside this range; ${Math.round(r.gapPct)}% of the range has no records.`
    : `${lead}No GBIF records with coordinates found around this range.`) + note;
};

// Habitat-checked extras for the summary; '' when nothing was habitat-checked.
export const habitatLine = r => r.threshold == null ? '' : [
  r.survey && `${r.survey} bin${r.survey === 1 ? '' : 's'} just outside the range look${r.survey === 1 ? 's' : ''} suitable but ${r.survey === 1 ? 'has' : 'have'} no records.`,
  r.lowGaps && `${r.lowGaps} in-range bin${r.lowGaps === 1 ? ' has' : 's have'} low suitability.`,
  r.lowRecords && `${r.lowRecords} record${r.lowRecords === 1 ? '' : 's'} in low-suitability habitat outside the range ${r.lowRecords === 1 ? 'is' : 'are'} worth an ID check.`].filter(Boolean).join(' ');

const csvCell = v => /[",\n]/.test(v = String(v)) ? `"${v.replace(/"/g, '""')}"` : v;
// CSV of up to `limit` survey (frontier) and suitable-gap bins, best habitat score first. Header only when there are none.
export function surveyCsv(cells, taxon, limit = 50) {
  const top = cells.filter(c => (c.status === 'survey' || c.status === 'gap') && c.score != null).sort((a, b) => b.score - a.score).slice(0, limit);
  return ['rank,kind,lat,lon,suitability,inat_url,gbif_url', ...top.map((c, i) => [i + 1, c.status === 'survey' ? 'frontier' : 'gap',
    +((c.s + c.n) / 2).toFixed(5), +((c.w + c.e) / 2).toFixed(5), c.score, inatCellUrl(taxon.name, c), gbifCellUrl(taxon.key, c)].map(csvCell).join(','))].join('\n') + '\n';
}

export const gbifCellUrl = (key, c) =>
  `https://www.gbif.org/occurrence/search?taxon_key=${encodeURIComponent(key)}&geometry=${encodeURIComponent(`POLYGON((${c.w} ${c.s},${c.e} ${c.s},${c.e} ${c.n},${c.w} ${c.n},${c.w} ${c.s}))`)}`;
export const inatCellUrl = (name, c) =>
  `https://www.inaturalist.org/observations?taxon_name=${encodeURIComponent(name)}&swlat=${c.s}&swlng=${c.w}&nelat=${c.n}&nelng=${c.e}&verifiable=any`;

export const toGeoJSON = cells => ({
  type: 'FeatureCollection',
  features: cells.map(c => ({ type: 'Feature', properties: { status: c.status, count: c.count, w: c.w, s: c.s, e: c.e, n: c.n },
    geometry: { type: 'Polygon', coordinates: [[[c.w, c.s], [c.e, c.s], [c.e, c.n], [c.w, c.n], [c.w, c.s]]] } })),
});
// iNaturalist Identify page for a bin: records of the taxon that still need or have an ID, for checking misidentifications.
export const inatIdentifyUrl = (name, c) =>
  `https://www.inaturalist.org/observations/identify?taxon_name=${encodeURIComponent(name)}&swlat=${c.s}&swlng=${c.w}&nelat=${c.n}&nelng=${c.e}&quality_grade=needs_id,research`;
