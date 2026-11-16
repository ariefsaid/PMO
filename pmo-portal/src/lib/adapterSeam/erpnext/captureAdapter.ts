import { mapCaptureSource } from './captureHistory.ts';
import type { CaptureAdapter, CaptureLedgerEvidence } from '../captureAdapter.ts';
import { createCapturePrecisionReader, type CapturePrecisionClient } from './captureEvidence.ts';

type Resolution = { refusal: string } | { client: CapturePrecisionClient; config: Record<string, unknown> | null };
/** `erpCalls: false` is for a request that never reads the ERP (placing an invoice): the ERP client is not resolved, so a credential problem cannot surface as "unsupported". */
export async function createCaptureAdapter(config: { company?: unknown } | null, resolve: () => Promise<Resolution>, options: { erpCalls?: boolean } = {}): Promise<CaptureAdapter> {
  if (typeof config?.company !== 'string' || !config.company.trim()) return { supported: false, missing: ['company_unknown'], status: 200 };
  const resolved: Resolution = options.erpCalls === false ? { client: undefined as unknown as CapturePrecisionClient, config } : await resolve();
  if ('refusal' in resolved || resolved.config?.company !== config.company) return { supported: false, missing: ['erp_reader_unavailable'], status: 200 };
  return { supported: true, capabilities: { invoiceAssignment: true }, company: config.company, mapSource: mapCaptureSource, mapLedger(input: unknown): CaptureLedgerEvidence {
    const row = input as { id: string; erp_modified: string; company: string; project_id: string | null; voucher_no: string | null; debit: string; credit: string; document_id: string | null; journal_purchase_id: string | null; kind: CaptureLedgerEvidence['kind']; classification: CaptureLedgerEvidence['classification'] };
    return { id: row.id, version: row.erp_modified, company: row.company, projectId: row.project_id, reference: row.voucher_no, debit: row.debit, credit: row.credit, documentId: row.document_id, journalPurchaseId: row.journal_purchase_id, kind: row.kind, classification: row.classification };
  }, precision: options.erpCalls === false ? { read: async () => ({ ok: false as const, reason: 'source_precision_unknown' as const }) } : createCapturePrecisionReader(resolved.client) };
}
