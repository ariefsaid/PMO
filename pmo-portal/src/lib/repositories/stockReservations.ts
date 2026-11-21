/** repositories/stockReservations.ts (#2693) — the seam over stock reservations and borrowing (ADR-0017). */
import * as db from '@/src/lib/db/stockReservations';
import { wrap } from './repositoryErrors';

export type { ReservationSettings, FreeReservedRow, ReservingWorkOrder, ReserveInput, RequestBorrowing, BorrowMode } from '@/src/lib/db/stockReservations';

export const stockReservationsRepository = {
  settings: () => wrap(() => db.getReservationSettings()),
  setSettings: (s: db.ReservationSettings) => wrap(() => db.setReservationSettings(s)),
  freeReserved: (warehouseId?: string, itemId?: string) => wrap(() => db.getFreeReserved(warehouseId, itemId)),
  reserve: (i: db.ReserveInput, requestId: string) => wrap(() => db.reserveStock(i, requestId)),
  release: (id: string, quantity: string | null, reason: string) => wrap(() => db.releaseReservation(id, quantity, reason)),
  forWorkOrder: (workOrderId: string) => wrap(() => db.listWorkOrderReservations(workOrderId)),
  requestBorrowing: (requestId: string) => wrap(() => db.getRequestBorrowing(requestId)),
};
