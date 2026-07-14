// Task 1.7 (AC-EAC-011) — clickup-webhook Vault webhook secret resolution
// Deno-native test: verify HMAC verification uses per-org secret when present

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

// Unit tests for the vaultCredentials resolver (shared with adapter-dispatch and clickup-sweep)
Deno.test({
  name: 'AC-EAC-011: resolveClickUpCredentialsFromVault: valid secret_ref + Vault returns token -> returns { token }',
  fn: async () => {
    const result = await resolveClickUpCredentialsFromVault('clickup_token_org1', async () => 'vault-pat-token');
    assertEquals(result, { token: 'vault-pat-token' });
  },
});

Deno.test({
  name: 'AC-EAC-011: resolveClickUpCredentialsFromVault: null from Vault -> throws config-rejected',
  fn: async () => {
    try {
      await resolveClickUpCredentialsFromVault('clickup_token_org1', async () => null);
      throw new Error('should have thrown');
    } catch (e) {
      assert(e instanceof AppError, 'should throw AppError');
      assertEquals((e as AppError).code, 'config-rejected');
    }
  },
});

Deno.test({
  name: 'AC-EAC-011: resolveClickUpCredentialsFromVault: blank secret_ref -> throws config-rejected',
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