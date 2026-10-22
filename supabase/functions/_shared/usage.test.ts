import { assertEquals } from 'jsr:@std/assert@1';
import { recordTrustedUsage, resetUsageFailureCounter, UsageMeteringUnavailableError } from './usage.ts';

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
