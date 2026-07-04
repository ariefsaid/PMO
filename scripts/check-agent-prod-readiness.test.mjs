/**
 * Unit tests for the PURE helpers in check-agent-prod-readiness.mjs (harden #1 item 2).
 * The script's network probes are integration-only (it hits a live base URL) — these
 * tests cover only the logic that does NOT require a network call: GUC/secret-presence
 * classification and probe-result interpretation, mirroring the sync-agent-surfaces.mjs /
 * changed-lines-coverage.mjs pattern (node:test, no framework dependency).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyEnvSecrets,
  classifyProbeResult,
  REQUIRED_ENV_VARS,
} from './check-agent-prod-readiness.mjs';

test('classifyEnvSecrets reports every required var missing when env is empty', () => {
  const result = classifyEnvSecrets({});
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.missing.sort(),
    [...REQUIRED_ENV_VARS].sort(),
  );
  assert.equal(result.present.length, 0);
});

test('classifyEnvSecrets reports ok:true and never echoes the secret VALUE, only presence', () => {
  const env = Object.fromEntries(REQUIRED_ENV_VARS.map((k) => [k, 'super-secret-value']));
  const result = classifyEnvSecrets(env);
  assert.equal(result.ok, true);
  assert.equal(result.missing.length, 0);
  assert.deepEqual(result.present.sort(), [...REQUIRED_ENV_VARS].sort());
  // The classification result must never carry the raw secret string anywhere.
  assert.equal(JSON.stringify(result).includes('super-secret-value'), false);
});

test('classifyEnvSecrets treats an empty-string var as missing (not merely undefined)', () => {
  const env = Object.fromEntries(REQUIRED_ENV_VARS.map((k) => [k, '']));
  const result = classifyEnvSecrets(env);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing.sort(), [...REQUIRED_ENV_VARS].sort());
});

test('classifyProbeResult: a 401-without-auth response is the EXPECTED healthy signal', () => {
  const verdict = classifyProbeResult({ status: 401, expectedUnauthenticated: true });
  assert.equal(verdict.healthy, true);
  assert.match(verdict.detail, /401/);
});

test('classifyProbeResult: a 200 with-auth response is the EXPECTED healthy signal', () => {
  const verdict = classifyProbeResult({ status: 200, expectedUnauthenticated: false });
  assert.equal(verdict.healthy, true);
});

test('classifyProbeResult: an unreachable/network-error probe is unhealthy', () => {
  const verdict = classifyProbeResult({ status: null, error: 'ECONNREFUSED', expectedUnauthenticated: true });
  assert.equal(verdict.healthy, false);
  assert.match(verdict.detail, /ECONNREFUSED/);
});

test('classifyProbeResult: a 404 (function not deployed) is unhealthy with a clear reason', () => {
  const verdict = classifyProbeResult({ status: 404, expectedUnauthenticated: true });
  assert.equal(verdict.healthy, false);
  assert.match(verdict.detail, /404/);
});

test('classifyProbeResult: a 500 (deployed but erroring) is unhealthy', () => {
  const verdict = classifyProbeResult({ status: 500, expectedUnauthenticated: false });
  assert.equal(verdict.healthy, false);
});
