/**
 * Unit tests for resolvePerOrgSecret (AC-EAC-009, AC-EAC-011).
 * Pure, dependency-injected — no DB/Deno runtime needed.
 */

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { spy, assertSpyCalls } from 'https://deno.land/std@0.224.0/testing/mock.ts';
import { resolvePerOrgSecret, type PerOrgSecretDeps } from './perOrgSecret.ts';

Deno.test({
  name: 'AC-EAC-009: flag=false → null (never calls lookup/vault)',
  fn: async () => {
    const lookupBinding = spy(async () => ({ secret_ref: 'ref-123' }));
    const readVaultSecret = spy(async () => 'vault-token');

    const result = await resolvePerOrgSecret({
      connectEnabled: false,
      orgId: 'org-1',
      tier: 'clickup',
      lookupBinding,
      readVaultSecret,
    });

    assertEquals(result, null);
    assertSpyCalls(lookupBinding, 0);
    assertSpyCalls(readVaultSecret, 0);
  },
});

Deno.test({
  name: 'AC-EAC-009: flag=true, lookup→null (no binding) → null',
  fn: async () => {
    const lookupBinding = spy(async () => null);
    const readVaultSecret = spy(async () => 'vault-token');

    const result = await resolvePerOrgSecret({
      connectEnabled: true,
      orgId: 'org-1',
      tier: 'clickup',
      lookupBinding,
      readVaultSecret,
    });

    assertEquals(result, null);
    assertSpyCalls(lookupBinding, 1);
    assertSpyCalls(readVaultSecret, 0);
  },
});

Deno.test({
  name: 'AC-EAC-009: flag=true, binding.secret_ref=null → null',
  fn: async () => {
    const lookupBinding = spy(async () => ({ secret_ref: null }));
    const readVaultSecret = spy(async () => 'vault-token');

    const result = await resolvePerOrgSecret({
      connectEnabled: true,
      orgId: 'org-1',
      tier: 'clickup',
      lookupBinding,
      readVaultSecret,
    });

    assertEquals(result, null);
    assertSpyCalls(lookupBinding, 1);
    assertSpyCalls(readVaultSecret, 0);
  },
});

Deno.test({
  name: 'AC-EAC-009: flag=true, binding.secret_ref=ref, vault→value → value',
  fn: async () => {
    const lookupBinding = spy(async () => ({ secret_ref: 'clickup-ref-123' }));
    const readVaultSecret = spy(async () => 'vault-pat-token');

    const result = await resolvePerOrgSecret({
      connectEnabled: true,
      orgId: 'org-1',
      tier: 'clickup',
      lookupBinding,
      readVaultSecret,
    });

    assertEquals(result, 'vault-pat-token');
    assertSpyCalls(lookupBinding, 1);
    assertSpyCalls(readVaultSecret, 1);
  },
});

Deno.test({
  name: 'AC-EAC-009: flag=true, binding.secret_ref=ref, vault→null → null',
  fn: async () => {
    const lookupBinding = spy(async () => ({ secret_ref: 'clickup-ref-123' }));
    const readVaultSecret = spy(async () => null);

    const result = await resolvePerOrgSecret({
      connectEnabled: true,
      orgId: 'org-1',
      tier: 'clickup',
      lookupBinding,
      readVaultSecret,
    });

    assertEquals(result, null);
    assertSpyCalls(lookupBinding, 1);
    assertSpyCalls(readVaultSecret, 1);
  },
});

Deno.test({
  name: 'AC-EAC-011: flag=true, column=webhook_secret_ref, binding.webhook_secret_ref=w, vault→hmac → hmac',
  fn: async () => {
    const lookupBinding = spy(async () => ({ secret_ref: 'other-ref', webhook_secret_ref: 'webhook-ref-456' }));
    const readVaultSecret = spy(async () => 'hmac-secret-from-vault');

    const result = await resolvePerOrgSecret({
      connectEnabled: true,
      orgId: 'org-1',
      tier: 'clickup',
      column: 'webhook_secret_ref',
      lookupBinding,
      readVaultSecret,
    });

    assertEquals(result, 'hmac-secret-from-vault');
    assertSpyCalls(lookupBinding, 1);
    assertSpyCalls(readVaultSecret, 1);
  },
});