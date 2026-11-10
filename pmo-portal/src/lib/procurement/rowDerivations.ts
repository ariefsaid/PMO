import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';
import { procurementMoney, type LinkedErpDocument, type ProcurementMoneyResult } from './procurementMoney';
import { stageDates, stageForStatus, type ProcurementStage, type StageDates } from './stage';

/** An ERP document as the list sees it: the money fields plus the date its stage evidence uses. */
export type ProcurementErpDocument = LinkedErpDocument & { docDate?: string | null };

/** Each procurement's linked ERP documents, built in ONE pass over the org-wide document list. */
export type ErpDocumentsByProcurement = Map<string, ProcurementErpDocument[]>;

/**
 * #2101: the procurement list reads a row's money, stage dates and age in many places (cells,
 * export accessors, stage totals, the value/age sort). Grouping the org's ERP documents once and
 * deriving each row once keeps that read O(row's own documents) instead of rescanning every
 * document at every call site.
 */
export function groupErpDocumentsByProcurement(
  documents: readonly ProcurementErpDocument[] | null | undefined,
): ErpDocumentsByProcurement {
  const grouped: ErpDocumentsByProcurement = new Map();
  for (const document of documents ?? []) {
    if (!document.procurementId) continue;
    const list = grouped.get(document.procurementId);
    if (list) list.push(document);
    else grouped.set(document.procurementId, [document]);
  }
  return grouped;
}

export interface ProcurementRowDerivation {
  /** The row's one honest money reading (paid, invoiced, ordered, then requested). */
  money: ProcurementMoneyResult;
  /** First evidenced date for each user-facing stage, including ERP-linked documents. */
  dates: StageDates;
  /** Days since the current stage was most recently entered. */
  age: number;
}

/** Days in the current stage, from the latest stage event (or its first evidenced date). */
export function ageInStage(row: ProcurementWithRefs, dates: StageDates): number {
  const stage = stageForStatus(row.status);
  const stageStatuses: Record<ProcurementStage, ProcurementStatus[]> = {
    Request: row.status === 'Draft' ? [] : [row.status],
    Order: ['Ordered'],
    Receive: ['Received'],
    Pay: ['Vendor Invoiced', 'Paid'],
  };
  const lastStageEvent = (row.status_events ?? [])
    .filter((event) => stageStatuses[stage].includes(event.to_status))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.created_at;
  const stageDate = lastStageEvent ?? (stage === 'Request' ? dates.request
    : stage === 'Order' ? dates.order
      : stage === 'Receive' ? dates.receive
        : dates.pay);
  const entered = stageDate ? new Date(stageDate).getTime() : new Date(row.created_at).getTime();
  if (!Number.isFinite(entered)) return 0;
  return Math.max(0, Math.floor((Date.now() - entered) / 86_400_000));
}

/** Money, stage dates and age for one row, computed once per data change and shared by every reader. */
export function deriveProcurementRow(
  row: ProcurementWithRefs,
  linkedDocuments: readonly ProcurementErpDocument[],
): ProcurementRowDerivation {
  const money = procurementMoney({
    total_value: row.total_value,
    purchase_requests: row.purchase_requests,
    purchase_orders: row.purchase_orders,
    procurement_invoices: row.procurement_invoices,
    payments: row.payments,
    erpDocuments: linkedDocuments.map((document) => ({
      doctype: document.doctype,
      grand_total: document.grandTotal,
      outstanding_amount: document.outstanding,
    })),
  });
  const dates = stageDates({
    purchase_requests: row.purchase_requests,
    purchase_orders: row.purchase_orders,
    receipts: row.receipts,
    invoices: row.procurement_invoices,
    payments: (row.payments ?? []).filter((payment) => payment.status === 'Paid'),
  }, linkedDocuments.map((document) => ({ doctype: document.doctype, docDate: document.docDate })));
  return { money, dates, age: ageInStage(row, dates) };
}
