import assert from 'node:assert/strict';
import test from 'node:test';
import {
  S21_FIXTURE_PHASE_TIMEOUT_MS,
  runS21FixtureCleanup,
} from './AC-S21-005-lifecycle.mjs';

test('fixture setup and cleanup hooks retain the original 30-second bound', () => {
  assert.equal(S21_FIXTURE_PHASE_TIMEOUT_MS, 30_000);
});

test('a failed preflight preserves all fixture rows and stops only an owned server', async () => {
  const calls = [];
  const primary = new Error('preflight collision');
  const cleanupError = new Error('cleanup transport error');

  await assert.rejects(runS21FixtureCleanup({
    preflightPassed: false,
    ownedServer: { id: 'owned' },
    primaryFailure: primary,
    stopOwnedServer: async (server) => {
      calls.push(`stop:${server.id}`);
      throw cleanupError;
    },
    cleanupOwnedRows: async () => calls.push('delete-rows'),
  }), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [primary, cleanupError]);
    return true;
  });

  assert.deepEqual(calls, ['stop:owned']);
});

test('partial setup after successful preflight cleans owned rows after stopping its server', async () => {
  const calls = [];
  await runS21FixtureCleanup({
    preflightPassed: true,
    ownedServer: { id: 'owned' },
    primaryFailure: new Error('partial setup failed'),
    stopOwnedServer: async (server) => calls.push(`stop:${server.id}`),
    cleanupOwnedRows: async () => calls.push('delete-owned-rows'),
  });

  assert.deepEqual(calls, ['stop:owned', 'delete-owned-rows']);
});

test('cleanup failures preserve the original browser assertion and every cleanup error', async () => {
  const primary = new Error('browser assertion failed');
  const stopFailure = new Error('handler stop failed');
  const fixtureFailure = new Error('owned-row reconciliation failed');

  await assert.rejects(runS21FixtureCleanup({
    preflightPassed: true,
    ownedServer: { id: 'owned' },
    primaryFailure: primary,
    stopOwnedServer: async () => { throw stopFailure; },
    cleanupOwnedRows: async () => { throw fixtureFailure; },
  }), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [primary, stopFailure, fixtureFailure]);
    return true;
  });
});

test('a fixture without an owned server never attempts to stop one', async () => {
  const calls = [];
  await runS21FixtureCleanup({
    preflightPassed: true,
    ownedServer: null,
    primaryFailure: null,
    stopOwnedServer: async () => calls.push('stop'),
    cleanupOwnedRows: async () => calls.push('delete-owned-rows'),
  });

  assert.deepEqual(calls, ['delete-owned-rows']);
});
