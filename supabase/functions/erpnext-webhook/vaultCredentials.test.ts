// Task 1.8 (AC-EAC-010) — erpnext-webhook Vault credentials resolution
// Deno-native test: unit tests for the vaultCredentials resolver

import { resolveErpCredentialsFromVault } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/vaultCredentials.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(msg ?? `expected ${e}, got ${a}`);
}

Deno.test({
  name: 'AC-EAC-010: resolveErpCredentialsFromVault: valid secret_ref + Vault returns apiKey:apiSecret -> returns { apiKey, apiSecret }',
  fn: async () => {
    const result = await resolveErpCredentialsFromVault('ref-1', async () => 'key123:secret456');
    assertEquals(result, { apiKey: 'key123', apiSecret: 'secret456' });
  },
});

Deno.test({
  name: 'AC-EAC-010: resolveErpCredentialsFromVault: null from Vault -> throws config-rejected',
  fn: async () => {
    try {
      await resolveErpCredentialsFromVault('ref-1', async () => null);
      throw new Error('should have thrown');
    } catch (e) {
      assert(e instanceof AppError, 'should throw AppError');
      assertEquals((e as AppError).code, 'config-rejected');
    }
  },
});

Deno.test({
  name: 'AC-EAC-010: resolveErpCredentialsFromVault: blank secret_ref -> throws config-rejected',
  fn: async () => {
    try {
      await resolveErpCredentialsFromVault('', async () => 'key:secret');
      throw new Error('should have thrown');
    } catch (e) {
      assert(e instanceof AppError, 'should throw AppError');
      assertEquals((e as AppError).code, 'config-rejected');
    }
  },
});

Deno.test({
  name: 'AC-EAC-010: resolveErpCredentialsFromVault: invalid format (no colon) -> throws config-rejected',
  fn: async () => {
    try {
      await resolveErpCredentialsFromVault('ref-1', async () => 'invalid-format');
      throw new Error('should have thrown');
    } catch (e) {
      assert(e instanceof AppError, 'should throw AppError');
      assertEquals((e as AppError).code, 'config-rejected');
    }
  },
});

Deno.test({
  name: 'AC-EAC-010: resolveErpCredentialsFromVault: invalid format (empty key or secret) -> throws config-rejected',
  fn: async () => {
    try {
      await resolveErpCredentialsFromVault('ref-1', async () => ':secret-only');
      throw new Error('should have thrown');
    } catch (e) {
      assert(e instanceof AppError, 'should throw AppError');
      assertEquals((e as AppError).code, 'config-rejected');
    }
  },
});