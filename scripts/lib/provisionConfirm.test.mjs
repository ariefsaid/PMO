import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmSlugMatches } from './provisionConfirm.mjs';

test('AC-PROV-002: a typed slug that does NOT match the target slug fails the confirm', () => {
  assert.equal(confirmSlugMatches({ targetSlug: 'acme-co', typed: 'acme-corp' }), false);
});

test('AC-PROV-002: a typed slug that matches exactly passes the confirm', () => {
  assert.equal(confirmSlugMatches({ targetSlug: 'acme-co', typed: 'acme-co' }), true);
});
