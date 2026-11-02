/**
 * Unit tests for composeSpec — the extracted compose+repair loop.
 * AC-CV-005 (adjacent): the extracted composeSpec matches the behavior the handler used inline.
 *
 * All ModelClient calls are mocked via injected deps (OpenRouter/OpenAI shape —
 * docs/specs/agent-model-client.spec.md).
 * Uses the REAL compileCompositionSpec (trusted boundary, ADR-0039 decision 3).
 * No live LLM calls in CI (ADR-0039 decision 7).
 */
import { it, expect, vi } from 'vitest';
import {
  composeSpec,
  ComposeSpecError,
  MAX_REPAIR_ATTEMPTS,
} from '../../../../supabase/functions/compose-view/composeSpec';
import type { ComposeSpecDeps } from '../../../../supabase/functions/compose-view/composeSpec';
import type { CompositionSpec } from '../viewspec/types';

// ── Valid spec fixture ─────────────────────────────────────────────────────────

/** A single KPITile panel on projects — passes compileCompositionSpec. */
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

/** Invalid spec: unknown entity → UNKNOWN_ENTITY from compileCompositionSpec. */
const INVALID_SPEC: CompositionSpec = {
  version: 1,
  panels: [
    {
      id: 'p2',
      primitive: 'KPITile',
      querySpec: {
        entity: 'secret_salaries' as never,
        select: ['id'],
      },
    },
  ],
};

// ── Mock helpers ──────────────────────────────────────────────────────────────

/** Build a mock ModelClient that returns the given spec on every call. */
function mockModelClientReturning(spec: CompositionSpec): ComposeSpecDeps['modelClient'] {
  return {
    create: vi.fn().mockResolvedValue({
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'compose_view', arguments: JSON.stringify(spec) } }],
      },
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      model: 'deepseek/deepseek-v4-flash',
    }),
  };
}

/** Build a mock that returns specSequence[i] on the i-th call. */
function mockModelClientSequence(items: (CompositionSpec | 'throw')[]) {
  let callCount = 0;
  const create = vi.fn().mockImplementation(() => {
    const idx = callCount++;
    const item = items[idx];
    if (item === 'throw') {
      return Promise.reject(new Error('SECRET upstream error'));
    }
    return Promise.resolve({
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: `c${idx}`, type: 'function', function: { name: 'compose_view', arguments: JSON.stringify(item) } }],
      },
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      model: 'deepseek/deepseek-v4-flash',
    });
  });
  return { create, _create: create };
}

const BASE_DEPS = (modelClient: ComposeSpecDeps['modelClient']): ComposeSpecDeps => ({
  modelClient,
  userId: 'u-1',
  model: 'deepseek/deepseek-v4-flash',
});

// ── Tests ─────────────────────────────────────────────────────────────────────

it('AC-MC-013 composeSpec returns { spec, repairAttempts:0, tokensUsed } on a first-try valid spec (parity with AC-AS-001)', async () => {
  const modelClient = mockModelClientReturning(VALID_SPEC);
  const result = await composeSpec('show projects', 'org-1', BASE_DEPS(modelClient));

  expect(result.spec).toEqual(VALID_SPEC);
  expect(result.repairAttempts).toBe(0);
  expect(result.tokensUsed).toBeGreaterThanOrEqual(0);
  expect((modelClient.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  const callArgs = (modelClient.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
  expect(callArgs.tool_choice).toEqual({ type: 'function', function: { name: 'compose_view' } });
});

it('AC-MC-014 composeSpec repairs once then succeeds (repairAttempts:1) (parity with AC-AS-002)', async () => {
  const { create, _create } = mockModelClientSequence([INVALID_SPEC, VALID_SPEC]);
  const result = await composeSpec('show projects', 'org-1', BASE_DEPS({ create }));

  expect(result.repairAttempts).toBe(1);
  expect(result.spec).toEqual(VALID_SPEC);
  expect(_create).toHaveBeenCalledTimes(2);
  const secondCallArgs = _create.mock.calls[1][0];
  const userTurn = secondCallArgs.messages.find((m: { role: string }) => m.role === 'user' && secondCallArgs.messages.indexOf(m) > 0);
  expect(userTurn).toBeDefined();
});

it('AC-MC-015 composeSpec throws ComposeSpecError REPAIR_EXHAUSTED after MAX_REPAIR_ATTEMPTS (parity with AC-AS-003)', async () => {
  // Always invalid — causes MAX_REPAIR_ATTEMPTS + 1 calls (initial + repairs)
  const { create, _create } = mockModelClientSequence(
    Array(MAX_REPAIR_ATTEMPTS + 1).fill(INVALID_SPEC),
  );

  await expect(
    composeSpec('show projects', 'org-1', BASE_DEPS({ create })),
  ).rejects.toSatisfy((e: unknown) => {
    expect(e).toBeInstanceOf(ComposeSpecError);
    const err = e as ComposeSpecError;
    expect(err.code).toBe('REPAIR_EXHAUSTED');
    expect(err.repairAttempts).toBe(MAX_REPAIR_ATTEMPTS);
    return true;
  });

  expect(_create).toHaveBeenCalledTimes(MAX_REPAIR_ATTEMPTS + 1);
});

it('AC-MC-016 composeSpec throws ComposeSpecError UPSTREAM_ERROR when the model call throws (parity with AC-AS-007)', async () => {
  const { create } = mockModelClientSequence(['throw']);

  await expect(
    composeSpec('show projects', 'org-1', BASE_DEPS({ create })),
  ).rejects.toSatisfy((e: unknown) => {
    expect(e).toBeInstanceOf(ComposeSpecError);
    const err = e as ComposeSpecError;
    expect(err.code).toBe('UPSTREAM_ERROR');
    return true;
  });
});

// ── T-10 #1538 slice 2: repair history + failed-call cost preservation ──────

/** Sequence mock whose every non-throwing response reports the given provider usage. */
function mockSequenceWithUsage(
  items: (CompositionSpec | 'throw')[],
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; total_cost: number },
) {
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
      usage,
      model: 'deepseek/deepseek-v4-flash',
    });
  });
  return { create, _create: create };
}

type RepairHistoryMessage = {
  role: string;
  content: string | null;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
};

it('the follow-up repair call shows the model its own failed compose_view tool call plus the validation error as the tool result', async () => {
  const { create, _create } = mockSequenceWithUsage(
    [INVALID_SPEC, VALID_SPEC],
    { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, total_cost: 0.25 },
  );

  const result = await composeSpec('show projects', 'org-1', BASE_DEPS({ create }));
  expect(result.repairAttempts).toBe(1);

  const secondMessages = _create.mock.calls[1][0].messages as RepairHistoryMessage[];
  // The model's own invalid tool call is echoed back verbatim…
  const echoIdx = secondMessages.findIndex(
    (m) => m.role === 'assistant' && m.tool_calls?.some((tc) => tc.function.name === 'compose_view'),
  );
  expect(echoIdx).toBeGreaterThan(0);
  expect(secondMessages[echoIdx].tool_calls?.[0]?.id).toBe('c0');
  expect(secondMessages[echoIdx].tool_calls?.[0]?.function.arguments).toBe(JSON.stringify(INVALID_SPEC));
  // …and the validation error rides the matching tool-result turn.
  const toolResult = secondMessages[echoIdx + 1];
  expect(toolResult.role).toBe('tool');
  expect(toolResult.tool_call_id).toBe('c0');
  expect(toolResult.content).toContain('UNKNOWN_ENTITY');
});

it('REPAIR_EXHAUSTED carries the accumulated provider cost alongside tokensUsed', async () => {
  const { create } = mockSequenceWithUsage(
    Array(MAX_REPAIR_ATTEMPTS + 1).fill(INVALID_SPEC),
    { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, total_cost: 0.25 },
  );

  await expect(
    composeSpec('show projects', 'org-1', BASE_DEPS({ create })),
  ).rejects.toSatisfy((e: unknown) => {
    expect(e).toBeInstanceOf(ComposeSpecError);
    const err = e as ComposeSpecError;
    expect(err.code).toBe('REPAIR_EXHAUSTED');
    expect(err.tokensUsed).toBe(30 * (MAX_REPAIR_ATTEMPTS + 1));
    expect(err.providerCost).toBeCloseTo(0.25 * (MAX_REPAIR_ATTEMPTS + 1), 10);
    return true;
  });
});

it('UPSTREAM_ERROR after a consumed repair attempt preserves the tokens and cost already spent', async () => {
  const { create } = mockSequenceWithUsage(
    [INVALID_SPEC, 'throw'],
    { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, total_cost: 0.4 },
  );

  await expect(
    composeSpec('show projects', 'org-1', BASE_DEPS({ create })),
  ).rejects.toSatisfy((e: unknown) => {
    expect(e).toBeInstanceOf(ComposeSpecError);
    const err = e as ComposeSpecError;
    expect(err.code).toBe('UPSTREAM_ERROR');
    expect(err.tokensUsed).toBe(30);
    expect(err.providerCost).toBeCloseTo(0.4, 10);
    return true;
  });
});
