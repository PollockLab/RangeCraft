// Edits of an official outline are stored as a patch: only the user's own add and cut shapes, never the outline's vertices (its license
// forbids republishing derivatives). Pure; the clip function (polygon-clipping) is injected.
import { multi } from './diff.js';

// MultiPolygon coordinates of the base with each shape folded in as drawn: add = union, cut = difference, recode (extirpated, presence 4/5) = unchanged: the area is kept. base is a FeatureCollection, patch a patch file.
export function applyPatch(base, patch, clip) {
  return (patch?.features ?? []).reduce((acc, f) => {
    const g = multi({ features: [f] }), op = f.properties?.op;
    if (!g.length) return acc;
    if (op === 'add') return acc.length ? clip.union(acc, g) : clip.union(g);
    return op === 'cut' && acc.length ? clip.difference(acc, g) : acc;
  }, multi(base));
}

// shapes: [{ op: 'add' | 'cut' | 'recode', presence?: 4 | 5 (recode only), geometry }] drawn by the user. The collection carries no base geometry, only a pointer to it. meta.parent is the previous patch's file path, if any.
export function toPatch(shapes, meta) {
  const props = { taxonKey: Number(meta.taxonKey) || meta.taxonKey, scientificName: meta.scientificName, author: meta.author, created: new Date().toISOString().slice(0, 10),
    sources: meta.sources, basis: 'official-patch', base: meta.base };
  if (meta.parent) props.parent = meta.parent; // a real repo file path, absent for a first patch (the base slug is not a revision)
  if (meta.message) props.message = meta.message;
  for (const [k, v] of [['github', meta.github], ['orcid', meta.orcid], ['inat_login', meta.inat]]) if (v) props[k] = v;
  return { type: 'FeatureCollection', features: shapes.map(s => ({ type: 'Feature', properties: s.op === 'recode' ? { op: s.op, presence: s.presence } : { op: s.op }, geometry: s.geometry })), properties: props };
}
