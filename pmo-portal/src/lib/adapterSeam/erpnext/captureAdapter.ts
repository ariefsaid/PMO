import { mapCaptureSource } from './captureHistory.ts';
import type { CaptureAdapter, CaptureLedgerEvidence } from '../captureAdapter.ts';
import { createCapturePrecisionReader } from './captureEvidence.ts';
import type { ErpClientDeps } from './client.ts';

type Resolution = { refusal: string } | { client: ErpClientDeps; config: Record<string, unknown> | null };
export async function createCaptureAdapter(config: { company?: unknown } | null, resolve: () => Promise<Resolution>): Promise<CaptureAdapter> {
  if (typeof config?.company !== 'string' || !config.company.trim()) return { supported: false, missing: ['company_unknown'], status: 200 };
  const resolved = await resolve();
  if ('refusal' in resolved || resolved.config?.company !== config.company) return { supported: false, missing: ['erp_reader_unavailable'], status: 200 };
  return { supported: true, company: config.company, mapSource: mapCaptureSource, mapLedger(input: unknown): CaptureLedgerEvidence {
    const row = input as { id: string; erp_modified: string; company: string; project_id: string | null; voucher_no: string | null; debit: string; credit: string; document_id: string | null; journal_purchase_id: string | null; kind: CaptureLedgerEvidence['kind']; classification: CaptureLedgerEvidence['classification'] };
    return { id: row.id, version: row.erp_modified, company: row.company, projectId: row.project_id, reference: row.voucher_no, debit: row.debit, credit: row.credit, documentId: row.document_id, journalPurchaseId: row.journal_purchase_id, kind: row.kind, classification: row.classification };
  }, precision: createCapturePrecisionReader(resolved.client) };
}
