/** Third-party inspection repository contract (#2580). */
import type {
  InspectionRow, InspectionListRow, InspectionFileRow, InspectionInput, InspectionResult, InspectionGate,
  InspectionCostRow, InspectionPrerequisites,
} from '@/src/lib/db/thirdPartyInspections';

export interface ThirdPartyInspectionRepository {
  /** The inspections of one work order, oldest first (bounded). */
  listForWorkOrder(workOrderId: string): Promise<InspectionListRow[]>;
  /** Committed and billed per inspection per currency; null amounts for a caller outside the money roles (server-side). */
  costs(workOrderId: string): Promise<InspectionCostRow[]>;
  /** The blocking inspections and the single `complete` boolean for one gate. */
  prerequisites(workOrderId: string, gate: InspectionGate): Promise<InspectionPrerequisites>;
  create(input: InspectionInput): Promise<string>;
  /** Raise the purchase: a new Draft case (no `procurementId`) or link an existing unlinked case of the project. */
  raisePurchase(id: string, procurementId?: string | null): Promise<string>;
  recordInvitation(id: string, on: string, who: string | null, how: string | null): Promise<void>;
  recordExecution(id: string, on: string): Promise<void>;
  recordReport(id: string, result: InspectionResult): Promise<void>;
  waive(id: string, reason: string): Promise<void>;
  cancel(id: string, reason: string): Promise<void>;
  listFiles(inspectionId: string): Promise<InspectionFileRow[]>;
  addFile(inspection: Pick<InspectionRow, 'id' | 'org_id'>, file: File, liveCount: number): Promise<InspectionFileRow>;
  fileUrl(path: string): Promise<string>;
}
