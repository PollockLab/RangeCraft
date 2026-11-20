import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWho } from '../src/who.js';

const form = vals => { const els = {}; const $ = id => (els[id] ??= { value: vals[id] ?? '', hidden: false }); return $; };

test('signed in: session identity, fields hidden, form values ignored', () => {
  const $ = form({ author: 'typed', orcid: 'bad' });
  assert.deepEqual(readWho($, { name: 'Ann' }, true), { author: 'Ann', github: '', orcid: '', inat: '' });
  assert.equal($('author-field').hidden && $('me').hidden, true);
});

test('signed out: name required only when proposing, optional links validated, fields shown', () => {
  const $ = form({});
  assert.equal(readWho($, null, true).field, 'author');
  assert.equal(readWho($, null, false).author, '');
  assert.equal($('me').hidden, false);
  assert.equal(readWho(form({ author: 'A', orcid: 'x' }), null, true).field, 'orcid');
  assert.equal(readWho(form({ author: 'A', github: '-bad name' }), null, true).field, 'github');
  assert.deepEqual(readWho(form({ author: 'A', inat: 'ann_1' }), null, true), { author: 'A', github: '', orcid: '', inat: 'ann_1' });
});
