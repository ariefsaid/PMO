// Task 1.5 (AC-EAC-009) — adapter-dispatch ClickUp Vault resolution
// Deno-native test: unit tests for the vaultCredentials resolver.
// The actual integration in adapter-dispatch/index.ts is verified via `deno check` + boot-smoke.

import { resolveClickUpCredentialsFromVault } from '../../../pmo-portal/src/lib/adapterSeam/clickup/vaultCredentials.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(msg ?? `expected ${e}, got ${a}`);
}

// Direct unit tests for the vaultCredentials resolver
Deno.test({
  name: 'AC-EAC-009: resolveClickUpCredentialsFromVault: valid secret_ref + Vault returns token -> returns { token }',
  fn: async () => {
    const result = await resolveClickUpCredentialsFromVault('ref-1', async () => 'vault-pat-token');
    assertEquals(result, { token: 'vault-pat-token' });
  },
});

Deno.test({
  name: 'AC-EAC-009: resolveClickUpCredentialsFromVault: null from Vault -> throws config-rejected',
  fn: async () => {
    try {
      await resolveClickUpCredentialsFromVault('ref-1', async () => null);
      throw new Error('should have thrown');
    } catch (e) {
      assert(e instanceof AppError, 'should throw AppError');
      assertEquals((e as AppError).code, 'config-rejected');
    }
  },
});

Deno.test({
  name: 'AC-EAC-009: resolveClickUpCredentialsFromVault: blank secret_ref -> throws config-rejected',
  fn: async () => {
    try {
      await resolveClickUpCredentialsFromVault('', async () => 'token');
      throw new Error('should have thrown');
    } catch (e) {
      assert(e instanceof AppError, 'should throw AppError');
      assertEquals((e as AppError).code, 'config-rejected');
    }
  },
});