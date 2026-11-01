/**
 * Unit tests for resolvePerOrgSecret (AC-EAC-009, AC-EAC-011).
 * Pure, dependency-injected — no DB/Deno runtime needed.
 */

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { spy, assertSpyCalls } from 'https://deno.land/std@0.224.0/testing/mock.ts';
import {
  lookupOrgBindingSecretRef,
  resolveOrgSecretOrFallback,
  resolvePerOrgSecret,
  type PerOrgSecretResult,
} from './perOrgSecret.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';

Deno.test({
  name: 'AC-EAC-009: flag=false → no-binding (never calls lookup/vault)',
  fn: async () => {
    const lookupBinding = spy(async () => ({ secret_ref: 'ref-123' }));
    const readVaultSecret = spy(async () => 'vault-token');

    const result = await resolvePerOrgSecret({
      connectEnabled: false,
      orgId: 'org-1',
      tier: 'clickup',
      lookupBinding,
      readVaultSecret,
    }) as PerOrgSecretResult;

    assertEquals(result.kind, 'no-binding');
    assertSpyCalls(lookupBinding, 0);
    assertSpyCalls(readVaultSecret, 0);
  },
});

Deno.test({
  name: 'AC-EAC-009: flag=true, lookup→null (no binding) → no-binding',
  fn: async () => {
    const lookupBinding = spy(async () => null);
    const readVaultSecret = spy(async () => 'vault-token');

    const result = await resolvePerOrgSecret({
      connectEnabled: true,
      orgId: 'org-1',
      tier: 'clickup',
      lookupBinding,
      readVaultSecret,
    }) as PerOrgSecretResult;

    assertEquals(result.kind, 'no-binding');
    assertSpyCalls(lookupBinding, 1);
    assertSpyCalls(readVaultSecret, 0);
  },
});

Deno.test({
  name: 'AC-EAC-009: flag=true, binding.secret_ref=null → binding-vault-miss',
  fn: async () => {
    const lookupBinding = spy(async () => ({ secret_ref: null }));
    const readVaultSecret = spy(async () => 'vault-token');

    const result = await resolvePerOrgSecret({
      connectEnabled: true,
      orgId: 'org-1',
      tier: 'clickup',
      lookupBinding,
      readVaultSecret,
    }) as PerOrgSecretResult;

    assertEquals(result.kind, 'binding-vault-miss');
    assertSpyCalls(lookupBinding, 1);
    assertSpyCalls(readVaultSecret, 0);
  },
});

Deno.test({
  name: 'AC-EAC-009: flag=true, binding.secret_ref=ref, vault→value → resolved',
  fn: async () => {
    const lookupBinding = spy(async () => ({ secret_ref: 'clickup-ref-123' }));
    const readVaultSecret = spy(async () => 'vault-pat-token');

    const result = await resolvePerOrgSecret({
      connectEnabled: true,
      orgId: 'org-1',
      tier: 'clickup',
      lookupBinding,
      readVaultSecret,
    }) as PerOrgSecretResult;

    assertEquals(result.kind, 'resolved');
    if (result.kind === 'resolved') assertEquals(result.secret, 'vault-pat-token');
    assertSpyCalls(lookupBinding, 1);
    assertSpyCalls(readVaultSecret, 1);
  },
});

Deno.test({
  name: 'AC-EAC-009: flag=true, binding.secret_ref=ref, vault→null → binding-vault-miss',
  fn: async () => {
    const lookupBinding = spy(async () => ({ secret_ref: 'clickup-ref-123' }));
    const readVaultSecret = spy(async () => null);

    const result = await resolvePerOrgSecret({
      connectEnabled: true,
      orgId: 'org-1',
      tier: 'clickup',
      lookupBinding,
      readVaultSecret,
    }) as PerOrgSecretResult;

    assertEquals(result.kind, 'binding-vault-miss');
    assertSpyCalls(lookupBinding, 1);
    assertSpyCalls(readVaultSecret, 1);
  },
});

Deno.test({
  name: 'AC-EAC-011: flag=true, column=webhook_secret_ref, binding.webhook_secret_ref=w, vault→hmac → resolved',
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
    }) as PerOrgSecretResult;

    assertEquals(result.kind, 'resolved');
    if (result.kind === 'resolved') assertEquals(result.secret, 'hmac-secret-from-vault');
    assertSpyCalls(lookupBinding, 1);
    assertSpyCalls(readVaultSecret, 1);
  },
});

Deno.test({
  name: 'AC-EAC-011: flag=true, column=webhook_secret_ref, binding.webhook_secret_ref=null → binding-vault-miss',
  fn: async () => {
    const lookupBinding = spy(async () => ({ secret_ref: 'other-ref', webhook_secret_ref: null }));
    const readVaultSecret = spy(async () => 'hmac-secret-from-vault');

    const result = await resolvePerOrgSecret({
      connectEnabled: true,
      orgId: 'org-1',
      tier: 'clickup',
      column: 'webhook_secret_ref',
      lookupBinding,
      readVaultSecret,
    }) as PerOrgSecretResult;

    assertEquals(result.kind, 'binding-vault-miss');
    assertSpyCalls(lookupBinding, 1);
    assertSpyCalls(readVaultSecret, 0);
  },
});

// ── T-07 B3: a FAILED read is not an absent binding ───────────────────────────────────────────────
// Tri-state: found / absent / failed. Only a confirmed absence may fall back to the global credential;
// a failed binding or vault read must fail closed (the write would otherwise go out under the wrong identity).

Deno.test('T-07 B3: lookupBinding throws → read-failed (never no-binding), vault untouched', async () => {
  const readVaultSecret = spy(async () => 'vault-token');
  const result = await resolvePerOrgSecret({
    connectEnabled: true,
    orgId: 'org-1',
    tier: 'clickup',
    lookupBinding: async () => {
      throw new AppError('connection reset', '08006');
    },
    readVaultSecret,
  });
  assertEquals(result.kind, 'read-failed');
  assertSpyCalls(readVaultSecret, 0);
});

Deno.test('T-07 B3: readVaultSecret throws → read-failed (not a vault miss, not resolved)', async () => {
  const result = await resolvePerOrgSecret({
    connectEnabled: true,
    orgId: 'org-1',
    tier: 'clickup',
    lookupBinding: async () => ({ secret_ref: 'ref-1' }),
    readVaultSecret: async () => {
      throw new AppError('rpc timeout', '57014');
    },
  });
  assertEquals(result.kind, 'read-failed');
});

async function fallbackOutcome(deps: Partial<Parameters<typeof resolvePerOrgSecret>[0]>): Promise<string | AppError> {
  try {
    return await resolveOrgSecretOrFallback(
      {
        connectEnabled: true,
        orgId: 'org-1',
        tier: 'clickup',
        lookupBinding: async () => null,
        readVaultSecret: async () => null,
        ...deps,
      },
      'GLOBAL-TOKEN',
    );
  } catch (e) {
    return e as AppError;
  }
}

Deno.test('T-07 B3: confirmed absent binding falls back to the global credential', async () => {
  assertEquals(await fallbackOutcome({ lookupBinding: async () => null }), 'GLOBAL-TOKEN');
});

Deno.test('T-07 B3: a FAILED binding read fails closed — never the global credential', async () => {
  const out = await fallbackOutcome({
    lookupBinding: async () => {
      throw new AppError('db down', '57P03');
    },
  });
  assert(out instanceof AppError, 'expected a thrown AppError, not a token');
  assertEquals(out.code, 'external-unreachable');
});

Deno.test('T-07 B3: a FAILED vault read fails closed — never the global credential', async () => {
  const out = await fallbackOutcome({
    lookupBinding: async () => ({ secret_ref: 'ref-1' }),
    readVaultSecret: async () => {
      throw new AppError('vault down', '57P03');
    },
  });
  assert(out instanceof AppError, 'expected a thrown AppError, not a token');
  assertEquals(out.code, 'external-unreachable');
});

Deno.test('T-07 B3: bound org with an empty vault secret fails closed (config-rejected)', async () => {
  const out = await fallbackOutcome({
    lookupBinding: async () => ({ secret_ref: 'ref-1' }),
    readVaultSecret: async () => null,
  });
  assert(out instanceof AppError, 'expected a thrown AppError, not a token');
  assertEquals(out.code, 'config-rejected');
});

Deno.test('T-07 B3: a resolved vault secret wins over the global credential', async () => {
  assertEquals(
    await fallbackOutcome({
      lookupBinding: async () => ({ secret_ref: 'ref-1' }),
      readVaultSecret: async () => 'ORG-TOKEN',
    }),
    'ORG-TOKEN',
  );
});

/** Minimal PostgREST-shaped stand-in: the chain ends in `.maybeSingle()` resolving `{data,error}`. */
function bindingClient(result: { data: unknown; error: { message: string; code?: string } | null }) {
  const b: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'eq']) b[m] = () => b;
  b.maybeSingle = () => Promise.resolve(result);
  return b as never;
}

Deno.test('T-07 B3: lookupOrgBindingSecretRef throws on a query error, null only for a confirmed absent row', async () => {
  const failed = lookupOrgBindingSecretRef(bindingClient({ data: null, error: { message: 'boom', code: '57P03' } }));
  let thrown: unknown = null;
  try {
    await failed('org-1', 'clickup');
  } catch (e) {
    thrown = e;
  }
  assert(thrown instanceof AppError, 'a query error must throw, not read as absence');

  assertEquals(await lookupOrgBindingSecretRef(bindingClient({ data: null, error: null }))('org-1', 'clickup'), null);
  assertEquals(
    await lookupOrgBindingSecretRef(bindingClient({ data: { secret_ref: 'ref-1' }, error: null }))('org-1', 'clickup'),
    { secret_ref: 'ref-1' },
  );
});
