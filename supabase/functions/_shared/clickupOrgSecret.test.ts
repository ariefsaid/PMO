// ClickUp credentials resolve per org and fail closed (no deployment-wide fallback).
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveClickUpOrgToken, resolveClickUpWebhookSecrets } from './clickupOrgSecret.ts';

type Binding = { org_id: string; secret_ref: string | null; webhook_secret_ref: string | null };
const VAULT: Record<string, string> = { 'ref-a': 'token-a', 'ref-b': 'token-b', 'wh-a': 'hook-a', 'wh-b': 'hook-b' };

/** Minimal query-builder fake: filters bindings by the .eq() calls, serves read_vault_secret from VAULT. */
function fakeClient(bindings: Binding[], opts: { listError?: boolean } = {}): SupabaseClient {
  return {
    from: () => {
      const filters: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => { filters[k] = v; return q; },
        maybeSingle: async () => ({
          data: bindings.find((b) => b.org_id === filters.org_id) ?? null,
          error: null,
        }),
        then: (resolve: (v: unknown) => void) =>
          resolve(opts.listError ? { data: null, error: { message: 'blip', code: '57P03' } } : { data: bindings, error: null }),
      };
      return q;
    },
    rpc: async (_fn: string, args: { p_secret_ref: string }) => ({ data: VAULT[args.p_secret_ref] ?? null, error: null }),
  } as unknown as SupabaseClient;
}

const bindings: Binding[] = [
  { org_id: 'org-a', secret_ref: 'ref-a', webhook_secret_ref: 'wh-a' },
  { org_id: 'org-b', secret_ref: 'ref-b', webhook_secret_ref: 'wh-b' },
];

Deno.env.set('CLICKUP_API_TOKEN', 'deployment-wide-token');

Deno.test('each org resolves its own ClickUp token', async () => {
  const c = fakeClient(bindings);
  assertEquals(await resolveClickUpOrgToken(c, 'org-a', true), 'token-a');
  assertEquals(await resolveClickUpOrgToken(c, 'org-b', true), 'token-b');
});

Deno.test('an org with no binding fails closed, never the deployment-wide token', async () => {
  await assertRejects(() => resolveClickUpOrgToken(fakeClient(bindings), 'org-c', true), Error, 'not connected');
});

Deno.test('a binding whose secret is missing in Vault fails closed', async () => {
  const c = fakeClient([{ org_id: 'org-a', secret_ref: 'ref-gone', webhook_secret_ref: null }]);
  await assertRejects(() => resolveClickUpOrgToken(c, 'org-a', true), Error, 'unresolved');
});

Deno.test('the operator kill-switch refuses before any lookup', async () => {
  await assertRejects(() => resolveClickUpOrgToken(fakeClient(bindings), 'org-a', false), Error, 'disabled');
});

Deno.test('webhook secrets resolve per org; a binding without one contributes nothing', async () => {
  const c = fakeClient([...bindings, { org_id: 'org-c', secret_ref: 'ref-a', webhook_secret_ref: null }]);
  const out = await resolveClickUpWebhookSecrets(c);
  assertEquals(out, [{ orgId: 'org-a', secret: 'hook-a' }, { orgId: 'org-b', secret: 'hook-b' }]);
  assert(!out.some((o) => o.secret === 'deployment-wide-token'));
});

Deno.test('a failed binding list read throws (retryable), it is not an empty list', async () => {
  await assertRejects(() => resolveClickUpWebhookSecrets(fakeClient(bindings, { listError: true })));
});
