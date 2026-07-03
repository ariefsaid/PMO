/**
 * Tests for the agent-usage clamp + insert helpers (`_shared/usage.ts`).
 * AC-AUC-012/013/014: untrusted ModelResponse.usage values are clamped before
 * persistence (Number.isFinite(x) && x >= 0 ? x : 0), never thrown, never coerced.
 */
import { describe, it, expect, vi } from 'vitest';
import { clampUsageValue, recordUsage, insertUsageRow } from '../../../../supabase/functions/_shared/usage';
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
});
