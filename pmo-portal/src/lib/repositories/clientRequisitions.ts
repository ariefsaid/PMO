/**
 * repositories/clientRequisitions.ts (#2585) — the seam over client material requisitions (ADR-0017). Standalone module
 * (the `materialRequests.ts` shape): imported directly by its consumers. Every rule is enforced by the database RPCs;
 * errors keep their Postgres code via `wrap`.
 */
import * as dal from '@/src/lib/db/clientRequisitions';
import { wrap } from './repositoryErrors';

export type {
  ClientRequisitionStatus, ClientRequisitionRow, ClientRequisitionLineInput, ClientRequisitionPickup, ClientRequisitionEvent,
  ClientRequisitionLineRow, WorkOrderClientMaterial,
} from '@/src/lib/db/clientRequisitions';

export const clientRequisitionRepository = {
  forWorkOrder: (workOrderId: string) => wrap(() => dal.getWorkOrderClientMaterial(workOrderId)),
  create: (header: { workOrderId: string; clientReference?: string | null }, lines: dal.ClientRequisitionLineInput[], clientRequestId?: string) =>
    wrap(() => dal.createClientRequisition(header, lines, clientRequestId)),
  updateDraft: (id: string, header: { clientReference?: string | null }, lines: dal.ClientRequisitionLineInput[]) =>
    wrap(() => dal.updateClientRequisitionDraft(id, header, lines)),
  send: (id: string, clientRequestId?: string) => wrap(() => dal.sendClientRequisition(id, clientRequestId)),
  cancel: (id: string, reason?: string | null) => wrap(() => dal.cancelClientRequisition(id, reason)),
  recordReservation: (lineId: string, input: Parameters<typeof dal.recordClientReservation>[1], clientRequestId?: string) =>
    wrap(() => dal.recordClientReservation(lineId, input, clientRequestId)),
  recordRelease: (lineId: string, input: { quantity: string; reason: string }, clientRequestId?: string) =>
    wrap(() => dal.recordClientRelease(lineId, input, clientRequestId)),
  recordPickup: (lineId: string, input: Parameters<typeof dal.recordClientPickup>[1], clientRequestId?: string) =>
    wrap(() => dal.recordClientPickup(lineId, input, clientRequestId)),
  attachPickupSlip: (pickupId: string, file: File) => wrap(() => dal.attachClientPickupSlip(pickupId, file)),
};
