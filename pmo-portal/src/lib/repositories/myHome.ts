/**
 * repositories/myHome.ts (#2710) — the seam over the light-account home screen and the seat report (ADR-0017). Standalone module:
 * existing repositories gain no method. Errors keep their code via `wrap`.
 */
import * as db from '@/src/lib/db/myHome';
import { wrap } from './repositoryErrors';

export type { MyHome, MyHomeTask, MyHomeWorkOrder, MyHomeIssue, MyDelivery, SeatReport, AbsenceReason, MyAbsence } from '@/src/lib/db/myHome';

export const myHomeRepository = {
  get: () => wrap(() => db.getMyHome()),
  setTaskStatus: (taskId: string, status: Parameters<typeof db.setMyTaskStatus>[1]) => wrap(() => db.setMyTaskStatus(taskId, status)),
  deliveries: () => wrap(() => db.getMyDeliveries()),
  reportAbsence: (reason: db.AbsenceReason, note: string) => wrap(() => db.reportAbsence(reason, note)),
  myAbsence: (workDate: string) => wrap(() => db.getMyAbsence(workDate)),
  seatReport: () => wrap(() => db.getSeatReport()),
};
