import { describe, it, expect, vi, beforeEach } from 'vitest';

// One chainable builder; every await on it resolves the queued result and records the select/limit it was built with.
const h = vi.hoisted(() => {
  const state = { rows: [] as Array<Record<string, unknown>>, error: null as unknown, selects: [] as string[], limits: [] as number[] };
  const builder: Record<string, unknown> = {};
  builder.select = (arg: string) => { state.selects.push(arg); return builder; };
  builder.limit = (n: number) => { state.limits.push(n); return builder; };
  builder.maybeSingle = async () => ({ data: state.rows[0] ?? null, error: state.error });
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: state.error ? null : state.rows, error: state.error });
  return { state, from: vi.fn(() => builder) };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { readOrgColumns, readOrgColumnsStrict } from './orgSettingsBatch';
import { getLeaveSettings } from './leave';
import { getClaimOverCap } from './claimOverCap';
import { getCrewLoansEnabled } from './crewLoans';
import { orgSwitchRepository } from '@/src/lib/repositories/orgSwitches';

beforeEach(() => {
  h.state.rows = []; h.state.error = null; h.state.selects.length = 0; h.state.limits.length = 0; h.from.mockClear();
});

describe('organisation setting reads in the same moment share one request', () => {
  it('merges the leave, claim-cap and crew-loan reads into ONE organizations request and each reader gets its own columns', async () => {
    h.state.rows = [{ leave_requests_enabled: true, leave_approver_role: 'Admin', claim_quantity_over_cap: 'block', crew_loans_enabled: true }];
    const [leave, cap, loans] = await Promise.all([getLeaveSettings(), getClaimOverCap(), getCrewLoansEnabled()]);
    expect(h.from).toHaveBeenCalledTimes(1);
    expect(h.state.selects).toHaveLength(1);
    expect(h.state.selects[0].split(',').map((c) => c.trim()).sort()).toEqual(
      ['claim_quantity_over_cap', 'crew_loans_enabled', 'leave_approver_role', 'leave_requests_enabled']);
    expect(leave).toEqual({ enabled: true, approver_role: 'Admin' });
    expect(cap).toBe('block');
    expect(loans).toBe(true);
  });

  it('merges the column-backed switches (module and switch) into one request', async () => {
    h.state.rows = [{ module_people_crews: false, clearance_checklist_enabled: true }];
    const [mod, sw] = await Promise.all([orgSwitchRepository.read('modulePeopleCrews'), orgSwitchRepository.read('clearance')]);
    expect(h.from).toHaveBeenCalledTimes(1);
    expect([mod, sw]).toEqual([false, true]);
  });

  it('reads asked for in different moments are separate requests (nothing is cached past the batch)', async () => {
    h.state.rows = [{ crew_loans_enabled: false }];
    await getCrewLoansEnabled();
    await getCrewLoansEnabled();
    expect(h.from).toHaveBeenCalledTimes(2);
  });

  it('a read error reaches every reader of the batch', async () => {
    h.state.error = { message: 'boom', code: 'XX000' };
    const results = await Promise.all([readOrgColumns(['a']), readOrgColumns(['b'])]);
    expect(results.map((r) => r.error?.code)).toEqual(['XX000', 'XX000']);
    expect(h.from).toHaveBeenCalledTimes(3); // the shared read, then each reader's own read
  });

  it('keeps single-row semantics: the strict reader refuses two visible organisations, the first-row reader takes the first', async () => {
    h.state.rows = [{ x: 1 }, { x: 2 }];
    await expect(readOrgColumnsStrict(['x'])).resolves.toMatchObject({ data: null, error: { code: 'PGRST116' } });
    await expect(readOrgColumns(['x'])).resolves.toEqual({ data: { x: 1 }, error: null });
  });

  it('a failed shared read falls back to each reader\'s own read, so one bad column does not break the others', async () => {
    h.from.mockImplementationOnce(() => { throw new TypeError('shared read unavailable'); });
    h.state.rows = [{ crew_loans_enabled: true, claim_quantity_over_cap: 'block' }];
    const [loans, cap] = await Promise.all([getCrewLoansEnabled(), getClaimOverCap()]);
    expect([loans, cap]).toEqual([true, 'block']);
    expect(h.from).toHaveBeenCalledTimes(3);
    expect(h.state.selects.slice(-2).sort()).toEqual(['claim_quantity_over_cap', 'crew_loans_enabled']);
  });

  it('a shared read that throws never leaves an unhandled rejection', async () => {
    const seen: unknown[] = [];
    const onRejection = (e: unknown) => seen.push(e);
    process.on('unhandledRejection', onRejection);
    h.from.mockImplementationOnce(() => { throw new Error('nope'); });
    h.state.rows = [{ x: 1 }];
    await expect(readOrgColumns(['x'])).resolves.toEqual({ data: { x: 1 }, error: null });
    await new Promise((r) => setTimeout(r, 10));
    process.off('unhandledRejection', onRejection);
    expect(seen).toEqual([]);
  });

  it('asks for one row, or two only when a reader must refuse a second visible organisation', async () => {
    h.state.rows = [{ crew_loans_enabled: true }];
    await getCrewLoansEnabled();
    expect(h.state.limits).toEqual([1]);
    h.state.limits.length = 0;
    await getClaimOverCap();
    expect(h.state.limits).toEqual([2]);
  });

  it('a lone reader gets a database error back as its own error, with no second request', async () => {
    h.state.error = { message: 'denied', code: '42501' };
    await expect(getCrewLoansEnabled()).rejects.toMatchObject({ code: '42501' });
    expect(h.from).toHaveBeenCalledTimes(1);
  });

  it('no organisation visible reads as no row', async () => {
    h.state.rows = [];
    await expect(readOrgColumns(['x'])).resolves.toEqual({ data: null, error: null });
    await expect(readOrgColumnsStrict(['x'])).resolves.toEqual({ data: null, error: null });
  });
});
