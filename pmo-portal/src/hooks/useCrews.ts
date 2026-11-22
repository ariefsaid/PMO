import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  attendanceRepository, crewRepository,
  type AttendanceRowInput, type CrewInput, type CrewWorkerInput, type PlacementInput, type RosterInput, type StandardRoleInput,
} from '@/src/lib/repositories/crews';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/**
 * Crews, roster and attendance (#2528) over the repository seam (ADR-0017). Keys carry org_id (tenant scope).
 * Every crew write invalidates every crew read; an attendance write also invalidates the timesheet reads, because
 * generating a week writes the person's timesheet.
 */
export const CREW_QUERY_ROOTS = ['crews', 'crew-roles', 'crew-workers', 'crew-members', 'work-order-crews', 'work-order-roster',
  'crew-work-orders'] as const;
export const ATTENDANCE_QUERY_ROOTS = ['attendance-day', 'attendance-awaiting'] as const;

function useInvalidate(roots: readonly string[]) {
  const qc = useQueryClient();
  return () => Promise.all(roots.map((r) => qc.invalidateQueries({ queryKey: [r] })));
}

export function useCrews() {
  return useOrgQuery(['crews'], () => crewRepository.list());
}

export function useCrewRoles(crewId: string | null) {
  return useOrgQuery(['crew-roles', crewId], () => crewRepository.roles(crewId as string), { enabled: Boolean(crewId) });
}

export function useCrewWorkers() {
  return useOrgQuery(['crew-workers'], () => crewRepository.workers());
}

export function useCrewMembers(crewId: string | null) {
  return useOrgQuery(['crew-members', crewId], () => crewRepository.members(crewId as string), { enabled: Boolean(crewId) });
}

export function useWorkOrderCrews(workOrderId: string | null) {
  return useOrgQuery(['work-order-crews', workOrderId], () => crewRepository.workOrderCrews(workOrderId as string), { enabled: Boolean(workOrderId) });
}

export function useWorkOrderRoster(workOrderId: string | null, date: string | null) {
  return useOrgQuery(['work-order-roster', workOrderId, date], () => crewRepository.rosterFor(workOrderId as string, date as string), { enabled: Boolean(workOrderId && date) });
}

export function useCrewWorkOrders() {
  return useOrgQuery(['crew-work-orders'], () => crewRepository.openWorkOrders(), { staleness: 'live' });
}

export function useCrewMutations() {
  const invalidate = useInvalidate([...CREW_QUERY_ROOTS, ...ATTENDANCE_QUERY_ROOTS]);
  const after = { onSuccess: () => { void invalidate(); } };
  return {
    createCrew: useMutation({ mutationFn: (v: { input: CrewInput; roles: StandardRoleInput[] }) => crewRepository.create(v.input, v.roles), ...after }),
    archiveCrew: useMutation({ mutationFn: (id: string) => crewRepository.update(id, { archived_at: new Date().toISOString() }), ...after }),
    createWorker: useMutation({ mutationFn: (input: CrewWorkerInput) => crewRepository.createWorker(input), ...after }),
    placeNewWorker: useMutation({ mutationFn: (v: { person: CrewWorkerInput; placement: Omit<PlacementInput, 'worker_id'> }) =>
      crewRepository.placeNewWorker(v.person, v.placement), ...after }),
    place: useMutation({ mutationFn: (input: PlacementInput) => crewRepository.place(input), ...after }),
    endPlacement: useMutation({
      mutationFn: (v: { id: string; version: number; valid_from: string; valid_to: string; standard_role_id: string | null }) =>
        crewRepository.correctPlacement(v.id, v.version, { valid_from: v.valid_from, valid_to: v.valid_to, standard_role_id: v.standard_role_id }),
      ...after,
    }),
    roster: useMutation({ mutationFn: (input: RosterInput) => crewRepository.roster(input), ...after }),
    endRoster: useMutation({
      mutationFn: (v: { id: string; version: number; valid_from: string; valid_to: string }) =>
        crewRepository.correctRoster(v.id, v.version, { valid_from: v.valid_from, valid_to: v.valid_to }),
      ...after,
    }),
  };
}

export function useAttendanceDay(workOrderId: string | null, date: string | null) {
  return useOrgQuery(['attendance-day', workOrderId, date], () => attendanceRepository.day(workOrderId as string, date as string), { enabled: Boolean(workOrderId && date) });
}

export function useAwaitingAttendance(enabled: boolean) {
  return useOrgQuery(['attendance-awaiting'], () => attendanceRepository.awaiting(), { enabled });
}

export function useAttendanceMutations() {
  const invalidate = useInvalidate([...ATTENDANCE_QUERY_ROOTS, 'timesheets', 'approvals']);
  const after = { onSuccess: () => { void invalidate(); } };
  return {
    record: useMutation({
      mutationFn: (v: { workOrderId: string; date: string; rows: AttendanceRowInput[] }) =>
        attendanceRepository.record(v.workOrderId, v.date, 'roster_tick', v.rows),
      ...after,
    }),
    uploadPhoto: useMutation({ mutationFn: attendanceRepository.uploadPhoto, ...after }),
    generateWeek: useMutation({ mutationFn: (v: { workerId: string; weekStart: string }) => attendanceRepository.generateWeek(v.workerId, v.weekStart), ...after }),
    decideWeek: useMutation({
      mutationFn: (v: { workerId: string; weekStart: string; decision: 'approve' | 'reject'; reason: string | null }) =>
        attendanceRepository.decideWeek(v.workerId, v.weekStart, v.decision, v.reason),
      ...after,
    }),
  };
}
