import test from 'node:test';
import assert from 'node:assert/strict';
import { assertOrgDestroyable } from './assert-org-destroyable.mjs';

test('AC-ORG-LIFE-017 script guard asks the DB authority before proceeding', async () => {
  const calls = [];
  const client = { query: async (...args) => { calls.push(args); } };
  await assertOrgDestroyable(client, '01910000-0000-0000-0000-000000000001');
  assert.deepEqual(calls, [[
    'select public.assert_org_destroyable($1::uuid)',
    ['01910000-0000-0000-0000-000000000001'],
  ]]);
});

test('AC-ORG-LIFE-018 script guard refuses before the destructive command on DB denial', async () => {
  const client = { query: async () => { throw new Error('org_not_destroyable'); } };
  await assert.rejects(
    () => assertOrgDestroyable(client, '01910000-0000-0000-0000-000000000003'),
    /Refusing wholesale operation.*org_not_destroyable/,
  );
});
