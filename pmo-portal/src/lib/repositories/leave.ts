/** repositories/leave.ts (#2708) — the seam over leave requests (ADR-0017). Errors keep their Postgres code via `wrap`. */
import * as leave from '@/src/lib/db/leave';
import { wrap } from './repositoryErrors';

export type { LeaveType, LeaveSettings, LeaveRequestRow, LeaveRequestInput, LeaveStatus } from '@/src/lib/db/leave';

export const leaveRepository = {
  settings: () => wrap(() => leave.getLeaveSettings()),
  setSettings: (s: leave.LeaveSettings) => wrap(() => leave.setLeaveSettings(s)),
  types: () => wrap(() => leave.listLeaveTypes()),
  createType: (name: string) => wrap(() => leave.createLeaveType(name)),
  archiveType: (id: string) => wrap(() => leave.archiveLeaveType(id)),
  visible: () => wrap(() => leave.listVisibleLeaveRequests()),
  submit: (input: leave.LeaveRequestInput) => wrap(() => leave.submitLeaveRequest(input)),
  decide: (id: string, decision: 'Approved' | 'Rejected', note: string | null) => wrap(() => leave.decideLeaveRequest(id, decision, note)),
  cancel: (id: string) => wrap(() => leave.cancelLeaveRequest(id)),
  onDate: (date: string) => wrap(() => leave.listLeaveOnDate(date)),
};
