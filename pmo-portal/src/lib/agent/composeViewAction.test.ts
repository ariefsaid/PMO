/**
 * Unit tests for composeViewAction and runComposeView.
 * AC-CV-004: runComposeView returns { error, code:REPAIR_EXHAUSTED } when composeSpec exhausts repair.
 * AC-CV-016: runComposeView returns { error, code:UPSTREAM_ERROR } when composeSpec throws upstream.
 *
 * Also covers deriveTitle (CV-OD-002, FR-CV-007 title derivation).
 *
 * All composeSpec calls are mocked via vi.mock (no live LLM calls in CI).
 */
import { it, expect, vi, describe } from 'vitest';
import { deriveTitle, runComposeView } from '../../../../supabase/functions/agent-chat/actions';
import type { ComposeActionDeps } from '../../../../supabase/functions/agent-chat/actions';
import type { DeputyContext } from '../agent/runtime/port';
import type { CompositionSpec } from '../viewspec/types';

// ── Mock composeSpec ──────────────────────────────────────────────────────────

vi.mock('../../../../supabase/functions/compose-view/composeSpec', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../supabase/functions/compose-view/composeSpec')>();
  return {
    ...actual,
    composeSpec: vi.fn(),
  };
});

import {
  composeSpec as mockComposeSpec,
  ComposeSpecError,
} from '../../../../supabase/functions/compose-view/composeSpec';

// ── Fixtures ──────────────────────────────────────────────────────────────────

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

const mockModelClient = {
  create: vi.fn(),
};

const mockCtx: DeputyContext = {
  jwt: 'test-jwt',
  userId: 'u-1',
  orgId: 'org-1',
  supabase: {} as DeputyContext['supabase'],
};

const mockDeps: ComposeActionDeps = {
  modelClient: mockModelClient,
  model: 'deepseek/deepseek-v4-flash',
};

// ── deriveTitle ───────────────────────────────────────────────────────────────

describe('deriveTitle', () => {
  it('capitalizes and truncates the prompt to <=60 chars', () => {
    expect(deriveTitle('show me active projects by status')).toBe(
      'Show me active projects by status',
    );

    const longPrompt = 'a'.repeat(90);
    const result = deriveTitle(longPrompt);
    expect(result.length).toBeLessThanOrEqual(60);
  });

  it('trims whitespace from the prompt before capitalizing', () => {
    expect(deriveTitle('  hello world  ')).toBe('Hello world');
  });

  it('handles empty string gracefully', () => {
    expect(deriveTitle('')).toBe('');
  });
});

// ── runComposeView ────────────────────────────────────────────────────────────

describe('runComposeView', () => {
  it('returns { spec, repairAttempts, tokensUsed, title } on success', async () => {
    vi.mocked(mockComposeSpec).mockResolvedValueOnce({
      spec: VALID_SPEC,
      repairAttempts: 0,
      tokensUsed: 42,
    });

    const result = await runComposeView(
      { prompt: 'show me active projects by status' },
      mockCtx,
      mockDeps,
    );

    expect(result).not.toHaveProperty('error');
    if (!('error' in result)) {
      expect(result.spec).toEqual(VALID_SPEC);
      expect(result.repairAttempts).toBe(0);
      expect(result.tokensUsed).toBe(42);
      expect(result.title).toBe(deriveTitle('show me active projects by status'));
    }
  });

  it('AC-CV-004 returns { error, code:REPAIR_EXHAUSTED } when composeSpec exhausts repair', async () => {
    vi.mocked(mockComposeSpec).mockRejectedValueOnce(
      new ComposeSpecError('REPAIR_EXHAUSTED', 2, 100, { code: 'UNKNOWN_ENTITY' }),
    );

    const result = await runComposeView({ prompt: 'x' }, mockCtx, mockDeps);

    expect(result).toHaveProperty('error');
    expect(result).toHaveProperty('code', 'REPAIR_EXHAUSTED');
    // Must not throw
  });

  it('AC-CV-016 returns { error, code:UPSTREAM_ERROR } when composeSpec throws upstream', async () => {
    vi.mocked(mockComposeSpec).mockRejectedValueOnce(
      new ComposeSpecError('UPSTREAM_ERROR', 0, 0),
    );

    const result = await runComposeView({ prompt: 'x' }, mockCtx, mockDeps);

    expect(result).toHaveProperty('error');
    expect(result).toHaveProperty('code', 'UPSTREAM_ERROR');
  });

  it('returns UPSTREAM_ERROR for non-ComposeSpecError exceptions too', async () => {
    vi.mocked(mockComposeSpec).mockRejectedValueOnce(new Error('unexpected'));

    const result = await runComposeView({ prompt: 'x' }, mockCtx, mockDeps);

    expect(result).toHaveProperty('error');
    expect(result).toHaveProperty('code', 'UPSTREAM_ERROR');
  });
});
