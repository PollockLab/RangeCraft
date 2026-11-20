import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFile, validateRange, slug } from '../src/geo.js';
import { fc, square } from './helpers.js';

const S = { provider: 'orcid', id: '0000-0002-1825-0097', name: 'Josiah', verified: true };

test('valid file passes', () => validateRange(fc()));

test('rejects structural problems', () => {
  for (const bad of [null, {}, { type: 'FeatureCollection', features: [] }, fc({}, { type: 'Point', coordinates: [0, 0] }),
    fc({}, { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1]]] }),
    fc({}, { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0.5]]] }),
    fc({}, { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 'x'], [0, 0]]] }),
    fc({}, square(0, 0, 0))]) assert.throws(() => validateRange(bad));
});

test('coordinate bounds', () => {
  assert.throws(() => validateRange(fc({}, square(175, 0, 10))), /outside/);
  assert.throws(() => validateRange(fc({}, square(0, 85, 10))), /outside/);
  validateRange(fc({}, square(-180, -90, 180)));
});

test('part limit and bbox ratio', () => {
  const many = { type: 'MultiPolygon', coordinates: Array.from({ length: 201 }, (_, i) => square(-100 + (i % 20) * 3, Math.floor(i / 20) * 3, 1).coordinates) };
  assert.throws(() => validateRange(fc({}, many)), /exceeds/);
  const specks = { type: 'MultiPolygon', coordinates: [square(-170, -80, 1).coordinates, square(170, 80, 1).coordinates] };
  assert.throws(() => validateRange(fc({}, specks)), /bbox/);
});

test('taxonKey must be numeric', () => {
  assert.throws(() => buildFile(fc({ taxonKey: '12a' }), S), /numeric/);
  assert.throws(() => buildFile(fc({ taxonKey: undefined }), S), /numeric/);
});

test('client identity claims are stripped and submitter comes from the session', () => {
  const evil = fc({ github: 'victim', orcid: '0000-0000-0000-0000', inat_login: 'v', identity: 'github', submitter: { provider: 'github', id: 'victim', verified: true }, created: '2001-01-01' });
  evil.features[0].properties = { github: 'victim', submitter: { id: 'x' }, extra: 1 };
  const out = buildFile(evil, S, new Date('2026-05-01T10:00:00Z'));
  for (const p of [out.properties, ...out.features.map(f => f.properties)]) {
    assert.deepEqual(p.submitter, { provider: 'orcid', id: '0000-0002-1825-0097', name: 'Josiah', verified: true });
    for (const k of ['github', 'orcid', 'inat_login', 'identity', 'extra']) assert.ok(!(k in p), k);
    assert.equal(p.created, '2026-05-01');
    assert.equal(p.taxonKey, 123);
  }
});

test('author falls back to the session name; basis rules', () => {
  assert.equal(buildFile(fc({ author: undefined }), S).properties.author, 'Josiah');
  assert.throws(() => buildFile(fc({ basis: 'copied' }), S), /basis/);
  assert.throws(() => buildFile(fc({ basis: 'expert-outline-edit' }), S), /derived_from/);
});

test('slug', () => { assert.equal(slug('Ann O\'Neil!'), 'ann-o-neil'); assert.equal(slug(''), 'anon'); assert.equal(slug('../x'), 'x'); });
