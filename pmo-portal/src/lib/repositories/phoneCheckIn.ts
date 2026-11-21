/**
 * repositories/phoneCheckIn.ts (#2705) — the seam over the phone check-in, its supervisor decisions and the work-order area (ADR-0017).
 * Standalone module: no existing repository gains a method.
 */
import * as db from '@/src/lib/db/phoneCheckIn';
import { wrap } from './repositoryErrors';

export type { CheckInArgs, CheckInResult, CheckInRequest, CheckInOutcome, WorkOrderArea } from '@/src/lib/db/phoneCheckIn';

export const phoneCheckInRepository = {
  checkIn: (a: db.CheckInArgs) => wrap(() => db.phoneCheckIn(a)),
  requests: () => wrap(() => db.listCheckInRequests()),
  decide: (id: string, approve: boolean, reason: string | null) => wrap(() => db.decideCheckIn(id, approve, reason)),
  area: (workOrderId: string) => wrap(() => db.getWorkOrderArea(workOrderId)),
  setArea: (workOrderId: string, area: db.WorkOrderArea | null) => wrap(() => db.setWorkOrderArea(workOrderId, area)),
  supervisorRole: () => wrap(() => db.getSupervisorRole()),
  setSupervisorRole: (role: string | null) => wrap(() => db.setSupervisorRole(role)),
};
