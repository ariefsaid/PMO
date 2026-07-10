import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the supabase.rpc seam — the run-stats DAL fns are thin RPC wrappers (privacy line:
// aggregates only, never a table read). Mirrors the chainable-mock discipline of the other
// DAL tests, but the surface here is just `supabase.rpc`.
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const rpc = vi.fn((_fn: string, _args?: unknown) => Promise.resolve(result.value));
  return { rpc, result };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { getOrgAgentRunStats, getOperatorAgentRunStats } from './usage';
import { AppError } from '@/src/lib/appError';

beforeEach(() => {
  h.rpc.mockClear();
  h.result.value = { data: null, error: null };
});

describe('AC-ACD-008 getOrgAgentRunStats', () => {
  it('calls the org_agent_run_stats RPC (no args) and returns its rows', async () => {
    const rows = [
      { action: 'chat', month: '2026-07-01', runs: 3, avg_rounds: 1.33, p50_cost: 0.1, p95_cost: 0.19, max_cost: 0.2, cache_hit_pct: 50, p50_ms: 500, p95_ms: 860 },
    ];
    h.result.value = { data: rows, error: null };
    await expect(getOrgAgentRunStats()).resolves.toEqual(rows);
    expect(h.rpc).toHaveBeenCalledWith('org_agent_run_stats');
  });

  it('returns [] when the RPC returns null data', async () => {
    h.result.value = { data: null, error: null };
    await expect(getOrgAgentRunStats()).resolves.toEqual([]);
  });

  it('throws AppError preserving the PG code on error', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(getOrgAgentRunStats()).rejects.toMatchObject({ message: 'denied', code: '42501' });
    await expect(getOrgAgentRunStats()).rejects.toBeInstanceOf(AppError);
  });
});

describe('AC-ACD-008 getOperatorAgentRunStats', () => {
  it('calls operator_agent_run_stats scoped to an org id when supplied', async () => {
    h.result.value = { data: [], error: null };
    await getOperatorAgentRunStats('org-1');
    expect(h.rpc).toHaveBeenCalledWith('operator_agent_run_stats', { p_org_id: 'org-1' });
  });

  it('passes p_org_id: undefined (all orgs) when the id is omitted or null', async () => {
    h.result.value = { data: [], error: null };
    await getOperatorAgentRunStats();
    expect(h.rpc).toHaveBeenCalledWith('operator_agent_run_stats', { p_org_id: undefined });
    h.rpc.mockClear();
    await getOperatorAgentRunStats(null);
    expect(h.rpc).toHaveBeenCalledWith('operator_agent_run_stats', { p_org_id: undefined });
  });

  it('returns [] when the RPC returns null data', async () => {
    h.result.value = { data: null, error: null };
    await expect(getOperatorAgentRunStats('org-1')).resolves.toEqual([]);
  });

  it('throws AppError preserving the PG code on error', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(getOperatorAgentRunStats('org-1')).rejects.toMatchObject({ message: 'denied', code: '42501' });
    await expect(getOperatorAgentRunStats('org-1')).rejects.toBeInstanceOf(AppError);
  });
});
