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

/** A minimal fake client matching the two reads the fn issues: the bindings
 *  (`.from(t).select(c).eq(...)`) and the per-org domain ownership (`.from(t).select(c).eq(...).in(...)`,
 *  Luna BLOCK 9). Each table answers its own scripted result. */
function fakeClient(
  bindings: { data: unknown; error: { code?: string; message: string } | null },
  ownership: { data: unknown; error: { code?: string; message: string } | null } = { data: [], error: null },
): SupabaseClient {
  return {
    from: (table: string) => {
      const result = table === 'external_domain_ownership' ? ownership : bindings;
      const builder = {
        eq: () => builder,
        in: () => Promise.resolve(result),
        then: (resolve: (v: unknown) => void) => resolve(result),
      };
      return { select: () => builder };
    },
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
    }, { data: [{ org_id: 'org-1', domain: 'procurement' }], error: null });
    const orgs = await listEmployingOrgsLive(client);
    assert(logs.length === 0, 'expected no console.error call on a clean read');
    assert(orgs.length === 1, `expected one employing org, got ${orgs.length}`);
    assert(orgs[0].orgId === 'org-1', 'expected the org_id to map through');
    assert(
      JSON.stringify(orgs[0].ownedDomains) === JSON.stringify(['procurement']),
      `BLOCK 9: expected the org's REAL owned domains to load, got ${JSON.stringify(orgs[0].ownedDomains)}`,
    );
  } finally {
    console.error = originalError;
  }
});

Deno.test('BLOCK 9: an org with no recorded domain ownership loads as owning NOTHING (fail-closed, so it sweeps nothing)', async () => {
  const client = fakeClient({
    data: [{ org_id: 'org-1', site_url: 'http://localhost:8080', secret_ref: 'ref-1', config: {}, activated_at: '2026-07-01T00:00:00Z' }],
    error: null,
  }, { data: [], error: null });
  const orgs = await listEmployingOrgsLive(client);
  assert(orgs.length === 1, 'the binding itself is still an employing org');
  assert(orgs[0].ownedDomains.length === 0, 'expected NO owned domain — the sweep must then poll no doctype at all');
});

Deno.test('BLOCK 9: an ownership READ failure fail-safes the tick to [] (never sweeps blind) and is logged', async () => {
  const logs: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { logs.push(args); };
  try {
    const client = fakeClient({
      data: [{ org_id: 'org-1', site_url: 'http://localhost:8080', secret_ref: 'ref-1', config: {}, activated_at: '2026-07-01T00:00:00Z' }],
      error: null,
    }, { data: null, error: { code: '57014', message: 'statement timeout' } });
    const orgs = await listEmployingOrgsLive(client);
    assert(orgs.length === 0, 'expected the tick to fail-safe to no orgs rather than sweep with unknown ownership');
    assert(logs.length === 1, `expected the ownership load failure to be logged, got ${logs.length}`);
  } finally {
    console.error = originalError;
  }
});
