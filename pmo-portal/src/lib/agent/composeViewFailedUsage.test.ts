/**
 * compose-view records usage for model tokens consumed by FAILED compose attempts
 * (T-10 #1538 slice 2). A compose that dies in repair exhaustion or on an upstream error
 * after N successful model calls has still consumed provider tokens; those calls are
 * metered through the same single agent_usage choke point as a successful compose, with
 * the tokens/cost accumulated by composeSpec on the ComposeSpecError it throws.
 *
 * Boundary: the real shipped handler (compose-view/handler.ts) with the model client and
 * the usage service client mocked — the same pattern as handler.test.ts /
 * composeViewHandlerCredits.test.ts. No reservation double-count: the credit hold placed
 * by the rate guard is released in the handler's finally; the usage row written here IS
 * the spend record (release_credits only drops the hold).
 */
import { it, expect, vi } from 'vitest';
import { composeViewHandler } from '../../../../supabase/functions/compose-view/handler';
import type { HandlerDeps } from '../../../../supabase/functions/compose-view/handler';
import { MAX_REPAIR_ATTEMPTS } from '../../../../supabase/functions/compose-view/handler';
import type { ComposeViewRequest } from '../agent/types';
import type { CompositionSpec } from '../viewspec/types';

const VALID_SPEC: CompositionSpec = {
  version: 1,
  panels: [
    {
      id: 'p1',
      primitive: 'KPITile',
      querySpec: {
        entity: 'projects',
        select: ['id'],
        aggregate: { fn: 'count', column: 'id', alias: 'count' },
      },
    },
  ],
};

const INVALID_SPEC: CompositionSpec = {
  version: 1,
  panels: [
    {
      id: 'p2',
      primitive: 'KPITile',
      querySpec: { entity: 'secret_salaries' as never, select: ['id'] },
    },
  ],
};

const MODEL = 'deepseek/deepseek-v4-flash';
const USAGE = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, total_cost: 0.25 };

function mockModelClientSequence(items: (CompositionSpec | 'throw')[]) {
  let callCount = 0;
  const create = vi.fn().mockImplementation(() => {
    const idx = callCount++;
    const item = items[idx];
    if (item === 'throw') return Promise.reject(new Error('SECRET upstream error'));
    return Promise.resolve({
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: `c${idx}`, type: 'function', function: { name: 'compose_view', arguments: JSON.stringify(item) } }],
      },
      usage: { ...USAGE },
      model: MODEL,
    });
  });
  return { create };
}

/** Service-client fake capturing agent_usage inserts (recordTrustedUsage's two reads + insert). */
function mockServiceClient(opts: { profileError?: boolean } = {}) {
  const inserted: Array<Record<string, unknown>> = [];
  return {
    inserted,
    client: {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue(
                  opts.profileError
                    ? { data: null, error: { code: 'PGRST116' } }
                    : { data: { org_id: 'org-1' }, error: null },
                ),
              }),
            }),
          };
        }
        // agent_usage (and any other table): capture inserts.
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
          insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
            inserted.push(row);
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            };
          }),
        };
      }),
    },
  };
}

function baseDeps(overrides: Partial<HandlerDeps>): HandlerDeps {
  return {
    modelClient: mockModelClientSequence([VALID_SPEC]).create as never,
    model: MODEL,
    supabase: {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { org_id: 'org-1' }, error: null }),
          }),
        }),
      }),
    } as unknown as HandlerDeps['supabase'],
    userId: 'u-1',
    ...overrides,
  };
}

const REQ: ComposeViewRequest = { prompt: 'show projects', orgId: 'org-1' };

it('a repair-exhausted compose meters the tokens its failed attempts consumed', async () => {
  const svc = mockServiceClient();
  const modelClient = mockModelClientSequence(Array(MAX_REPAIR_ATTEMPTS + 1).fill(INVALID_SPEC));

  const result = await composeViewHandler(
    REQ,
    baseDeps({ modelClient: { create: modelClient.create }, usage: { serviceClient: svc.client } }),
  );

  expect(result.status).toBe(422);
  // Initial + MAX_REPAIR_ATTEMPTS repair calls all resolved and all consumed tokens.
  const calls = MAX_REPAIR_ATTEMPTS + 1;
  expect(modelClient.create).toHaveBeenCalledTimes(calls);
  expect(svc.inserted).toHaveLength(1);
  const row = svc.inserted[0];
  expect(row.owner_id).toBe('u-1');
  expect(row.org_id).toBe('org-1');
  expect(row.model).toBe(MODEL);
  expect(row.completion_tokens).toBe(USAGE.total_tokens * calls);
  expect(row.provider_cost_usd).toBeCloseTo(USAGE.total_cost * calls, 10);
  expect(row.action).toBe('compose');
  expect(row.run_id).toBeNull();
});

it('an upstream error after a consumed attempt meters the tokens spent before the failure', async () => {
  const svc = mockServiceClient();
  const modelClient = mockModelClientSequence([INVALID_SPEC, 'throw']);

  const result = await composeViewHandler(
    REQ,
    baseDeps({ modelClient: { create: modelClient.create }, usage: { serviceClient: svc.client } }),
  );

  expect(result.status).toBe(502);
  expect(modelClient.create).toHaveBeenCalledTimes(2);
  expect(svc.inserted).toHaveLength(1);
  const row = svc.inserted[0];
  expect(row.completion_tokens).toBe(USAGE.total_tokens);
  expect(row.provider_cost_usd).toBeCloseTo(USAGE.total_cost, 10);
  expect(row.action).toBe('compose');
});

it('an upstream error on the first call consumed nothing and writes no usage row', async () => {
  const svc = mockServiceClient();
  const modelClient = mockModelClientSequence(['throw']);

  const result = await composeViewHandler(
    REQ,
    baseDeps({ modelClient: { create: modelClient.create }, usage: { serviceClient: svc.client } }),
  );

  expect(result.status).toBe(502);
  expect(modelClient.create).toHaveBeenCalledTimes(1);
  expect(svc.inserted).toHaveLength(0);
});

it('a usage-recording failure on the error path never masks the compose error response', async () => {
  const svc = mockServiceClient({ profileError: true });
  const modelClient = mockModelClientSequence(Array(MAX_REPAIR_ATTEMPTS + 1).fill(INVALID_SPEC));

  const result = await composeViewHandler(
    REQ,
    baseDeps({ modelClient: { create: modelClient.create }, usage: { serviceClient: svc.client } }),
  );

  // Still the honest 422 — the metering failure is logged server-side, not thrown over the response.
  expect(result.status).toBe(422);
  expect(svc.inserted).toHaveLength(0);
});
