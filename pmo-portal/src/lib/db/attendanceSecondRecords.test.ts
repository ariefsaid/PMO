import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * pay-time — the DAL seam for second records of a worker's day (migrations 1700-1702). The rules (who may enter, who may
 * decide, the separation, the one figure) are the database's (pgTAP `supabase/tests/1700_attendance_second_record.test.sql`);
 * these pin what is sent and how the read is understood.
 */
const h = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const rpc = vi.fn((_name: string, _args: unknown) => Promise.resolve(queue.shift() ?? { data: null, error: null }));
  const select = vi.fn(() => Promise.resolve(queue.shift() ?? { data: null, error: null }));
  const from = vi.fn(() => ({ select: () => ({ limit: select }) }));
  return { rpc, from, queue };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: h.from } }));

import {
  decideSecondRecord, enterSecondRecords, getAttendanceTimeRoles, getReportDayHours, saveAttendanceTimeRoles, standingTotal,
} from './attendanceSecondRecords';

beforeEach(() => { h.rpc.mockClear(); h.queue.length = 0; });

describe('getReportDayHours', () => {
  it('reads the per-worker rows and the viewer flags', async () => {
    h.queue.push({ error: null, data: {
      detail: true, may_enter: true, may_decide: false,
      workers: [{
        worker_id: 'w1', name: 'One', day: { status: 'present', hours: 8, overtime_hours: 1, source: 'roster_tick' },
        second: { status: 'present', hours: 5, overtime_hours: null, note: 'sheet', standing: null, decided_at: null, decision_reason: null },
        undecided: true, mine: false,
      }, { worker_id: 'w2', name: 'Two', day: null, second: null, undecided: false, mine: false, own: true }],
    } });
    const r = await getReportDayHours('rep');
    expect(h.rpc).toHaveBeenCalledWith('attendance_report_day_hours', { p_report: 'rep' });
    expect(r.mayEnter).toBe(true);
    expect(r.mayDecide).toBe(false);
    expect(r.workers[0]).toMatchObject({ workerId: 'w1', undecided: true, day: { hours: 8, overtimeHours: 1, source: 'roster_tick' }, second: { hours: 5, note: 'sheet' } });
    expect(r.workers[1]).toMatchObject({ day: null, second: null, own: true });
    expect(r.workers[0].own).toBe(false);
  });
  it('a role without detail gets no rows', async () => {
    h.queue.push({ error: null, data: { detail: false, may_enter: false, may_decide: false, workers: [] } });
    expect(await getReportDayHours('rep')).toEqual({ detail: false, mayEnter: false, mayDecide: false, workers: [] });
  });
  it('keeps the database refusal code', async () => {
    h.queue.push({ error: { message: 'report not found', code: 'P0002' }, data: null });
    await expect(getReportDayHours('rep')).rejects.toMatchObject({ code: 'P0002' });
  });
});

describe('writes', () => {
  it('enters second records without any org id', async () => {
    h.queue.push({ error: null, data: 1 });
    await enterSecondRecords('wo', '2026-11-03', [{ worker_id: 'w1', status: 'present', hours: 5 }]);
    expect(h.rpc).toHaveBeenCalledWith('attendance_second_record', {
      p_work_order_id: 'wo', p_work_date: '2026-11-03', p_rows: [{ worker_id: 'w1', status: 'present', hours: 5 }],
    });
  });
  it('decides with the chosen side and the reason', async () => {
    h.queue.push({ error: null, data: null });
    await decideSecondRecord({ workerId: 'w1', workOrderId: 'wo', workDate: '2026-11-03', stand: 'second', reason: ' signed ' });
    expect(h.rpc).toHaveBeenCalledWith('attendance_second_record_decide', {
      p_worker_id: 'w1', p_work_order_id: 'wo', p_work_date: '2026-11-03', p_stand: 'second', p_reason: 'signed',
    });
  });
  it('surfaces a refusal with its code', async () => {
    h.queue.push({ error: { message: 'ATT_DECIDE_SAME_PERSON: x', code: '42501' }, data: null });
    await expect(decideSecondRecord({ workerId: 'w', workOrderId: 'o', workDate: 'd', stand: 'day', reason: 'r' })).rejects.toMatchObject({ code: '42501' });
  });
});

describe('time roles setting', () => {
  it('reads both lists', async () => {
    h.queue.push({ error: null, data: [{ attendance_second_record_roles: ['quantity_surveyor'], attendance_decider_roles: [] }] });
    expect(await getAttendanceTimeRoles()).toEqual({ secondRecordRoles: ['quantity_surveyor'], deciderRoles: [] });
  });
  it('saves through the Admin RPC', async () => {
    h.queue.push({ error: null, data: null });
    await saveAttendanceTimeRoles({ secondRecordRoles: ['a'], deciderRoles: ['b'] });
    expect(h.rpc).toHaveBeenCalledWith('set_attendance_time_roles', { p_second_record_roles: ['a'], p_decider_roles: ['b'] });
  });
});

describe('standingTotal', () => {
  it('adds overtime and counts an absence as nothing', () => {
    expect(standingTotal({ status: 'present', hours: 8, overtimeHours: 2 })).toBe(10);
    expect(standingTotal({ status: 'absent', hours: null, overtimeHours: null })).toBe(0);
    expect(standingTotal(null)).toBe(0);
  });
});
