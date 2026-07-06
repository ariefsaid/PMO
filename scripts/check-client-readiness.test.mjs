import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyMigrationCount,
  classifyOrgAdminExistence,
  classifyAnonReadSanity,
} from './check-client-readiness.mjs';
import { classifyEnvSecrets, classifyProbeResult } from './check-agent-prod-readiness.mjs';

test('AC-PROV-004 (reused classifier): a 404 edge-fn probe reports unhealthy with the exact deploy hint', () => {
  const verdict = classifyProbeResult({ status: 404, expectedUnauthenticated: true });
  assert.equal(verdict.healthy, false);
  assert.match(verdict.detail, /404/);
});

test('AC-PROV-005 (reused classifier): OPENROUTER_API_KEY unset reports NOT SET, never a value', () => {
  const result = classifyEnvSecrets({}, ['OPENROUTER_API_KEY']);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['OPENROUTER_API_KEY']);
});

test('classifyMigrationCount: reports healthy when remote count equals the repo migration-file count', () => {
  const verdict = classifyMigrationCount({ repoCount: 72, remoteCount: 72 });
  assert.equal(verdict.healthy, true);
});

test('classifyMigrationCount: reports unhealthy with the exact gap when remote is behind', () => {
  const verdict = classifyMigrationCount({ repoCount: 72, remoteCount: 65 });
  assert.equal(verdict.healthy, false);
  assert.match(verdict.detail, /7/);
});

test('classifyOrgAdminExistence: reports healthy when exactly one org + one linked Admin profile exist', () => {
  const verdict = classifyOrgAdminExistence({ orgCount: 1, adminProfileCount: 1, adminOrgIdMatches: true });
  assert.equal(verdict.healthy, true);
});

test('classifyOrgAdminExistence: reports unhealthy when the Admin org_id does not match the org', () => {
  const verdict = classifyOrgAdminExistence({ orgCount: 1, adminProfileCount: 1, adminOrgIdMatches: false });
  assert.equal(verdict.healthy, false);
});

test('classifyAnonReadSanity: reports healthy (RLS working) when an anon read returns empty/denied', () => {
  const verdict = classifyAnonReadSanity({ anonRowCount: 0 });
  assert.equal(verdict.healthy, true);
});

test('classifyAnonReadSanity: reports unhealthy (RLS hole) when an anon read returns rows', () => {
  const verdict = classifyAnonReadSanity({ anonRowCount: 3 });
  assert.equal(verdict.healthy, false);
  assert.match(verdict.detail, /RLS/);
});
