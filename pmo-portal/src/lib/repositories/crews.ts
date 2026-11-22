/**
 * repositories/crews.ts (#2528) — the seam over crews, roster and daily attendance (ADR-0017). Standalone module
 * (same shape as `workOrderCosts.ts`): imported directly by its hooks. Errors keep their Postgres code via `wrap`.
 */
import * as crews from '@/src/lib/db/crews';
import * as attendance from '@/src/lib/db/attendance';
import * as attendanceRate from '@/src/lib/db/attendanceRate';
import * as crewLoans from '@/src/lib/db/crewLoans';
import { wrap } from './repositoryErrors';

export type {
  CrewRow, CrewStandardRoleRow, CrewWorkerRow, CrewMemberRow, WorkOrderCrewRow, RosterCrew, RosterMember, RosterRole,
  WorkOrderOption, CrewInput, StandardRoleInput, CrewWorkerInput, PlacementInput, RosterInput, CrewKind, CrewWorkerRef,
} from '@/src/lib/db/crews';
export type {
  AttendanceRowInput, AttendanceDayRow, AttendanceSource, AttendanceStatus, GenerateWeekResult, AwaitingWeekRow,
} from '@/src/lib/db/attendance';
export type { CrewAttendanceRateRow } from '@/src/lib/db/attendanceRate';
export type { CrewLoanRow, CrewLoanInput } from '@/src/lib/db/crewLoans';
export { STALE_VERSION_CODE } from '@/src/lib/db/crews';

export const crewRepository = {
  list: () => wrap(() => crews.listCrews()),
  create: (input: crews.CrewInput, roles: crews.StandardRoleInput[]) => wrap(() => crews.createCrew(input, roles)),
  update: (id: string, patch: Partial<crews.CrewInput> & { archived_at?: string | null }) => wrap(() => crews.updateCrew(id, patch)),
  roles: (crewId: string) => wrap(() => crews.listStandardRoles(crewId)),
  workers: () => wrap(() => crews.listCrewWorkers()),
  workerRefs: () => wrap(() => crews.listCrewWorkerRefs()),
  allRoles: () => wrap(() => crews.listAllStandardRoles()),
  allMembers: () => wrap(() => crews.listAllCrewMembers()),
  createWorker: (input: crews.CrewWorkerInput) => wrap(() => crews.createCrewWorker(input)),
  placeNewWorker: (person: crews.CrewWorkerInput, placement: Omit<crews.PlacementInput, 'worker_id'>) =>
    wrap(() => crews.placeNewCrewWorker(person, placement)),
  members: (crewId: string) => wrap(() => crews.listCrewMembers(crewId)),
  place: (input: crews.PlacementInput) => wrap(() => crews.placeCrewMember(input)),
  correctPlacement: (id: string, version: number, patch: Pick<crews.PlacementInput, 'valid_from' | 'valid_to' | 'standard_role_id'>) =>
    wrap(() => crews.correctCrewMember(id, version, patch)),
  workOrderCrews: (workOrderId: string) => wrap(() => crews.listWorkOrderCrews(workOrderId)),
  schedule: (crewId: string) => wrap(() => crews.listCrewSchedule(crewId)),
  roster: (input: crews.RosterInput) => wrap(() => crews.rosterCrew(input)),
  correctRoster: (id: string, version: number, patch: Pick<crews.RosterInput, 'valid_from' | 'valid_to'>) =>
    wrap(() => crews.correctRoster(id, version, patch)),
  rosterFor: (workOrderId: string, date: string) => wrap(() => crews.getWorkOrderRoster(workOrderId, date)),
  openWorkOrders: () => wrap(() => crews.listOpenWorkOrders()),
};

export const attendanceRepository = {
  record: (workOrderId: string, date: string, source: attendance.AttendanceSource, rows: attendance.AttendanceRowInput[]) =>
    wrap(() => attendance.recordAttendance(workOrderId, date, source, rows)),
  day: (workOrderId: string, date: string) => wrap(() => attendance.listAttendanceDay(workOrderId, date)),
  clearFollow: (workerId: string, date: string) => wrap(() => attendance.clearFollow(workerId, date)),
  generateWeek: (workerId: string, weekStart: string) => wrap(() => attendance.generateAttendanceWeek(workerId, weekStart)),
  decideWeek: (workerId: string, weekStart: string, decision: 'approve' | 'reject', reason: string | null) =>
    wrap(() => attendance.decideAttendanceWeek(workerId, weekStart, decision, reason)),
  awaiting: () => wrap(() => attendance.listAwaitingAttendance()),
  uploadPhoto: (input: Parameters<typeof attendance.uploadAttendancePhoto>[0]) => wrap(() => attendance.uploadAttendancePhoto(input)),
};

/**
 * #2706 — the organisation's attendance target and the per-crew rate against it. Reads and one setting write; the
 * counting and the role gate live in `attendance_rate_by_crew` (1437).
 */
export const attendanceRateRepository = {
  target: () => wrap(() => attendanceRate.getAttendanceTarget()),
  setTarget: (value: number | null) => wrap(() => attendanceRate.setAttendanceTarget(value)),
  byCrew: (from: string, to: string) => wrap(() => attendanceRate.listAttendanceRateByCrew(from, to)),
};

/** Crew loans (#2704) and the setting that shows them. */
export const crewLoanRepository = {
  enabled: () => wrap(() => crewLoans.getCrewLoansEnabled()),
  setEnabled: (enabled: boolean) => wrap(() => crewLoans.setCrewLoansEnabled(enabled)),
  list: () => wrap(() => crewLoans.listAllCrewLoans()),
  create: (input: crewLoans.CrewLoanInput) => wrap(() => crewLoans.createCrewLoan(input)),
  correct: (id: string, version: number, patch: Pick<crewLoans.CrewLoanInput, 'valid_from' | 'valid_to'>) =>
    wrap(() => crewLoans.correctCrewLoan(id, version, patch)),
};
