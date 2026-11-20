import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inatSlug, parseInatSlug, pickExact, inatAttribution, inatNote, loadBase, inatRange } from '../src/inat.js';
import { toPatch } from '../src/patch.js';

test('slug build and parse round-trip, and match the base slug rule', () => {
  assert.equal(inatSlug(41974, '2.35'), 'inat-41974-v2-35');
  assert.match(inatSlug('41974', '2.35'), /^[a-z0-9-]{1,80}$/);
  assert.deepEqual(parseInatSlug('inat-41974-v2-35'), { id: '41974', version: '2.35' });
  const p = parseInatSlug('inat-7-v10-2');
  assert.equal(inatSlug(p.id, p.version), 'inat-7-v10-2');
});

test('parse rejects anything else, including official slugs', () => {
  for (const s of ['lithobates-sylvaticus', 'inat-41974', 'inat-41974-v2', 'inat-x-v2-35', 'inat-1-v2-35-1', '', null, undefined]) assert.equal(parseInatSlug(s), null, String(s));
});

test('exact name match only, case-insensitive', () => {
  const r = [{ id: 1, name: 'Lynx canadensis subsp.' }, { id: 41974, name: 'Lynx Canadensis' }, { id: 3, name: 'Lynx rufus' }];
  assert.equal(pickExact('lynx canadensis', r), 41974);
  assert.equal(pickExact('Lynx pardinus', r), null);
  assert.equal(pickExact('Lynx canadensis', []), null);
  assert.equal(pickExact('Lynx canadensis', undefined), null);
});

test('attribution only for iNat bases', () => {
  assert.deepEqual(inatAttribution('lithobates-sylvaticus'), {});
  const a = inatAttribution('inat-41974-v2-35');
  assert.equal(a.derived_from_license, 'CC-BY-4.0');
  assert.match(a.derived_from, /41974.*2\.35/);
  assert.match(inatNote('2.35'), /version 2\.35\. CC BY 4\.0, iNaturalist\.$/);
});

test('loadBase routes official slugs to the official loader and fetches iNat ones pinned', async () => {
  assert.equal(await loadBase('lithobates-sylvaticus', s => `official:${s}`), 'official:lithobates-sylvaticus');
  const urls = [], real = globalThis.fetch;
  globalThis.fetch = async u => { urls.push(u); return u.endsWith('/404.geojson') ? { ok: false, status: 404 } : { ok: true, status: 200, json: async () => ({ type: 'Feature', properties: { geomodel_version: '2.35' }, geometry: null }) }; };
  try {
    const fc = await loadBase('inat-5-v2-35', () => assert.fail('not official'));
    assert.equal(fc.properties.geomodel_version, '2.35');
    assert.equal(urls[0], 'https://inaturalist-open-data.s3.amazonaws.com/geomodel/geojsons/2.35/5.geojson');
    assert.equal(await inatRange('404', 'latest'), null);
    await loadBase('inat-404-v2-35', () => {}).then(() => assert.fail('should throw'), e => assert.match(e.message, /no longer available/));
    // latest seeds the pinned cache: no second download
    await inatRange('6', 'latest');
    const n = urls.length;
    await inatRange('6', '2.35');
    assert.equal(urls.length, n);
  } finally { globalThis.fetch = real; }
});

test('an iNat patch file carries base and license', () => {
  const p = toPatch([{ op: 'cut', geometry: null }], { taxonKey: '1', base: 'inat-5-v2-35' });
  Object.assign(p.properties, inatAttribution(p.properties.base));
  assert.equal(p.properties.basis, 'official-patch');
  assert.equal(p.properties.derived_from_license, 'CC-BY-4.0');
});
