import { describe, it, expect, vi, beforeEach } from 'vitest';

// A flexible chainable mock of the supabase query builder (mirrors agentEvents.test.ts's
// pattern — the reference DAL slice this file follows).
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = {
    from: [] as unknown[],
    select: [] as unknown[],
    eq: [] as unknown[],
    maybeSingle: [] as unknown[],
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...args: unknown[]) => {
    (calls[name] as unknown[]).push(args.length === 1 ? args[0] : args);
    return builder;
  };
  builder.select = chain('select');
  builder.eq = chain('eq');
  builder.maybeSingle = () => {
    calls.maybeSingle.push(true);
    return Promise.resolve(result.value);
  };
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });
  return { from, calls, result };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { getRunHeartbeat } from './agentRuns';
import { AppError } from '@/src/lib/appError';

beforeEach(() => {
  h.from.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
    (h.calls[k] as unknown[]).length = 0;
  }
  h.result.value = { data: null, error: null };
});

describe('AC-AGP-022 getRunHeartbeat', () => {
  it('selects last_progress_at/status from agent_runs scoped by id, never sends org_id/owner_id', async () => {
    h.result.value = {
      data: { last_progress_at: '2026-07-03T00:00:10Z', status: 'running' },
      error: null,
    };
    const row = await getRunHeartbeat('run-1');

    expect(h.calls.from).toEqual(['agent_runs']);
    expect(h.calls.eq).toContainEqual(['id', 'run-1']);
    expect(JSON.stringify(h.calls)).not.toContain('org_id');
    expect(JSON.stringify(h.calls)).not.toContain('owner_id');
    expect(row).toEqual({ last_progress_at: '2026-07-03T00:00:10Z', status: 'running' });
  });

  it('returns null when maybeSingle resolves 0 rows (row not found / RLS-hidden), no PGRST116 error path', async () => {
    // maybeSingle's 0-row contract: { data: null, error: null } — never a PGRST116 error,
    // and never a 406 (unlike .single()'s 0-row behavior).
    h.result.value = { data: null, error: null };
    await expect(getRunHeartbeat('run-missing')).resolves.toBeNull();
  });

  it('uses maybeSingle (not single) as the terminal builder call — avoids the 406-on-0-rows console spam', async () => {
    h.result.value = { data: null, error: null };
    await getRunHeartbeat('run-1');
    expect(h.calls.maybeSingle.length).toBe(1);
  });

  it('throws AppError preserving the PG code on a read error', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(getRunHeartbeat('run-1')).rejects.toMatchObject({ message: 'denied', code: '42501' });
    await expect(getRunHeartbeat('run-1')).rejects.toBeInstanceOf(AppError);
  });
});
