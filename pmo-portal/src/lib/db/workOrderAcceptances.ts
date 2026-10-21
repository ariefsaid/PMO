import { AppError } from '@/src/lib/appError';

/**
 * provisional (Lane C1 supersedes): shapes per plan §2; the DAL bodies are filled by Lane C1.
 */
export interface WorkOrderLineRow {
  id: string; org_id: string; work_order_id: string; boq_item_id: string; quantity: number; created_at: string;
}
export interface WorkOrderAcceptanceLineRow { acceptance_id: string; boq_item_id: string; quantity: number }
export interface WorkOrderAcceptanceRow {
  id: string; org_id: string; project_id: string; work_order_id: string; acceptance_date: string; is_final: boolean;
  status: 'Draft' | 'Confirmed' | 'Withdrawn'; prepared_by: string; prepared_at: string;
  confirmed_by: string | null; confirmed_at: string | null; confirm_basis: string | null; withdrawn_at: string | null;
  note: string | null; document_id: string | null;
}
export interface WorkOrderAcceptanceWithLines extends WorkOrderAcceptanceRow { lines: WorkOrderAcceptanceLineRow[] }
export interface PrepareWorkOrderAcceptanceInput {
  workOrderId: string; acceptanceDate: string; isFinal: boolean;
  lines: Array<{ boqItemId: string; quantity: number }>;
  documentId: string | null; note: string | null; acceptanceId?: string;
}
export interface ConfirmWorkOrderAcceptanceResult { closingValue: number | null; dpHeld: number }

const pending = (): never => { throw new AppError('Lane C1 DAL not merged', 'provisional'); };
export const listWorkOrderLines = async (_projectId: string): Promise<WorkOrderLineRow[]> => pending();
export const createWorkOrderLine = async (_wo: string, _boq: string, _quantity: number): Promise<WorkOrderLineRow> => pending();
export const updateWorkOrderLine = async (_id: string, _quantity: number): Promise<void> => pending();
export const deleteWorkOrderLine = async (_id: string): Promise<void> => pending();
export const listWorkOrderAcceptances = async (_projectId: string): Promise<WorkOrderAcceptanceWithLines[]> => pending();
export const prepareWorkOrderAcceptance = async (_input: PrepareWorkOrderAcceptanceInput): Promise<string> => pending();
export const withdrawWorkOrderAcceptance = async (_id: string): Promise<void> => pending();
export const confirmWorkOrderAcceptance = async (_id: string): Promise<ConfirmWorkOrderAcceptanceResult> => pending();
