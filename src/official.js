// Official expert outlines (ECCC/IUCN via PollockLab) and the SDM context raster.
const LIST_URL = 'https://raw.githubusercontent.com/PollockLab/openbiodiversity.ca/main/public/sdm-species.json';
const BASE = 'https://object-arbutus.alliancecan.ca/swift/v1/4903c6264e0c4191a74a54c93b6fe1d9/def-pollock-eckert/vertebrates_NA/ECCC_2026';
const FGB = slug => `${BASE}/${slug}_iucn-range_NA_na_NA_NA.fgb`;
const COG = slug => `${BASE}/${slug}_sdm-ensemble_1km_na_1980-2010_sett1.tif`;
const FGB_JS = 'https://unpkg.com/flatgeobuf@3.36.0/dist/flatgeobuf-geojson.min.js';
const PROJ_JS = 'https://unpkg.com/proj4@2.12.1/dist/proj4.js';

export const sdmTiles = slug =>
  `https://tiler2.biodiversite-quebec.ca/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=${encodeURIComponent(COG(slug))}&colormap_name=viridis&rescale=0,99&nodata=255`;
// One lon/lat box as an 8-bit gray + alpha PNG (no colormap or rescale): gray = raw 0-100 score, alpha 0 = nodata. The tiler allows any origin, so canvas reads work.
export const sdmRawBox = (slug, [w, s, e, n]) =>
  `https://tiler2.biodiversite-quebec.ca/cog/bbox/${w},${s},${e},${n}.png?url=${encodeURIComponent(COG(slug))}&nodata=255&max_size=1024`;
// Tiler's WGS84 extent; MapLibre bounds cannot wrap the antimeridian, so a wrapped box keeps its western part.
export async function sdmBounds(slug) {
  try {
    const r = await fetch(`https://tiler2.biodiversite-quebec.ca/cog/info.geojson?url=${encodeURIComponent(COG(slug))}`);
    if (!r.ok) return null;
    const [w, s, e, n] = (await r.json()).bbox;
    return w > e ? [-180, s, e, n] : [w, s, e, n];
  } catch { return null; }
}
export const gbifSearchUrl = key => `https://www.gbif.org/occurrence/search?taxon_key=${encodeURIComponent(key)}`;

let list;
async function species() {
  list ??= fetch(LIST_URL).then(r => { if (!r.ok) throw new Error(`species list ${r.status}`); return r.json(); })
    .then(a => new Map(a.map(s => [s.sci.toLowerCase(), s])));
  try { return await list; } catch (e) { list = null; throw e; }
}

const gj = async url => { const r = await fetch(url); return r.ok ? r.json() : null; };

// Match the selected name, then GBIF's accepted name and synonyms, against the official list.
export async function findOfficial(key, name) {
  const map = await species();
  const hit = n => n && map.get(n.toLowerCase());
  let s = hit(name);
  if (s) return s;
  const sp = await gj(`https://api.gbif.org/v1/species/${encodeURIComponent(key)}`);
  const accKey = sp?.acceptedKey || sp?.key || key;
  const acc = accKey === sp?.key ? sp : await gj(`https://api.gbif.org/v1/species/${accKey}`);
  s = hit(sp?.canonicalName) || hit(acc?.canonicalName);
  if (s) return s;
  const syn = await gj(`https://api.gbif.org/v1/species/${accKey}/synonyms?limit=100`);
  for (const x of syn?.results || []) if ((s = hit(x.canonicalName))) return s;
  return null;
}

function loadScript(src, ready) {
  return new Promise((ok, no) => {
    if (globalThis[ready]) return ok();
    const el = Object.assign(document.createElement('script'), { src, onload: ok, onerror: () => no(new Error(`Could not load ${ready}`)) });
    document.head.append(el);
  });
}

// The bucket's FlatGeobufs are LAEA (lat_0=45, lon_0=-100); MapLibre needs lon/lat.
const laea = () => proj4('+proj=laea +lat_0=45 +lon_0=-100 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs', 'EPSG:4326');
// Rings crossing the antimeridian are unwrapped (lon past 180) so no segment spans the map.
function unproject(c, fwd = laea().forward) {
  if (typeof c[0][0] !== 'number') return c.map(x => unproject(x, fwd));
  let off = 0, prev = 0;
  return c.map((p, i) => {
    const [lon, lat] = fwd(p);
    if (i && Math.abs(lon + off - prev) > 180) off += lon + off < prev ? 360 : -360;
    return [prev = lon + off, lat];
  });
}

export async function fetchOutline(slug) {
  await Promise.all([loadScript(FGB_JS, 'flatgeobuf'), loadScript(PROJ_JS, 'proj4')]);
  let r;
  try { r = await fetch(FGB(slug)); }
  catch { throw new Error('Official outline blocked by the browser (CORS or network). Try again later or draw from scratch.'); }
  if (!r.ok) throw new Error(`Official outline unavailable (${r.status}).`);
  const fc = await flatgeobuf.deserialize(new Uint8Array(await r.arrayBuffer()));
  const features = fc.features.filter(f => /Polygon/.test(f.geometry?.type));
  if (!features.length) throw new Error('Official outline file has no polygons.');
  return { type: 'FeatureCollection', features: features.map(f => ({ type: 'Feature', properties: {}, geometry: { type: f.geometry.type, coordinates: unproject(f.geometry.coordinates) } })) };
}
