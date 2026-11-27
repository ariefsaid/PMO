import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@/src/lib/appError';

/**
 * #2528 — the crews, roster and attendance DAL. Writes never send org_id; a correction names the version it read;
 * the roster read and attendance commands go through their RPCs; a refusal keeps its Postgres code.
 */
const h = vi.hoisted(() => {
  const result = { value: {} as { data: unknown; error: unknown }, queue: [] as Array<{ data: unknown; error: unknown }> };
  const calls = {
    from: [] as string[], rpc: [] as Array<[string, unknown]>, select: [] as unknown[], insert: [] as unknown[], update: [] as unknown[],
    eq: [] as unknown[], neq: [] as unknown[], is: [] as unknown[], not: [] as unknown[], order: [] as unknown[], gt: [] as unknown[],
    limit: [] as unknown[], upload: [] as unknown[],
  };
  const next = () => (result.queue.length ? result.queue.shift()! : result.value);
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...a: unknown[]) => { (calls[name] as unknown[]).push(a.length === 1 ? a[0] : a); return builder; };
  for (const k of ['select', 'insert', 'update', 'eq', 'neq', 'is', 'not', 'order', 'gt', 'limit'] as const) builder[k] = chain(k);
  builder.single = () => Promise.resolve(next());
  builder.maybeSingle = () => Promise.resolve(next());
  builder.then = (resolve: (v: unknown) => unknown) => resolve(next());
  const from = vi.fn((t: string) => { calls.from.push(t); return builder; });
  const rpc = vi.fn((n: string, a?: unknown) => { calls.rpc.push([n, a]); return Promise.resolve(next()); });
  const storage = { from: vi.fn(() => ({ upload: (...a: unknown[]) => { calls.upload.push(a); return Promise.resolve({ error: null }); } })) };
  return { from, rpc, storage, calls, result };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc, storage: h.storage } }));

import * as crews from './crews';
import * as attendance from './attendance';
import { attendanceRepository, crewRepository } from '@/src/lib/repositories/crews';

beforeEach(() => {
  h.from.mockClear(); h.rpc.mockClear();
  for (const v of Object.values(h.calls)) (v as unknown[]).length = 0;
  h.result.value = { data: null, error: null };
  h.result.queue = [];
});

describe('#2528 crews DAL', () => {
  it('AC-CIM-010 import reads: worker refs carry the code, roles and placements span every crew, org_id is never filtered', async () => {
    h.result.value = { data: [{ id: 'w1', name: 'Sari', code: 'E-1' }], error: null };
    expect(await crews.listCrewWorkerRefs()).toEqual([{ id: 'w1', name: 'Sari', code: 'E-1' }]);
    h.result.value = { data: [{ id: 'r1', crew_id: 'c1', name: 'Welder' }], error: null };
    expect(await crews.listAllStandardRoles()).toEqual([{ id: 'r1', crew_id: 'c1', name: 'Welder' }]);
    h.result.value = { data: [{ id: 'm1', crew_id: 'c1', worker_id: 'w1', valid_from: '2026-01-01' }], error: null };
    expect(await crews.listAllCrewMembers()).toHaveLength(1);
    expect(h.calls.from).toEqual(['people_directory', 'crew_standard_roles', 'crew_members']);
    expect(JSON.stringify(h.calls.eq)).not.toContain('org_id');
  });

  it('AC-CRW-001 creates a crew and its standard roles atomically, never sending org_id', async () => {
    h.result.value = { data: { id: 'c1', code: 'CR-1' }, error: null };
    await crews.createCrew({ code: 'CR-1', name: 'Crew', kind: 'own', discipline_id: null, field_controller_id: 'u1', vendor_company_id: null },
      [{ name: 'Foreman', headcount: 1 }, { name: 'Welder', headcount: 3 }]);
    expect(h.calls.rpc).toEqual([['create_crew_with_roles', {
      p_crew: { code: 'CR-1', name: 'Crew', kind: 'own', discipline_id: null, field_controller_id: 'u1', vendor_company_id: null },
      p_roles: [{ name: 'Foreman', headcount: 1 }, { name: 'Welder', headcount: 3 }],
    }]]);
    expect(JSON.stringify(h.calls.rpc)).not.toContain('org_id');
  });

  it('AC-CRW-001 a duplicate code keeps its Postgres code', async () => {
    h.result.value = { data: null, error: { message: 'duplicate key', code: '23505' } };
    const err = await crewRepository.create({ code: 'CR-1', name: 'x', kind: 'own', discipline_id: null, field_controller_id: null, vendor_company_id: null }, [])
      .catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('23505');
  });

  it('uses the workforce register when choosing crew members', async () => {
    h.result.value = { data: [], error: null };
    await crews.listCrewWorkers();
    expect(h.calls.from).toEqual(['people_directory']);
  });

  it('OD-R1125-1 the managed-people read asks for the caller\'s live reports and returns their ids', async () => {
    h.result.value = { data: [{ id: 'p2' }, { id: 'p1' }], error: null };
    expect(await crews.listManagedPeopleIds('mgr-1')).toEqual(['p2', 'p1']);
    expect(h.calls.from).toEqual(['people']);
    expect(h.calls.eq).toEqual([['manager_id', 'mgr-1']]);
    expect(h.calls.is).toContainEqual(['archived_at', null]);
    expect(h.calls.order).toContainEqual(['id', { ascending: true }]);
    expect(JSON.stringify(h.calls.eq)).not.toContain('org_id');
  });

  it('OD-R1125-1 a manager of nobody gets an empty list', async () => {
    h.result.value = { data: [], error: null };
    expect(await crews.listManagedPeopleIds('mgr-1')).toEqual([]);
  });

  it('OD-R1125-1 the scan pages with the keyset cursor, so a capped first page loses nobody', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({ id: `p${String(i).padStart(4, '0')}` }));
    h.result.queue = [{ data: fullPage, error: null }, { data: [{ id: 'zzz' }], error: null }];
    const ids = await crews.listManagedPeopleIds('mgr-1');
    expect(ids).toHaveLength(1001);
    expect(ids[ids.length - 1]).toBe('zzz');
    expect(h.calls.gt).toContainEqual(['id', 'p0999']);
  });

  it('OD-R1125-1 a refused managed-people read is thrown, not swallowed, keeping its Postgres code', async () => {
    h.result.value = { data: null, error: { message: 'row-level security', code: '42501' } };
    await expect(crews.listManagedPeopleIds('mgr-1')).rejects.toMatchObject({ code: '42501' });
    const err = await crewRepository.managedPeople('mgr-1').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('42501');
  });

  it('OD-R1125-1 the repository exposes the managed-people read', async () => {
    h.result.value = { data: [{ id: 'p1' }, { id: 'p2' }], error: null };
    await expect(crewRepository.managedPeople('mgr-1')).resolves.toEqual(['p1', 'p2']);
    expect(h.calls.eq).toEqual([['manager_id', 'mgr-1']]);
  });

  it('lists live crews sorted by code', async () => {
    h.result.value = { data: [{ id: 'b', code: 'CR-2' }, { id: 'a', code: 'CR-1' }], error: null };
    expect((await crews.listCrews()).map((c) => c.code)).toEqual(['CR-1', 'CR-2']);
    expect(h.calls.is).toContainEqual(['archived_at', null]);
  });

  it('AC-CRW-002 a placement correction names the version it read; a stale one is refused', async () => {
    h.result.value = { data: [{ id: 'm1' }], error: null };
    await crews.correctCrewMember('m1', 3, { valid_from: '2026-11-01', valid_to: '2026-11-15', standard_role_id: null });
    expect(h.calls.eq).toEqual([['id', 'm1'], ['version', 3]]);
    h.result.value = { data: [], error: null };
    const err = await crews.correctCrewMember('m1', 3, { valid_from: '2026-11-01', valid_to: null, standard_role_id: null }).catch((e) => e);
    expect(err.code).toBe(crews.STALE_VERSION_CODE);
  });

  it('creates a new workforce person and placement in one request', async () => {
    h.result.value = { data: null, error: null };
    await crews.placeNewCrewWorker(
      { kind: 'vendor', display_name: 'New person', id_reference: null, profile_id: null, vendor_company_id: null },
      { crew_id: 'c', standard_role_id: null, valid_from: '2026-11-01', valid_to: null },
    );
    expect(h.calls.rpc).toEqual([['place_new_crew_worker', {
      p_person: { kind: 'vendor', name: 'New person', id_reference: null, profile_id: null, vendor_company_id: null },
      p_placement: { crew_id: 'c', standard_role_id: null, valid_from: '2026-11-01', valid_to: null },
    }]]);
  });

  it('AC-CRW-003 an overlapping roster keeps 23P01', async () => {
    h.result.value = { data: null, error: { message: 'conflicting key value violates exclusion constraint', code: '23P01' } };
    const err = await crews.rosterCrew({ work_order_id: 'w', crew_id: 'c', valid_from: '2026-11-05', valid_to: null }).catch((e) => e);
    expect(err.code).toBe('23P01');
    h.result.value = { data: [], error: null };
    await expect(crews.correctRoster('r1', 1, { valid_from: '2026-11-01', valid_to: '2026-11-02' })).rejects.toMatchObject({ code: crews.STALE_VERSION_CODE });
  });

  it('AC-CRW-004 reads the roster for a date through work_order_roster', async () => {
    h.result.value = { data: [{ crew_id: 'c1', crew_code: 'CR-1', crew_name: 'Crew', field_controller_id: null, members: null, roles: [], shortfall: '2' }], error: null };
    const roster = await crews.getWorkOrderRoster('w1', '2026-11-05');
    expect(h.calls.rpc).toEqual([['work_order_roster', { p_work_order_id: 'w1', p_date: '2026-11-05' }]]);
    expect(roster[0]).toMatchObject({ members: [], shortfall: 2 });
  });

  it('reads people, members, roles, roster placements and open work orders', async () => {
    h.result.value = { data: [{ id: 'x', display_name: 'B', valid_from: '2026-11-01', sort_order: 0, name: 'r', wo_number: null, title: 'T' }], error: null };
    await crews.listCrewWorkers();
    await crews.listCrewMembers('c1');
    await crews.listStandardRoles('c1');
    await crews.listWorkOrderCrews('w1');
    await crews.listOpenWorkOrders();
    expect(h.calls.from).toEqual(['people_directory', 'crew_members', 'crew_standard_roles', 'work_order_crews', 'work_orders']);
    expect(h.calls.neq).toEqual([['status', 'Cancelled']]);
    h.result.queue = [{ data: { id: 'p' }, error: null }, { data: null, error: null }, { data: [{ id: 'c' }], error: null }];
    await crews.createCrewWorker({ kind: 'vendor', display_name: 'V', id_reference: null, profile_id: null, vendor_company_id: null });
    await crews.placeCrewMember({ crew_id: 'c', worker_id: 'p', standard_role_id: null, valid_from: '2026-11-01', valid_to: null });
    h.result.value = { data: [{ id: 'c' }], error: null };
    await crews.updateCrew('c', { archived_at: '2026-11-19T00:00:00Z' });
  });
});

describe('#2528 attendance DAL', () => {
  it('AC-CRW-005 one call records the whole crew with its source', async () => {
    h.result.value = { data: 6, error: null };
    const rows = [{ worker_id: 'w1', status: 'present' as const, hours: 8 }];
    await expect(attendanceRepository.record('wo1', '2026-11-18', 'roster_tick', rows)).resolves.toBe(6);
    expect(h.calls.rpc).toEqual([['attendance_record', { p_work_order_id: 'wo1', p_work_date: '2026-11-18', p_source: 'roster_tick', p_rows: rows }]]);
  });

  it('AC-CRW-011 a locked day keeps 55000 so the screen can point to the correction path', async () => {
    h.result.value = { data: null, error: { message: 'ATT_LOCKED: approved attendance cannot be changed', code: '55000' } };
    await expect(attendance.recordAttendance('wo1', '2026-11-18', 'manual_correction', [])).rejects.toMatchObject({ code: '55000' });
  });

  it('AC-CRW-009 generates a week and AC-CRW-012 decides a no-login week through their RPCs', async () => {
    h.result.value = { data: { mode: 'timesheet', timesheet_id: 't1', changed: true }, error: null };
    await expect(attendance.generateAttendanceWeek('w1', '2026-11-16')).resolves.toEqual({ mode: 'timesheet', timesheet_id: 't1', changed: true });
    h.result.value = { data: 5, error: null };
    await expect(attendance.decideAttendanceWeek('w2', '2026-11-16', 'approve', null)).resolves.toBe(5);
    expect(h.calls.rpc).toEqual([
      ['attendance_generate_timesheet', { p_worker_id: 'w1', p_week_start: '2026-11-16' }],
      ['attendance_decide_week', { p_worker_id: 'w2', p_week_start: '2026-11-16', p_decision: 'approve', p_reason: undefined }],
    ]);
  });

  it('reads a day and the weeks awaiting approval', async () => {
    h.result.value = { data: [{ id: 'a2', worker_id: 'w2', work_date: '2026-11-17', hours: 8, overtime_hours: null },
      { id: 'a1', worker_id: 'w1', work_date: '2026-11-16', hours: 8, overtime_hours: 1 }], error: null };
    expect((await attendance.listAwaitingAttendance()).map((r) => r.work_date)).toEqual(['2026-11-16', '2026-11-17']);
    await attendance.listAttendanceDay('wo1', '2026-11-16');
    expect(h.calls.eq).toContainEqual(['work_date', '2026-11-16']);
  });

  it('AC-CRW-005 uploads the group photo under the work order\'s organisation, then records it', async () => {
    h.result.queue = [{ data: { org_id: 'org1' }, error: null }, { data: null, error: null }];
    const file = new File(['x'], 'crew photo.jpg', { type: 'image/jpeg' });
    await attendance.uploadAttendancePhoto({ photoId: 'p1', workOrderId: 'wo1', crewId: 'c1', workDate: '2026-11-18', file });
    expect(h.calls.upload[0]).toEqual(['org1/wo1/p1/crew_photo.jpg', file, { upsert: false, contentType: 'image/jpeg' }]);
    expect(h.calls.insert).toEqual([{ id: 'p1', work_order_id: 'wo1', crew_id: 'c1', work_date: '2026-11-18', file_path: 'org1/wo1/p1/crew_photo.jpg' }]);
  });
});

it("refuses a crew edit that did not land", async () => {
 h.result.value = { data: [], error: null };
 await expect(crews.updateCrew("c", { name: "Changed" })).rejects.toMatchObject({ code: "42501" });
});
