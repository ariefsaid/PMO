/** repositories/stockWorkOrderTransfer.ts (#2691) — the seam over the work-order transfer (ADR-0017). */
import * as db from '@/src/lib/db/stockWorkOrderTransfer';
import { wrap } from './repositoryErrors';

export type { ReturnableLine, WoTransferInput, WoTransfer, WoTransferHalf } from '@/src/lib/db/stockWorkOrderTransfer';

export const stockWorkOrderTransferRepository = {
  enabled: () => wrap(() => db.getWoTransfersEnabled()),
  setEnabled: (on: boolean) => wrap(() => db.setWoTransfersEnabled(on)),
  returnable: (workOrderId: string) => wrap(() => db.getReturnable(workOrderId)),
  post: (i: db.WoTransferInput, requestId: string) => wrap(() => db.postWorkOrderTransfer(i, requestId)),
  get: (id: string) => wrap(() => db.getWorkOrderTransfer(id)),
};
