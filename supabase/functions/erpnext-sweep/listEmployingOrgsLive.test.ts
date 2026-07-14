// task FIX-5 (Quality IMPORTANT 2) [Deno unit] — `listEmployingOrgsLive` must not swallow a real
// `external_org_bindings` load error: it must `console.error` it (the sweep is a cron/cycle, so it
// still fail-safes to `[]` for that tick rather than crashing the whole invocation — unlike the
// webhook's single-request trust boundary, which surfaces 500 instead, see erpnext-webhook/index.test.ts).
//
// Verify: cd supabase/functions/erpnext-sweep && deno test listEmployingOrgsLive.test.ts

// Stub Deno.serve so importing index.ts (top-level Deno.serve) does not bind a port under deno test.
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { listEmployingOrgsLive } = await import('./index.ts');
import type { SupabaseClient } from '@supabase/supabase-js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** A minimal fake client matching the `.from(table).select(cols).eq(col, val)` shape the fn uses. */
function fakeClient(result: { data: unknown; error: { code?: string; message: string } | null }): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: async () => result,
      }),
    }),
  } as unknown as SupabaseClient;
}

Deno.test('FIX-5: a real DB error is console.error-logged (not silently swallowed) and the sweep still fail-safes to []', async () => {
  const logs: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { logs.push(args); };
  try {
    const client = fakeClient({ data: null, error: { code: '57014', message: 'statement timeout' } });
    const orgs = await listEmployingOrgsLive(client);
    assert(orgs.length === 0, 'expected a fail-safe empty array on a DB error');
    assert(logs.length === 1, `expected exactly one console.error call, got ${logs.length}`);
    const logged = String(logs[0]?.[0] ?? '');
    assert(logged.includes('57014'), `expected the logged line to carry the error code, got: ${logged}`);
    assert(logged.includes('statement timeout'), `expected the logged line to carry the error message, got: ${logged}`);
  } finally {
    console.error = originalError;
  }
});

Deno.test('FIX-5: no DB error → no console.error call, rows mapped normally', async () => {
  const logs: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { logs.push(args); };
  try {
    const client = fakeClient({
      data: [{ org_id: 'org-1', site_url: 'http://localhost:8080', secret_ref: 'ref-1', config: { company: 'Acme' }, activated_at: '2026-07-01T00:00:00Z' }],
      error: null,
    });
    const orgs = await listEmployingOrgsLive(client);
    assert(logs.length === 0, 'expected no console.error call on a clean read');
    assert(orgs.length === 1, `expected one employing org, got ${orgs.length}`);
    assert(orgs[0].orgId === 'org-1', 'expected the org_id to map through');
  } finally {
    console.error = originalError;
  }
});
