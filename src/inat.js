// iNaturalist Open Range Maps (geomodel, CC BY 4.0), fetched at runtime: nothing is copied into the repo.
// A patch's base slug pins the model version, e.g. inat-41974-v2-35, so old patches stay reproducible after monthly updates.
const S3 = 'https://inaturalist-open-data.s3.amazonaws.com/geomodel/geojsons';
export const INAT_LICENSE = 'CC-BY-4.0';

export const inatSlug = (id, version) => `inat-${id}-v${String(version).replace(/\./g, '-')}`;
export function parseInatSlug(slug) {
  const m = /^inat-(\d+)-v(\d+)-(\d+)$/.exec(slug || '');
  return m && { id: m[1], version: `${m[2]}.${m[3]}` };
}
export const inatTaxonUrl = id => `https://www.inaturalist.org/taxa/${id}`;
export const inatNote = version => `Modelled by iNaturalist's geomodel from observations, version ${version}. CC BY 4.0, iNaturalist.`;
// Properties an iNat-based patch carries: the license, and a source line for the attribution.
export const inatAttribution = slug => {
  const p = parseInatSlug(slug);
  return p ? { derived_from: `iNaturalist Open Range Maps, taxon ${p.id}, geomodel ${p.version}`, derived_from_license: INAT_LICENSE } : {};
};

// The iNat taxon whose name equals the GBIF name exactly (case-insensitive), else null: the search is fuzzy.
export const pickExact = (name, results) => (results || []).find(t => String(t.name).toLowerCase() === String(name).toLowerCase())?.id ?? null;

const cached = k => { try { return localStorage.getItem(k); } catch { return null; } };
const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode or full */ } };

// GBIF taxon key -> iNat taxon id (string), or null. Cached per key, misses too.
export async function inatId(gbifKey) {
  const ck = `inat-id-${gbifKey}`, hit = cached(ck);
  if (hit !== null) return hit === '' ? null : hit;
  const sp = await fetch(`https://api.gbif.org/v1/species/${encodeURIComponent(gbifKey)}`);
  if (!sp.ok) throw new Error(`GBIF ${sp.status}`);
  const name = (await sp.json()).canonicalName;
  if (!name) return null;
  const r = await fetch(`https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(name)}&rank=species&per_page=5`);
  if (!r.ok) throw new Error(`iNaturalist ${r.status}`);
  const id = pickExact(name, (await r.json()).results);
  store(ck, id == null ? '' : String(id));
  return id == null ? null : String(id);
}

const ranges = new Map(); // `${version}/${id}` -> promise, so the layer and the patch base share one download
// version 'latest' or a pinned '2.35'. Returns a FeatureCollection with properties.geomodel_version, or null on 404.
export function inatRange(id, version) {
  const key = `${version}/${id}`;
  if (!ranges.has(key)) ranges.set(key, fetchRange(id, version).then(fc => {
    if (fc && version === 'latest') ranges.set(`${fc.properties.geomodel_version}/${id}`, Promise.resolve(fc));
    return fc;
  }).catch(e => { ranges.delete(key); throw e; }));
  return ranges.get(key);
}
async function fetchRange(id, version) {
  const r = await fetch(`${S3}/${version}/${id}.geojson`);
  if (r.status === 404 || r.status === 403) return null; // S3 answers 403 for a missing key when the bucket is not listable
  if (!r.ok) throw new Error(`iNaturalist range ${r.status}`);
  const f = await r.json();
  const v = f.properties?.geomodel_version;
  if (!/^\d+\.\d+$/.test(String(v))) throw new Error('iNaturalist range has no model version');
  return { type: 'FeatureCollection', features: [f], properties: { geomodel_version: String(v) } };
}

// Base geometry for a patch's base slug: iNat slugs fetch the pinned version, anything else is an official slug.
export async function loadBase(slug, official) {
  const p = parseInatSlug(slug);
  if (!p) return official(slug);
  const fc = await inatRange(p.id, p.version);
  if (!fc) throw new Error(`iNaturalist range ${p.id} version ${p.version} is no longer available.`);
  return fc;
}
