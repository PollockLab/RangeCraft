// Edits of an official outline are stored as a patch: only the user's own add and cut shapes, never the outline's vertices (its license
// forbids republishing derivatives). Pure; the clip function (polygon-clipping) is injected.
import { multi } from './diff.js';

const ofOp = (patch, op) => multi({ features: (patch?.features ?? []).filter(f => f.properties?.op === op) });

// MultiPolygon coordinates of union(base, adds) minus cuts. base is a FeatureCollection, patch a patch file.
export function applyPatch(base, patch, clip) {
  const b = multi(base), adds = ofOp(patch, 'add'), cuts = ofOp(patch, 'cut');
  const parts = [b, adds].filter(g => g.length), grown = parts.length ? clip.union(...parts) : [];
  return cuts.length && grown.length ? clip.difference(grown, cuts) : grown;
}

// shapes: [{ op: 'add' | 'cut', geometry }] drawn by the user. The collection carries no base geometry, only a pointer to it.
export function toPatch(shapes, meta) {
  const props = { taxonKey: Number(meta.taxonKey) || meta.taxonKey, scientificName: meta.scientificName, author: meta.author, created: new Date().toISOString().slice(0, 10),
    sources: meta.sources, basis: 'official-patch', base: meta.base, parent: meta.parent ?? meta.base };
  if (meta.message) props.message = meta.message;
  for (const [k, v] of [['github', meta.github], ['orcid', meta.orcid], ['inat_login', meta.inat]]) if (v) props[k] = v;
  return { type: 'FeatureCollection', features: shapes.map(s => ({ type: 'Feature', properties: { op: s.op }, geometry: s.geometry })), properties: props };
}
