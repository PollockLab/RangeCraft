import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHash, parseHash } from '../src/share.js';

test('round trip', () => {
  const s = { taxon: '2427072', ranges: ['2427072/usgs-gap'], official: true, sdm: false, rc: true, occ: false, agree: true, at: [4, 50.1234, -80.5] };
  const h = buildHash(s);
  assert.equal(h, '#taxon=2427072&ranges=2427072/usgs-gap&official=1&rc=1&occ=0&at=4.00/50.1234/-80.5000');
  assert.deepEqual(parseHash(h), { ...s, at: [4, 50.1234, -80.5] });
});

test('defaults and legacy #taxon= links', () => {
  assert.deepEqual(parseHash('#taxon=1'), { taxon: '1', official: false, sdm: false, rc: false, occ: true, agree: true });
});

test('malformed input is dropped', () => {
  assert.equal(parseHash('#taxon=abc'), null);
  assert.equal(parseHash(''), null);
  const s = parseHash('#taxon=1&ranges=1/ok,<script>,../x&at=99/0/0');
  assert.deepEqual(s.ranges, ['1/ok']);
  assert.equal(s.at, undefined);
});

test('preview: only a commit sha and a file under the same taxon', () => {
  const sha = 'a'.repeat(40);
  assert.equal(parseHash(`#taxon=1&preview=${sha}/1/x-1.geojson`).preview, `${sha}/1/x-1.geojson`);
  assert.equal(parseHash(`#taxon=1&preview=${sha}/2/x.geojson`).preview, undefined);
  assert.equal(parseHash(`#taxon=1&preview=main/1/x.geojson`).preview, undefined);
  assert.equal(parseHash(`#taxon=1&preview=${sha}/1/../x.geojson`).preview, undefined);
});
