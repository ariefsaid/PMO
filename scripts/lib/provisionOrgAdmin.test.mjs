import assert from 'node:assert/strict';
import test from 'node:test';
import { createOrgIfAbsent } from './provisionOrgAdmin.mjs';

function makeFakeClient(existingRows) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.startsWith('select')) return { rows: existingRows };
      return { rows: [{ id: 'new-org-id' }] };
    },
  };
}

test('PROV-E002 / AC-PROV-007: an existing slug reports already-provisioned, does not INSERT', async () => {
  const client = makeFakeClient([{ id: 'existing-org-id' }]);
  const result = await createOrgIfAbsent(client, 'acme-co', 'Acme Co');
  assert.equal(result.action, 'already-provisioned');
  assert.equal(result.orgId, 'existing-org-id');
  assert.ok(!client.calls.some((c) => c.sql.startsWith('insert')));
});

test('AC-PROV-007: an absent slug creates exactly one organizations row', async () => {
  const client = makeFakeClient([]);
  const result = await createOrgIfAbsent(client, 'new-co', 'New Co');
  assert.equal(result.action, 'created');
  assert.equal(result.orgId, 'new-org-id');
  assert.equal(client.calls.filter((c) => c.sql.startsWith('insert')).length, 1);
});
