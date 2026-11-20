import { REPO } from './api.js';

const MAX_URL = 7000;
const slug = s => String(s || 'anon').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'anon';

export function buildCollection(features, meta) {
  const created = new Date().toISOString().slice(0, 10);
  const props = { taxonKey: Number(meta.taxonKey) || meta.taxonKey, scientificName: meta.scientificName, author: meta.author, created, sources: meta.sources, basis: meta.derived ? 'expert-outline-edit' : 'new' };
  if (meta.derived) props.derived_from = `${meta.derived.by} ${meta.derived.created}, ${meta.derived.file}`;
  if (meta.github) props.github = meta.github;
  if (meta.orcid) props.orcid = meta.orcid;
  if (meta.inat) props.inat_login = meta.inat;
  return {
    type: 'FeatureCollection',
    features: features.map(f => ({ type: 'Feature', properties: { ...props }, geometry: f.geometry })),
    properties: props,
  };
}

export const GITHUB_RE = /^[A-Za-z0-9-]{1,39}$/;
export const ORCID_RE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

export const INAT_RE = /^[A-Za-z0-9_-]{3,40}$/;

export const filename = fc => `${slug(fc.properties.author)}-${fc.properties.created}.geojson`;

export function download(fc, name = filename(fc)) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(fc, null, 1)], { type: 'application/geo+json' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Returns the GitHub "new file" URL, or null when it is too long for a query string.
export function proposeUrl(fc) {
  const url = `https://github.com/${REPO}/new/main/data/ranges/${fc.properties.taxonKey}` +
    `?filename=${encodeURIComponent(filename(fc))}&value=${encodeURIComponent(JSON.stringify(fc))}`;
  return url.length > MAX_URL ? null : url;
}
