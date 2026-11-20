import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupOf, speciesByGroup } from '../src/groups.js';

test('groupOf maps GBIF classification to iconic groups', () => {
  assert.equal(groupOf({ kingdom: 'Plantae' }), 'plants');
  assert.equal(groupOf({ kingdom: 'Fungi' }), 'fungi');
  assert.equal(groupOf({ kingdom: 'Animalia', class: 'Amphibia' }), 'amphibians');
  assert.equal(groupOf({ kingdom: 'Animalia', class: 'Actinopterygii' }), 'fish');
  assert.equal(groupOf({ kingdom: 'Animalia', phylum: 'Mollusca', class: 'Gastropoda' }), 'molluscs');
  assert.equal(groupOf({ kingdom: 'Animalia', class: 'Anthozoa' }), 'other');
  assert.equal(groupOf({ kingdom: 'Chromista' }), null);
  assert.equal(groupOf(null), null);
});

test('speciesByGroup counts species and sources; empty groups stay present', async () => {
  const cls = { 1: { kingdom: 'Animalia', class: 'Amphibia' }, 2: { kingdom: 'Animalia', class: 'Aves' } };
  const f = async u => ({ ok: true, json: async () => cls[u.split('/').pop()] });
  const by = await speciesByGroup([{ taxonKey: 1, scientificName: 'B b' }, { taxonKey: 1, scientificName: 'B b' }, { taxonKey: 2, scientificName: 'A a' }], f);
  assert.deepEqual(by.amphibians, [{ key: 1, name: 'B b', sources: 2 }]);
  assert.equal(by.birds.length, 1);
  assert.equal(by.all.length, 2);
  assert.deepEqual(by.plants, []);
});
