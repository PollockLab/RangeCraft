import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIucn, CODES, iucnFilename } from '../src/iucn.js';

const geom = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const m = { sciName: 'Danaus plexippus', compiler: 'A. Person', year: 2026, url: 'https://x/#taxon=1', source: 'field notes' };

test('required attributes and defaults', () => {
  const fc = buildIucn([{ geometry: geom }, { geometry: geom }], m);
  assert.equal(fc.features.length, 2);
  assert.deepEqual(fc.features[0].properties, {
    ID_NO: '', SCI_NAME: 'Danaus plexippus', PRESENCE: 1, ORIGIN: 1, SEASONAL: 1, COMPILER: 'A. Person', YEAR: 2026,
    CITATION: 'RangeCraft community range, https://x/#taxon=1', SOURCE: 'field notes', DIST_COMM: 'Map status: Incomplete. field notes',
  });
  assert.deepEqual(fc.features[0].geometry, geom);
});

test('code lists and bounds', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(CODES).map(([k, v]) => [k, v.length])), { PRESENCE: 6, ORIGIN: 6, SEASONAL: 5 });
  assert.equal(buildIucn([], { ...m, presence: '6', seasonal: 5 }).features.length, 0);
  assert.equal(buildIucn([{ geometry: geom }], { ...m, presence: '3' }).features[0].properties.PRESENCE, 3);
  for (const bad of [0, 7, 1.5, 'x']) assert.throws(() => buildIucn([], { ...m, presence: bad }), /PRESENCE/);
  assert.throws(() => buildIucn([], { ...m, seasonal: 6 }), /SEASONAL/);
});

test('derived copy: SOURCE and CITATION name the origin, user sources are appended', () => {
  const derived = { by: 'USGS GAP', created: '2018-08-15', file: 'data/ranges/1/usgs-gap.geojson' };
  const p = buildIucn([{ geometry: geom }], { ...m, source: '', derived }).features[0].properties;
  assert.equal(p.SOURCE, 'Derived from USGS GAP 2018-08-15; edited in RangeCraft');
  assert.equal(p.CITATION, 'RangeCraft community range, https://x/#taxon=1. Derived from USGS GAP 2018-08-15, data/ranges/1/usgs-gap.geojson');
  assert.equal(buildIucn([{ geometry: geom }], { ...m, derived }).features[0].properties.SOURCE, 'Derived from USGS GAP 2018-08-15; edited in RangeCraft. field notes');
});

test('missing name, blank compiler and source, default year', () => {
  assert.throws(() => buildIucn([], { ...m, sciName: '' }), /SCI_NAME/);
  assert.equal(buildIucn([{ geometry: geom }], { ...m, compiler: '' }).features[0].properties.COMPILER, '');
  const p = buildIucn([{ geometry: geom }], { ...m, source: undefined, year: undefined }).features[0].properties;
  assert.equal(p.SOURCE, '');
  assert.equal(p.YEAR, new Date().getFullYear());
  assert.equal(iucnFilename('Danaus plexippus', 2026), 'danaus-plexippus-iucn-2026.geojson');
});

test('DIST_COMM carries map status then sources; bad status throws', () => {
  const dc = o => buildIucn([{ geometry: geom }], { ...m, ...o }).features[0].properties.DIST_COMM;
  assert.equal(dc({ mapStatus: 'Done' }), 'Map status: Done. field notes');
  assert.equal(dc({ mapStatus: 'Not possible', source: '' }), 'Map status: Not possible.');
  assert.throws(() => dc({ mapStatus: 'Finished' }), /Map status/);
  assert.equal(dc({ countries: ['CA', 'US'] }), 'Map status: Incomplete. Countries: CA, US. field notes');
  assert.equal(dc({ countries: [], source: '' }), 'Map status: Incomplete.');
});

test('a recode patch shape exports its presence; an explicit PRESENCE still wins', () => {
  const ps = buildIucn([{ geometry: geom, properties: { op: 'recode', presence: 5 } }, { geometry: geom, properties: { op: 'cut' } }], m).features.map(f => f.properties.PRESENCE);
  assert.deepEqual(ps, [5, 1]);
});

test('per-feature codes override the defaults; invalid feature codes throw', () => {
  const ps = buildIucn([{ geometry: geom, properties: { PRESENCE: '3' } }, { geometry: geom }], { ...m, presence: 2, origin: 4 }).features.map(f => f.properties);
  assert.deepEqual(ps.map(p => [p.PRESENCE, p.ORIGIN]), [[3, 4], [2, 4]]);
  assert.throws(() => buildIucn([{ geometry: geom, properties: { ORIGIN: 9 } }], m), /ORIGIN/);
});
