import assert from 'node:assert/strict';
import test from 'node:test';
import { resetPatternForOrg, SEED_ORG_ID } from '../global-project-number-pattern.ts';

function fakeAdmin(error = null) {
  const calls = [];
  const admin = {
    from(table) {
      calls.push(['from', table]);
      return {
        update(values) {
          calls.push(['update', values]);
          // Returning a thenable only from eq() means an unscoped update (no eq) cannot resolve.
          return { eq(column, value) { calls.push(['eq', column, value]); return Promise.resolve({ error }); } };
        },
      };
    },
  };
  return { admin, calls };
}

test('AC-1869 resets the pattern for the given organization only, scoped by id', async () => {
  const { admin, calls } = fakeAdmin();
  await resetPatternForOrg(admin, SEED_ORG_ID);
  assert.deepEqual(calls, [
    ['from', 'organizations'],
    ['update', { project_number_pattern: null }],
    ['eq', 'id', SEED_ORG_ID],
  ]);
});

test('AC-1869 surfaces a failed reset', async () => {
  const { admin } = fakeAdmin({ message: 'boom' });
  await assert.rejects(resetPatternForOrg(admin, SEED_ORG_ID), /reset project_number_pattern failed: boom/);
});
