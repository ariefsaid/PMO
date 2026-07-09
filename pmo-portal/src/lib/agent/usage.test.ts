/**
 * Tests for the agent-usage clamp + insert helpers (`_shared/usage.ts`).
 * AC-AUC-012/013/014: untrusted ModelResponse.usage values are clamped before
 * persistence (Number.isFinite(x) && x >= 0 ? x : 0), never thrown, never coerced.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  clampUsageValue,
  recordUsage,
  insertUsageRow,
  resetUsageFailureCounter,
  UsageMeteringUnavailableError,
} from '../../../../supabase/functions/_shared/usage';
import type { UsageDeps } from '../../../../supabase/functions/_shared/usage';
import type { ModelResponse } from '../../../../supabase/functions/_shared/modelClient';

it('AC-AUC-012 non-finite negative usage clamped to zero', () => {
  expect(clampUsageValue(NaN)).toBe(0);
  expect(clampUsageValue(-3)).toBe(0);
  expect(clampUsageValue(Infinity)).toBe(0);
  expect(clampUsageValue(-Infinity)).toBe(0);
});

it('AC-AUC-013 non-numeric usage clamped to zero no throw', () => {
  expect(clampUsageValue('5' as unknown as number)).toBe(0);
  expect(clampUsageValue(null as unknown as number)).toBe(0);
  expect(clampUsageValue(undefined as unknown as number)).toBe(0);
  expect(clampUsageValue({} as unknown as number)).toBe(0);
  expect(clampUsageValue([1, 2] as unknown as number)).toBe(0);
  expect(() => clampUsageValue('5' as unknown as number)).not.toThrow();
});

it('AC-AUC-014 valid usage passes through unchanged', () => {
  expect(clampUsageValue(120)).toBe(120);
  expect(clampUsageValue(45)).toBe(45);
  expect(clampUsageValue(0.0031)).toBe(0.0031);
  expect(clampUsageValue(0)).toBe(0);
});

// AUDIT-H5: the fail-closed counter is module state — reset it so failure tests don't bleed.
beforeEach(() => {
  resetUsageFailureCounter();
});

describe('recordUsage', () => {
  function mockUsageSupabase(insertSpy = vi.fn()) {
    const supabase = {
      from: vi.fn().mockImplementation(() => ({
        insert: (row: object) => {
          insertSpy(row);
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: 'usage-1' }, error: null }),
            }),
          };
        },
      })),
    } as unknown as UsageDeps['supabase'];
    return { supabase, insertSpy };
  }

  const resp: ModelResponse = {
    finish_reason: 'stop',
    message: { role: 'assistant', content: 'done' },
    model: 'deepseek/deepseek-v4-flash',
    usage: { prompt_tokens: NaN, completion_tokens: -3, total_tokens: 0, total_cost: Infinity },
  };

  it('AC-AUC-012 clamps a ModelResponse usage payload before insert', async () => {
    const { supabase, insertSpy } = mockUsageSupabase();
    await recordUsage({ supabase, runId: null }, resp);
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        run_id: null,
        model: 'deepseek/deepseek-v4-flash',
        prompt_tokens: 0,
        completion_tokens: 0,
        cost: 0,
      }),
    );
  });

  it('AC-AUC-013 non-numeric total_cost clamped to zero, no throw', async () => {
    const { supabase, insertSpy } = mockUsageSupabase();
    const badResp: ModelResponse = {
      ...resp,
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, total_cost: '5' as unknown as number },
    };
    await expect(recordUsage({ supabase, runId: 'run-1' }, badResp)).resolves.not.toThrow();
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ cost: 0 }));
  });

  it('AC-AUC-014 valid usage passes through unchanged into the insert payload', async () => {
    const { supabase, insertSpy } = mockUsageSupabase();
    const goodResp: ModelResponse = {
      ...resp,
      usage: { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165, total_cost: 0.0031 },
    };
    await recordUsage({ supabase, runId: 'run-2' }, goodResp);
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ run_id: 'run-2', prompt_tokens: 120, completion_tokens: 45, cost: 0.0031 }),
    );
  });

  it('carries cached_tokens + reasoning_tokens into the insert payload, clamped', async () => {
    const { supabase, insertSpy } = mockUsageSupabase();
    const cachedResp: ModelResponse = {
      ...resp,
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 200,
        total_tokens: 1200,
        total_cost: 0.01,
        cached_tokens: 768,
        reasoning_tokens: 64,
      },
    };
    await recordUsage({ supabase, runId: 'run-cache' }, cachedResp);
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ cached_tokens: 768, reasoning_tokens: 64 }),
    );
  });

  it('defaults cached_tokens + reasoning_tokens to 0 when the provider omits them', async () => {
    const { supabase, insertSpy } = mockUsageSupabase();
    const plainResp: ModelResponse = {
      ...resp,
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, total_cost: 0.001 },
    };
    await recordUsage({ supabase, runId: 'run-plain' }, plainResp);
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ cached_tokens: 0, reasoning_tokens: 0 }),
    );
  });

  it('recordUsage swallows an insert error without throwing', async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: null, error: { code: '23503' } }),
          }),
        }),
      }),
    } as unknown as UsageDeps['supabase'];
    await expect(recordUsage({ supabase, runId: null }, resp)).resolves.not.toThrow();
  });

  // Observability hardening (harden #1, spike 2026-07-04): the insert-failure log line must
  // carry a DISTINCT, greppable errorCode (USAGE_INSERT_FAILED) — never just a generic
  // free-text message — and never the row payload/secret values.
  describe('structured error codes', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('logs errorCode USAGE_INSERT_FAILED (code-only) when the insert returns an error', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const supabase = {
        from: vi.fn().mockReturnValue({
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: null, error: { code: '23503' } }),
            }),
          }),
        }),
      } as unknown as UsageDeps['supabase'];
      await recordUsage({ supabase, runId: null }, resp);
      expect(spy).toHaveBeenCalledTimes(1);
      const [, context] = spy.mock.calls[0] as [string, Record<string, unknown>];
      expect(context).toMatchObject({ errorCode: 'USAGE_INSERT_FAILED', code: '23503' });
    });

    it('logs a DIFFERENT errorCode (USAGE_INSERT_THREW) when the client throws', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const supabase = {
        from: vi.fn().mockImplementation(() => {
          throw new Error('connection reset');
        }),
      } as unknown as UsageDeps['supabase'];
      await expect(recordUsage({ supabase, runId: null }, resp)).resolves.not.toThrow();
      expect(spy).toHaveBeenCalledTimes(1);
      const [, context] = spy.mock.calls[0] as [string, Record<string, unknown>];
      expect(context).toMatchObject({ errorCode: 'USAGE_INSERT_THREW' });
      // Never the raw error message (which could carry connection-string/host details).
      expect(JSON.stringify(context)).not.toContain('connection reset');
    });
  });

  it('insertUsageRow accepts a flat fields object (compose-view call shape)', async () => {
    const { supabase, insertSpy } = mockUsageSupabase();
    await insertUsageRow(
      { supabase, runId: null },
      { model: 'deepseek/deepseek-v4-flash', prompt_tokens: 0, completion_tokens: 42, cost: 0 },
    );
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ run_id: null, model: 'deepseek/deepseek-v4-flash', prompt_tokens: 0, completion_tokens: 42, cost: 0 }),
    );
  });

  // AC-USE-002 (ops-admin-surface S5, FR-USE-001): provider_cost_usd + action are captured
  // alongside the existing cost/tokens fields, at the SAME choke point.
  it('AC-USE-002 insertUsageRow defaults provider_cost_usd to the clamped cost and action to "chat" when omitted', async () => {
    const { supabase, insertSpy } = mockUsageSupabase();
    await insertUsageRow(
      { supabase, runId: null },
      { model: 'deepseek/deepseek-v4-flash', prompt_tokens: 0, completion_tokens: 42, cost: 0.05 },
    );
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ provider_cost_usd: 0.05, action: 'chat' }),
    );
  });

  it('AC-USE-002 insertUsageRow accepts an explicit action + provider_cost_usd (clamped independently of cost)', async () => {
    const { supabase, insertSpy } = mockUsageSupabase();
    await insertUsageRow(
      { supabase, runId: null },
      { model: 'm', prompt_tokens: 1, completion_tokens: 1, cost: 0.02, provider_cost_usd: 0.09, action: 'automation' },
    );
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ provider_cost_usd: 0.09, action: 'automation', cost: 0.02 }),
    );
  });

  it('AC-USE-002 insertUsageRow clamps a non-finite explicit provider_cost_usd to 0', async () => {
    const { supabase, insertSpy } = mockUsageSupabase();
    await insertUsageRow(
      { supabase, runId: null },
      { model: 'm', prompt_tokens: 1, completion_tokens: 1, cost: 0.02, provider_cost_usd: NaN, action: 'compose' },
    );
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ provider_cost_usd: 0, action: 'compose' }));
  });

  it('AC-USE-002 recordUsage passes action through (call-sites resolve action literal) and defaults provider_cost_usd from usage.total_cost', async () => {
    const { supabase, insertSpy } = mockUsageSupabase();
    await recordUsage({ supabase, runId: 'run-3' }, resp, 'compose');
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'compose', provider_cost_usd: 0 }));
  });

  it('AC-USE-002 recordUsage defaults action to "chat" when the caller omits it', async () => {
    const { supabase, insertSpy } = mockUsageSupabase();
    await recordUsage({ supabase, runId: 'run-4' }, resp);
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'chat' }));
  });
});

// ── AUDIT-H5 (2026-07-04 audit): fail-closed after 3 consecutive usage-insert failures ──
describe('usage metering fail-closed', () => {
  function failingSupabase() {
    return {
      from: vi.fn().mockImplementation(() => ({
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: null, error: { code: '42501' } }),
          }),
        }),
      })),
    } as unknown as UsageDeps['supabase'];
  }
  function okSupabase() {
    return {
      from: vi.fn().mockImplementation(() => ({
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: { id: 'usage-1' }, error: null }),
          }),
        }),
      })),
    } as unknown as UsageDeps['supabase'];
  }
  const fields = { model: 'm', prompt_tokens: 1, completion_tokens: 1, cost: 0 };

  it('AUDIT-H5 swallows the first two consecutive failures, throws on the third', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = failingSupabase();
    await expect(insertUsageRow({ supabase, runId: null }, fields)).resolves.toBeUndefined();
    await expect(insertUsageRow({ supabase, runId: null }, fields)).resolves.toBeUndefined();
    await expect(insertUsageRow({ supabase, runId: null }, fields)).rejects.toBeInstanceOf(
      UsageMeteringUnavailableError,
    );
    consoleSpy.mockRestore();
  });

  it('AUDIT-H5 a successful insert resets the consecutive-failure counter', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = failingSupabase();
    await insertUsageRow({ supabase: failing, runId: null }, fields);
    await insertUsageRow({ supabase: failing, runId: null }, fields);
    // success resets…
    await insertUsageRow({ supabase: okSupabase(), runId: null }, fields);
    // …so two more failures are swallowed again (counter restarted, no throw).
    await expect(insertUsageRow({ supabase: failing, runId: null }, fields)).resolves.toBeUndefined();
    await expect(insertUsageRow({ supabase: failing, runId: null }, fields)).resolves.toBeUndefined();
    consoleSpy.mockRestore();
  });
});
