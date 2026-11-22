/**
 * repositories/myHome.ts (#2710) — the seam over the light-account home screen and the seat report (ADR-0017). Standalone module:
 * existing repositories gain no method. Errors keep their code via `wrap`.
 */
import * as db from '@/src/lib/db/myHome';
import { wrap } from './repositoryErrors';

export type { MyHome, MyHomeCheckIn, MyHomeTask, MyHomeWorkOrder, MyHomeIssue, MyDelivery, SeatReport } from '@/src/lib/db/myHome';

export const myHomeRepository = {
  get: () => wrap(() => db.getMyHome()),
  setTaskStatus: (taskId: string, status: Parameters<typeof db.setMyTaskStatus>[1]) => wrap(() => db.setMyTaskStatus(taskId, status)),
  deliveries: () => wrap(() => db.getMyDeliveries()),
  seatReport: () => wrap(() => db.getSeatReport()),
};
