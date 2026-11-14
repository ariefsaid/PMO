import type { CaptureKind, CaptureLine, CaptureLedgerLine, CaptureSource, CaptureState, Page } from '../captureHistory.ts';
import { invertProjectMap } from './projectMap.ts';

export function documentKind(doctype: string): CaptureKind {
  const kinds: Record<string, CaptureKind> = { 'Purchase Order': 'order', 'Purchase Receipt': 'receipt', 'Purchase Invoice': 'supplier_invoice', 'Payment Entry': 'supplier_payment' };
  return kinds[doctype] ?? 'other';
}

export function ledgerKind(voucherType: string | null): CaptureKind {
  return voucherType === 'Journal Entry' ? 'journal' : voucherType === 'Purchase Invoice' ? 'supplier_invoice' : voucherType === 'Payment Entry' ? 'supplier_payment' : 'other';
}

import { toMinorUnits } from '../captureHistory.ts';
export { toMinorUnits } from '../captureHistory.ts';
export interface MirrorDocument {
  id: string; erp_doctype: string; erp_name: string; erp_docstatus: number; erp_status: string | null; erp_modified: string;
  supplier: string | null; supplier_name: string | null; doc_date: string | null; currency: string | null; net_total: string | null;
  is_return: boolean; purchase_orders: string[];
}
export interface DocumentEvidence { sourceId: string; projectIds: string[]; familyId: string | null; purchaseId: string | null; purchaseOrigin?: CaptureSource['purchaseOrigin']; scale: number | null; scaleCurrency?: string | null; supplierId?: string | null; lines?: CaptureLine[] | null }
export function normaliseDocument(row: MirrorDocument, evidence: DocumentEvidence): CaptureSource {
  const kind = row.is_return ? 'adjustment' : documentKind(row.erp_doctype);
  let state: CaptureState = 'unknown';
  if (row.erp_docstatus === 2) state = 'cancelled';
  else if (row.erp_docstatus === 0) state = 'draft';
  else if (row.erp_docstatus === 1) {
    if (kind === 'order' && ['To Receive and Bill', 'To Receive', 'To Bill'].includes(row.erp_status ?? '')) state = 'ordered';
    else if (kind === 'receipt') state = 'received';
    else if (kind === 'supplier_payment' || row.erp_status === 'Paid') state = 'paid';
    else if (row.erp_status === 'Partly Paid') state = 'part_paid';
    else if ((kind === 'supplier_invoice' || kind === 'adjustment') && ['Unpaid', 'Overdue', 'Return', 'Credit Note Issued'].includes(row.erp_status ?? '')) state = 'invoiced';
  }
  // A trusted reader may transport item evidence later; absence does not block scoped A facts.
  const missing = evidence.lines == null ? ['line_evidence'] : [];
  if (!evidence.familyId) missing.push('family_evidence');
  let faceMinor: string | null = null;
  try { if (row.net_total !== null && evidence.scale !== null && row.currency && evidence.scaleCurrency === row.currency) faceMinor = toMinorUnits(row.net_total, evidence.scale); } catch { /* Unknown amount remains unavailable. */ }
  if (faceMinor === null) missing.push('face_currency_or_amount');
  return { id: row.id, sourceId: evidence.sourceId, version: row.erp_modified, kind, state, projectIds: evidence.projectIds, supplierId: evidence.supplierId ?? null, supplierReference: row.supplier, supplierName: row.supplier_name,
    currency: row.currency, faceMinor, faceScale: faceMinor === null ? null : evidence.scale, familyId: evidence.familyId, purchaseId: evidence.purchaseId, purchaseOrigin: evidence.purchaseOrigin ?? null, reference: row.erp_name,
    date: row.doc_date, description: null, lines: evidence.lines ?? null, missing };
}
export interface MirrorLedger { id: string; project: string | null; voucher_type: string | null; debit: string | null; credit: string | null }
export function normaliseLedger(row: MirrorLedger, projectMap: Readonly<Record<string, unknown>>, evidence: { sourceId: string; currency: string; scale: number; documentId: string | null; classification: CaptureLedgerLine['classification'] }): { projectId: string | null; line: CaptureLedgerLine; reason?: string } {
  const projectId = row.project ? invertProjectMap(projectMap).get(row.project) ?? null : null;
  if (row.debit === null || row.credit === null) throw new Error('ledger amount unavailable');
  const amountMinor = (BigInt(toMinorUnits(row.debit, evidence.scale)) - BigInt(toMinorUnits(row.credit, evidence.scale))).toString();
  const kind = ledgerKind(row.voucher_type);
  return { projectId, line: { id: row.id, sourceId: evidence.sourceId, currency: evidence.currency, projectId, documentId: evidence.documentId, amountMinor, kind, classification: evidence.classification }, ...(projectId === null ? { reason: 'project_unmapped' } : {}) };
}
export type MirrorSourcePage = Page<{ id: string; row: MirrorDocument; evidence: DocumentEvidence }>;
export type MirrorLedgerPage = Page<{ id: string; row: MirrorLedger; projectMap: Readonly<Record<string, unknown>>; evidence: { sourceId: string; currency: string; scale: number; documentId: string | null; classification: CaptureLedgerLine['classification'] } }>;
export function createCaptureAdapter(readPage: (cursor: string | null) => Promise<MirrorSourcePage>, readLedger?: (cursor: string | null) => Promise<MirrorLedgerPage>, sourceCapability?: { sourceId: string; generation: string; linesAvailable: boolean; familiesAvailable: boolean; currencyAvailable: boolean }) {
  return { async listSources(cursor: string | null) {
    // Capability must be established by the authorized reader, not by incoming request data.
    const missing = [
      ...(!sourceCapability?.sourceId ? ['source_binding'] : []),
      ...(!sourceCapability?.generation ? ['source_generation'] : []),
      ...(!sourceCapability?.familiesAvailable ? ['family_evidence'] : []),
      ...(!sourceCapability?.currencyAvailable ? ['currency_evidence'] : []),
    ];
    if (missing.length || !sourceCapability) return { supported: false as const, missing: ['source_capability_evidence', ...missing] };
    const page = await readPage(cursor);
    if (!page.supported) return page;
    if (page.generation !== sourceCapability.generation) return { supported: false as const, missing: ['generation_changed'] };
    return { ...page, items: page.items.map(item => {
      if (item.id !== item.row.id || item.evidence.sourceId !== sourceCapability.sourceId) throw new Error('source identity mismatch');
      if (!sourceCapability.linesAvailable && item.evidence.lines != null) throw new Error('item capability mismatch');
      return normaliseDocument(item.row, item.evidence);
    }) };
  }, async listLedger(cursor: string | null) {
    if (!readLedger) return { supported: false as const, missing: ['ledger_feed'] };
    const page = await readLedger(cursor);
    if (!page.supported) return page;
    return { ...page, items: page.items.map(item => {
      if (item.id !== item.row.id) throw new Error('ledger identity mismatch');
      return { id: item.id, ...normaliseLedger(item.row, item.projectMap, item.evidence) };
    }) };
  } };
}

export interface RawCaptureDocument extends MirrorDocument { kind: CaptureKind | null; project_ids: string[]; supplier_id: string | null; procurement_id: string | null; purchase_origin: CaptureSource['purchaseOrigin']; recorded_by_pmo: boolean; family_incomplete?: boolean; needs_undo?: Array<{ supplier_id: string; project_id: string; currency: string; purchase_id: string; undo_command: string }> }
export function mapCaptureSource(input: unknown, sourceId: string, precision: Partial<Record<'order' | 'supplier_invoice', number>>): CaptureSource {
  const row = input as RawCaptureDocument;
  const kind = row.kind === 'order' || row.kind === 'supplier_invoice' ? row.kind : null;
  const family = kind === 'order' ? `order:${row.erp_name}` : kind === 'supplier_invoice' && row.purchase_orders.length === 1 ? `order:${row.purchase_orders[0]}` : kind === 'supplier_invoice' && row.purchase_orders.length === 0 ? `invoice:${row.id}` : `other:${row.id}`;
  const normalized = { ...row, net_total: row.net_total === null ? null : trimDecimal(row.net_total) };
  const source = normaliseDocument(normalized, { sourceId, projectIds: row.project_ids, familyId: family, purchaseId: row.procurement_id, purchaseOrigin: row.purchase_origin, supplierId: row.supplier_id, scale: kind ? precision[kind] ?? null : null, scaleCurrency: row.currency });
  if (row.recorded_by_pmo !== true && row.recorded_by_pmo !== false) source.missing?.push('ownership_unknown');
  return { ...source, recordedByPmo: row.recorded_by_pmo === true, familyIncomplete: row.family_incomplete === true, needsUndo: (row.needs_undo ?? []).map(hold => ({ supplierId: hold.supplier_id, projectId: hold.project_id, currency: hold.currency, purchaseId: hold.purchase_id, undoCommand: hold.undo_command })) };
}
function trimDecimal(value: string): string { return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value; }
