import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * #2706 — the target setting and the report read at the DAL seam (migrations 1436/1437).
 *
 * What these pin is the shape, because the shape is the safety property: the read asks for exactly the one column and
 * never sends `org_id`; the write targets the row the DATABASE said was readable, refuses an ambiguous org set, and
 * treats PostgREST's silent no-op as a refusal. The counting itself is the database's (pgTAP
 * `supabase/tests/attendance_rate.test.sql`).
 */
const h = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const calls = {
    from: [] as string[],
    select: [] as unknown[],
    limit: [] as unknown[],
    update: [] as unknown[],
    eq: [] as unknown[],
    rpc: [] as unknown[],
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: 'select' | 'limit' | 'update' | 'eq') => (...args: unknown[]) => {
    calls[name].push(args.length === 1 ? args[0] : args);
    return builder;
  };
  builder.select = chain('select');
  builder.limit = chain('limit');
  builder.update = chain('update');
  builder.eq = chain('eq');
  builder.then = (resolve: (v: unknown) => unknown) => resolve(queue.shift() ?? { data: null, error: null });
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });
  const rpc = vi.fn((name: string, args: unknown) => {
    calls.rpc.push([name, args]);
    return { then: (resolve: (v: unknown) => unknown) => resolve(queue.shift() ?? { data: null, error: null }) };
  });
  return { from, rpc, calls, queue };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import {
  attendanceTargetIssue, getAttendanceTarget, isBelowTarget, listAttendanceRateByCrew, setAttendanceTarget,
} from './attendanceRate';

beforeEach(() => {
  h.from.mockClear();
  h.rpc.mockClear();
  h.queue.length = 0;
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
    (h.calls[k] as unknown[]).length = 0;
  }
});

describe('getAttendanceTarget', () => {
  it('reads only organizations.attendance_target_rate, one row, and never sends org_id', async () => {
    h.queue.push({ data: [{ attendance_target_rate: 92.5 }], error: null });
    await expect(getAttendanceTarget()).resolves.toBe(92.5);
    expect(h.calls.from).toEqual(['organizations']);
    expect(h.calls.select).toEqual(['attendance_target_rate']);
    expect(h.calls.limit).toEqual([1]);
    expect(h.calls.eq).toEqual([]);
  });

  it('returns null when the organisation never set a target — off, not 0 %', async () => {
    h.queue.push({ data: [{ attendance_target_rate: null }], error: null });
    await expect(getAttendanceTarget()).resolves.toBeNull();
  });

  it('returns null when no organisation row is visible rather than inventing a target', async () => {
    h.queue.push({ data: [], error: null });
    await expect(getAttendanceTarget()).resolves.toBeNull();
  });

  it('throws on a read error instead of reporting a target nobody set', async () => {
    h.queue.push({ data: null, error: { message: 'rls denied' } });
    await expect(getAttendanceTarget()).rejects.toThrow('rls denied');
  });
});

describe('setAttendanceTarget', () => {
  it('writes the target to the organisation the database said was readable', async () => {
    h.queue.push({ data: [{ id: 'org-1' }], error: null });
    h.queue.push({ data: [{ id: 'org-1' }], error: null });
    await setAttendanceTarget(90);
    expect(h.calls.update).toEqual([{ attendance_target_rate: 90 }]);
    expect(h.calls.eq).toEqual([['id', 'org-1']]);
    expect(h.calls.select).toEqual(['id', 'id']);
  });

  it('clears the target with null', async () => {
    h.queue.push({ data: [{ id: 'org-1' }], error: null });
    h.queue.push({ data: [{ id: 'org-1' }], error: null });
    await setAttendanceTarget(null);
    expect(h.calls.update).toEqual([{ attendance_target_rate: null }]);
  });

  it('refuses a value outside 0–100 and a third decimal before touching the database', async () => {
    await expect(setAttendanceTarget(101)).rejects.toThrow('0 to 100');
    await expect(setAttendanceTarget(-1)).rejects.toThrow('0 to 100');
    await expect(setAttendanceTarget(90.005)).rejects.toThrow('two decimals');
    expect(h.from).not.toHaveBeenCalled();
  });

  it('refuses to guess when more than one organisation is readable', async () => {
    h.queue.push({ data: [{ id: 'org-1' }, { id: 'org-2' }], error: null });
    await expect(setAttendanceTarget(80)).rejects.toThrow('More than one organization');
    expect(h.calls.update).toEqual([]);
  });

  it('surfaces a filtered-out update as a refusal, not a silent no-op', async () => {
    h.queue.push({ data: [{ id: 'org-1' }], error: null });
    h.queue.push({ data: [], error: null });
    await expect(setAttendanceTarget(80)).rejects.toThrow('permission');
  });
});

describe('listAttendanceRateByCrew', () => {
  it('asks the database for the period and maps numeric strings and nulls', async () => {
    h.queue.push({
      data: [
        {
          crew_id: 'c1', crew_code: 'A-01', crew_name: 'Crew A', expected_days: 15, present_days: 9, absent_days: 2,
          leave_days: 1, off_rotation_days: 1, no_record_days: 2, countable_days: 13, rate: '69.23',
          target_rate: '75.50', meets_target: false,
        },
        {
          crew_id: 'c2', crew_code: 'A-02', crew_name: 'Crew B', expected_days: 0, present_days: 0, absent_days: 0,
          leave_days: 0, off_rotation_days: 0, no_record_days: 0, countable_days: 0, rate: null,
          target_rate: null, meets_target: null,
        },
      ],
      error: null,
    });
    const rows = await listAttendanceRateByCrew('2026-11-01', '2026-11-21');
    expect(h.calls.rpc).toEqual([['attendance_rate_by_crew', { p_from: '2026-11-01', p_to: '2026-11-21' }]]);
    expect(rows[0].rate).toBe(69.23);
    expect(rows[0].target_rate).toBe(75.5);
    expect(rows[0].countable_days).toBe(13);
    expect(rows[1].rate).toBeNull();
    expect(rows[1].meets_target).toBeNull();
  });

  it('throws the database refusal (the role gate) instead of returning an empty report', async () => {
    h.queue.push({ data: null, error: { message: 'not allowed', code: '42501' } });
    await expect(listAttendanceRateByCrew('2026-11-01', '2026-11-21')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('the shared rules', () => {
  it('accepts 0, 100 and two decimals; refuses a range or precision breach', () => {
    expect(attendanceTargetIssue(null)).toBeNull();
    expect(attendanceTargetIssue(0)).toBeNull();
    expect(attendanceTargetIssue(100)).toBeNull();
    expect(attendanceTargetIssue(92.25)).toBeNull();
    expect(attendanceTargetIssue(100.01)).toBe('range');
    expect(attendanceTargetIssue(Number.NaN)).toBe('range');
    expect(attendanceTargetIssue(92.255)).toBe('precision');
  });

  it('marks a crew below target only when it has a rate and a target', () => {
    expect(isBelowTarget({ rate: 69.23, meets_target: false })).toBe(true);
    expect(isBelowTarget({ rate: 69.23, meets_target: true })).toBe(false);
    expect(isBelowTarget({ rate: null, meets_target: null })).toBe(false);
    expect(isBelowTarget({ rate: 90, meets_target: null })).toBe(false);
  });
});
