import type {
  AttributeSubcontractBillLineInput,
  CaptureSubcontractVendorInvoiceInput,
  PoVariationWithLines,
  PrepareSubcontractAcceptanceInput,
  ProjectSubcontractExposureRow,
  PurchaseOrderLineRow,
  PurchaseOrderRevisionRow,
  RequestPoVariationInput,
  SetPoLinesInput,
  SubcontractAcceptanceWithLines,
  SubcontractCapExceptionRow,
  SubcontractPoPositionRow,
  VariationRouteRow,
  WorkOrderCostVariationRow,
} from '@/src/lib/db/subcontracts';
import type { ProcurementInvoiceRow } from '@/src/lib/db/procurementLifecycle';

/** Subcontract purchase order, acceptance, variation, and invoice operations. */
export interface SubcontractRepository {
  getPoPosition(poId: string): Promise<SubcontractPoPositionRow[]>;
  listPoRevisions(poId: string): Promise<PurchaseOrderRevisionRow[]>;
  listPoLines(poId: string, revision?: number): Promise<PurchaseOrderLineRow[]>;
  setPoLines(poId: string, lines: SetPoLinesInput[]): Promise<number>;
  issuePoLines(poId: string): Promise<number>;
  listSubcontractAcceptances(poId: string): Promise<SubcontractAcceptanceWithLines[]>;
  prepareSubcontractAcceptance(input: PrepareSubcontractAcceptanceInput): Promise<string>;
  confirmSubcontractAcceptance(id: string): Promise<string>;
  withdrawSubcontractAcceptance(id: string): Promise<void>;
  listPoVariations(poId: string): Promise<PoVariationWithLines[]>;
  requestPoVariation(input: RequestPoVariationInput): Promise<string>;
  decidePoVariation(id: string, approve: boolean, notes?: string | null): Promise<void>;
  issuePoRevision(variationId: string): Promise<number>;
  linkPoVariation(variationId: string, workOrderId: string | null, reason: string | null): Promise<void>;
  getVariationRoute(variationId: string): Promise<VariationRouteRow | null>;
  getProjectSubcontractExposure(projectId: string): Promise<ProjectSubcontractExposureRow[]>;
  listWorkOrderCostVariations(workOrderId: string): Promise<WorkOrderCostVariationRow[]>;
  listSubcontractCapExceptions(procurementId: string): Promise<SubcontractCapExceptionRow[]>;
  attributeSubcontractBillLines(invoiceId: string, lines: AttributeSubcontractBillLineInput[]): Promise<void>;
  captureSubcontractVendorInvoice(input: CaptureSubcontractVendorInvoiceInput): Promise<ProcurementInvoiceRow>;
}

export type { CaptureSubcontractVendorInvoiceInput };
