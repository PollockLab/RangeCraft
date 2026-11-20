import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCollection, exportName } from '../src/export.js';

const geom = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const meta = { taxonKey: '1', scientificName: 'X y', author: '', sources: '' };

test('new drawing: basis new, no derived_from, blank author allowed', () => {
  const p = buildCollection([{ geometry: geom }], meta).features[0].properties;
  assert.equal(p.basis, 'new');
  assert.equal(p.author, '');
  assert.equal('derived_from' in p, false);
});

test('edited copy: basis edit and derived_from on every feature', () => {
  const derived = { by: 'USGS GAP', created: '2018-08-15', file: 'data/ranges/1/usgs-gap.geojson' };
  const fc = buildCollection([{ geometry: geom }, { geometry: geom }], { ...meta, derived });
  for (const f of fc.features) {
    assert.equal(f.properties.basis, 'expert-outline-edit');
    assert.equal(f.properties.derived_from, 'USGS GAP 2018-08-15, data/ranges/1/usgs-gap.geojson');
  }
});

test('exportName uses the species slug', () => {
  assert.equal(exportName({ properties: { scientificName: 'Lithobates sylvaticus', created: '2026-01-02' } }), 'lithobates-sylvaticus-2026-01-02.geojson');
  assert.equal(exportName({ properties: { created: '2026-01-02' } }), 'anon-2026-01-02.geojson');
});
