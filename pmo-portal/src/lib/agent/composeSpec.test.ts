/**
 * Unit tests for composeSpec — the extracted compose+repair loop.
 * AC-CV-005 (adjacent): the extracted composeSpec matches the behavior the handler used inline.
 *
 * All Anthropic SDK calls are mocked via injected deps.
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

/** Build a mock AnthropicLike that returns the given spec on every call. */
function mockAnthropicReturning(spec: CompositionSpec): ComposeSpecDeps['anthropic'] {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'tool_use', name: 'compose_view', input: spec }],
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    },
  };
}

/** Build a mock that returns specSequence[i] on the i-th call. */
function mockAnthropicSequence(items: (CompositionSpec | 'throw')[]) {
  let callCount = 0;
  const create = vi.fn().mockImplementation(() => {
    const idx = callCount++;
    const item = items[idx];
    if (item === 'throw') {
      return Promise.reject(new Error('SECRET upstream error'));
    }
    return Promise.resolve({
      content: [{ type: 'tool_use', name: 'compose_view', input: item }],
      usage: { input_tokens: 10, output_tokens: 20 },
    });
  });
  return { messages: { create }, _create: create };
}

const BASE_DEPS = (anthropic: ComposeSpecDeps['anthropic']): ComposeSpecDeps => ({
  anthropic,
  userId: 'u-1',
});

// ── Tests ─────────────────────────────────────────────────────────────────────

it('composeSpec returns { spec, repairAttempts:0, tokensUsed } on a first-try valid spec', async () => {
  const anthropic = mockAnthropicReturning(VALID_SPEC);
  const result = await composeSpec('show projects', 'org-1', BASE_DEPS(anthropic));

  expect(result.spec).toEqual(VALID_SPEC);
  expect(result.repairAttempts).toBe(0);
  expect(result.tokensUsed).toBeGreaterThanOrEqual(0);
  expect((anthropic.messages.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
});

it('composeSpec repairs once then succeeds (repairAttempts:1)', async () => {
  const { messages, _create } = mockAnthropicSequence([INVALID_SPEC, VALID_SPEC]);
  const result = await composeSpec('show projects', 'org-1', BASE_DEPS({ messages }));

  expect(result.repairAttempts).toBe(1);
  expect(result.spec).toEqual(VALID_SPEC);
  expect(_create).toHaveBeenCalledTimes(2);
});

it('composeSpec throws ComposeSpecError REPAIR_EXHAUSTED after MAX_REPAIR_ATTEMPTS', async () => {
  // Always invalid — causes MAX_REPAIR_ATTEMPTS + 1 calls (initial + repairs)
  const { messages, _create } = mockAnthropicSequence(
    Array(MAX_REPAIR_ATTEMPTS + 1).fill(INVALID_SPEC),
  );

  await expect(
    composeSpec('show projects', 'org-1', BASE_DEPS({ messages })),
  ).rejects.toSatisfy((e: unknown) => {
    expect(e).toBeInstanceOf(ComposeSpecError);
    const err = e as ComposeSpecError;
    expect(err.code).toBe('REPAIR_EXHAUSTED');
    expect(err.repairAttempts).toBe(MAX_REPAIR_ATTEMPTS);
    return true;
  });

  expect(_create).toHaveBeenCalledTimes(MAX_REPAIR_ATTEMPTS + 1);
});

it('composeSpec throws ComposeSpecError UPSTREAM_ERROR when the SDK throws', async () => {
  const { messages } = mockAnthropicSequence(['throw']);

  await expect(
    composeSpec('show projects', 'org-1', BASE_DEPS({ messages })),
  ).rejects.toSatisfy((e: unknown) => {
    expect(e).toBeInstanceOf(ComposeSpecError);
    const err = e as ComposeSpecError;
    expect(err.code).toBe('UPSTREAM_ERROR');
    return true;
  });
});
