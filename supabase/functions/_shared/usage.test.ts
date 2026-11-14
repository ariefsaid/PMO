import { assertEquals } from 'jsr:@std/assert@1';
import {
  __usageFailureScopeCountForTests,
  insertUsageRow,
  recordTrustedUsage,
  resetUsageFailureCounter,
  UsageMeteringUnavailableError,
} from './usage.ts';

function usageClient() {
  const inserted: Record<string, unknown>[] = [];
  const client = {
    from(table: string) {
      return {
        select(_columns: string) {
          return {
            eq(_column: string, value: string) {
              return {
                single() {
                  if (table === 'profiles') return { data: { org_id: 'org-1' }, error: null };
                  if (table === 'agent_runs') return { data: { id: value, owner_id: 'user-1', org_id: 'org-1', thread_id: 'thread-1' }, error: null };
                  return { data: { id: value, owner_id: 'user-1', org_id: 'org-1' }, error: null };
                },
              };
            },
          };
        },
        insert(row: Record<string, unknown>) {
          inserted.push(row);
          return { select: () => ({ single: () => ({ error: null }) }) };
        },
      };
    },
  };
  return { client, inserted };
}

Deno.test('usage accounting records exactly one provider-priced row for an owned run', async () => {
  const { client, inserted } = usageClient();
  await recordTrustedUsage({ serviceClient: client, userId: 'user-1', orgId: 'org-1', runId: 'run-1', threadId: 'thread-1' }, {
    model: 'provider-model', finish_reason: 'stop', message: { role: 'assistant', content: 'ok' },
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18, total_cost: 0.37 },
  });
  assertEquals(inserted.length, 1);
  assertEquals(inserted[0].owner_id, 'user-1');
  assertEquals(inserted[0].org_id, 'org-1');
  assertEquals(inserted[0].cost, 0.37);
  assertEquals(inserted[0].provider_cost_usd, 0.37);
});

Deno.test('usage accounting ignores request-supplied identity and cost fields', async () => {
  const { client, inserted } = usageClient();
  const forgedInput = {
    serviceClient: client,
    userId: 'user-1',
    orgId: 'org-1',
    runId: null,
    org_id: 'forged-org',
    user_id: 'forged-user',
    cost: 9000,
  };
  await recordTrustedUsage(forgedInput, {
    model: 'provider-model', finish_reason: 'stop', message: { role: 'assistant', content: 'ok' },
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, total_cost: 0.12 },
  });
  assertEquals(inserted.length, 1);
  assertEquals(inserted[0].owner_id, 'user-1');
  assertEquals(inserted[0].org_id, 'org-1');
  assertEquals(inserted[0].cost, 0.12);
});

Deno.test('usage accounting tolerates transient trusted insert failures and fails closed at threshold', async () => {
  resetUsageFailureCounter();
  const { client } = usageClient();
  const failing = {
    ...client,
    from(table: string) {
      const query = client.from(table);
      if (table !== 'agent_usage') return query;
      return { ...query, insert: () => ({ select: () => ({ single: async () => ({ error: { code: '08006' } }) }) }) };
    },
  };
  const deps = { serviceClient: failing, userId: 'user-1', orgId: 'org-1', runId: null };
  const response = { model: 'provider-model', finish_reason: 'stop' as const, message: { role: 'assistant' as const, content: 'ok' }, usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, total_cost: 0.12 } };
  await recordTrustedUsage(deps, response);
  await recordTrustedUsage(deps, response);
  await recordTrustedUsage(deps, response).then(() => { throw new Error('threshold should fail closed'); }, (error) => {
    assertEquals(error instanceof UsageMeteringUnavailableError, true);
  });
  resetUsageFailureCounter();
});

Deno.test('usage accounting counts transient identity lookup failures without blocking paid turns', async () => {
  resetUsageFailureCounter();
  const { client } = usageClient();
  const failing = {
    ...client,
    from(table: string) {
      if (table === 'profiles') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { code: '08006' } }) }) }) };
      }
      return client.from(table);
    },
  };
  const deps = { serviceClient: failing, userId: 'user-1', orgId: 'org-1', runId: null };
  const response = { model: 'provider-model', finish_reason: 'stop' as const, message: { role: 'assistant' as const, content: 'ok' } };
  await recordTrustedUsage(deps, response);
  await recordTrustedUsage(deps, response);
  await recordTrustedUsage(deps, response).then(() => { throw new Error('threshold should fail closed'); }, (error) => {
    assertEquals(error instanceof UsageMeteringUnavailableError, true);
  });
  resetUsageFailureCounter();
});

Deno.test('usage accounting rejects a run outside the verified caller and org', async () => {
  resetUsageFailureCounter();
  const { client } = usageClient();
  await recordTrustedUsage({ serviceClient: client, userId: 'other-user', orgId: 'org-1', runId: 'run-1' }, {
    model: 'provider-model', finish_reason: 'stop', message: { role: 'assistant', content: 'ok' },
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, total_cost: 0.12 },
  }).then(() => { throw new Error('ownership check should reject'); }, (error) => {
    assertEquals(error.message, 'usage run not owned');
  });
  resetUsageFailureCounter();
});

// ── Per-organization fail-closed counter (one warm isolate serves several orgs) ─────────────

/** Caller-JWT-shaped client whose agent_usage inserts succeed or fail on demand. */
function insertOnlyClient(mode: { fail: boolean }) {
  const inserted: Record<string, unknown>[] = [];
  const supabase = {
    from(_table: string) {
      return {
        insert(row: Record<string, unknown>) {
          inserted.push(row);
          return {
            select: () => ({
              single: () =>
                Promise.resolve(mode.fail ? { error: { code: '08006' } } : { error: null }),
            }),
          };
        },
      };
    },
  };
  return { supabase, inserted };
}

/** Usage deps scoped to one organization — the scope the fail-closed counter must keep. */
function orgDeps(client: ReturnType<typeof insertOnlyClient>['supabase'], orgId: string) {
  return { supabase: client, runId: null, orgId };
}

const meteredFields = { model: 'provider-model', prompt_tokens: 1, completion_tokens: 1, cost: 0.12 };

Deno.test('usage fail-closed threshold is per organization: a sibling org success does not reset a failing org', async () => {
  resetUsageFailureCounter();
  const a = insertOnlyClient({ fail: true });
  const b = insertOnlyClient({ fail: false });
  const orgA = orgDeps(a.supabase, 'org-a');
  const orgB = orgDeps(b.supabase, 'org-b');
  await insertUsageRow(orgA, meteredFields); // org-a failure 1
  await insertUsageRow(orgA, meteredFields); // org-a failure 2
  await insertUsageRow(orgB, meteredFields); // org-b succeeds in between
  await insertUsageRow(orgA, meteredFields).then(
    () => { throw new Error('threshold should fail closed for org-a'); },
    (error) => { assertEquals(error instanceof UsageMeteringUnavailableError, true); },
  );
  assertEquals(b.inserted.length, 1); // org-b's write landed and never threw
  resetUsageFailureCounter();
});

Deno.test('usage fail-closed threshold is per organization: failures in different organizations do not accumulate', async () => {
  resetUsageFailureCounter();
  const a = insertOnlyClient({ fail: true });
  const b = insertOnlyClient({ fail: true });
  await insertUsageRow(orgDeps(a.supabase, 'org-a'), meteredFields);
  await insertUsageRow(orgDeps(a.supabase, 'org-a'), meteredFields);
  await insertUsageRow(orgDeps(b.supabase, 'org-b'), meteredFields);
  assertEquals(a.inserted.length, 2);
  assertEquals(b.inserted.length, 1);
  resetUsageFailureCounter();
});

Deno.test('usage fail-closed counter resets for an organization after its own insert succeeds', async () => {
  resetUsageFailureCounter();
  const mode = { fail: true };
  const { supabase } = insertOnlyClient(mode);
  const orgA = orgDeps(supabase, 'org-a');
  await insertUsageRow(orgA, meteredFields); // failure 1
  await insertUsageRow(orgA, meteredFields); // failure 2
  mode.fail = false;
  await insertUsageRow(orgA, meteredFields); // org-a's own success resets its count
  mode.fail = true;
  await insertUsageRow(orgA, meteredFields); // failure 1 again
  await insertUsageRow(orgA, meteredFields); // failure 2 again — must not throw
  resetUsageFailureCounter();
});

Deno.test('usage fail-closed state holds only organizations currently failing (bounded per isolate)', async () => {
  resetUsageFailureCounter();
  assertEquals(__usageFailureScopeCountForTests(), 0);
  const a = insertOnlyClient({ fail: true });
  const b = insertOnlyClient({ fail: true });
  await insertUsageRow(orgDeps(a.supabase, 'org-a'), meteredFields); // org-a failing
  await insertUsageRow(orgDeps(b.supabase, 'org-b'), meteredFields); // org-b failing
  assertEquals(__usageFailureScopeCountForTests(), 2);
  const ok = insertOnlyClient({ fail: false });
  await insertUsageRow(orgDeps(ok.supabase, 'org-a'), meteredFields); // success drops org-a's entry
  await insertUsageRow(orgDeps(ok.supabase, 'org-b'), meteredFields); // success drops org-b's entry
  assertEquals(__usageFailureScopeCountForTests(), 0);
  resetUsageFailureCounter();
  assertEquals(__usageFailureScopeCountForTests(), 0);
});
