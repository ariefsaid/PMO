/** ERPNext mirror translation at the adapter boundary; no source-specific names escape it. */
import type { CaptureKind, CaptureSource, CaptureState } from '../captureHistory.ts';
import type { PurchaseDoctype } from './purchaseMirrorFeed.ts';
import { invertProjectMap } from './projectMap.ts';

export interface CaptureMirrorRow {
  id: string;
  erp_doctype: PurchaseDoctype;
  erp_name: string;
  erp_docstatus: number;
  erp_status: string | null;
  erp_modified: string;
  project_ids: string[];
  procurement_id: string | null;
  supplier: string | null;
  supplier_name: string | null;
  doc_date: string | null;
  currency: string | null;
  net_total: string | null;
  is_return: boolean;
  purchase_orders: string[];
  account_class?: 'expense' | 'capital_spending' | 'mixed' | 'unknown';
}

const KINDS: Record<PurchaseDoctype, CaptureKind> = {
  'Purchase Order': 'order', 'Purchase Receipt': 'receipt', 'Purchase Invoice': 'supplier_invoice', 'Payment Entry': 'supplier_payment',
};

export function normalisePurchaseMirror(row: CaptureMirrorRow): CaptureSource {
  if (!row.id || !row.erp_modified) throw new Error('source identity and revision are required');
  const invoiceWithoutBasis = row.erp_doctype === 'Purchase Invoice' && row.account_class !== 'expense' && row.account_class !== 'capital_spending' && row.account_class !== 'mixed';
  const kind: CaptureKind = row.is_return ? 'adjustment'
    : row.erp_doctype === 'Purchase Invoice' && row.account_class === 'capital_spending' ? 'capital_spending'
    : invoiceWithoutBasis ? 'other' : KINDS[row.erp_doctype];
  let state: CaptureState;
  if (row.erp_docstatus === 2) state = 'cancelled';
  else if (row.erp_docstatus !== 1) state = 'draft';
  else if (kind === 'order') state = 'ordered';
  else if (kind === 'receipt') state = 'received';
  else if (kind === 'supplier_payment' || row.erp_status === 'Paid') state = 'paid';
  else if (row.erp_status === 'Partly Paid') state = 'part_paid';
  else state = 'invoiced';
  return { id: row.id, kind, state, projectIds: row.project_ids, version: row.erp_modified,
    purchaseId: row.procurement_id, reference: row.erp_name, supplier: row.supplier,
    supplierName: row.supplier_name, date: row.doc_date, currency: row.currency,
    amount: row.net_total, parentIds: row.purchase_orders, accountClass: row.account_class,
    ...(invoiceWithoutBasis && !row.is_return ? { unavailableReason: 'unknown_account_basis' } : {}) };
}

/** The caller supplies the paged, organization-scoped mirror reader. */
export function createPurchaseCaptureAdapter(
  readPage: (cursor: string | null) => Promise<{ rows: CaptureMirrorRow[]; nextCursor: string | null; revision: string }>,
  ledger?: { projectMap: Readonly<Record<string, unknown>>; readPage: (cursor: string | null) => Promise<{ rows: CaptureMirrorLedgerLine[]; nextCursor: string | null; revision: string }> },
): import('../captureHistory.ts').CaptureAdapter {
  const identities: CaptureMirrorIdentity[] = [];
  return {
    async listSources(cursor) {
      const page = await readPage(cursor);
      identities.push(...page.rows);
      return { supported: true, sources: page.rows.map(normalisePurchaseMirror), nextCursor: page.nextCursor, revision: page.revision };
    },
    async listLedger(cursor) {
      if (!ledger) return { supported: false, missing: ['ledger source unsupported'] };
      const page = await ledger.readPage(cursor);
      return { supported: true, lines: page.rows.map((row) => normaliseCaptureLedger(row, ledger.projectMap, identities)),
        nextCursor: page.nextCursor, revision: page.revision };
    },
  };
}

export interface CaptureMirrorLedgerLine {
  id: string;
  project: string | null;
  voucher_type: string | null;
  voucher_no: string | null;
  debit: string | null;
  credit: string | null;
  mapped: boolean;
}
export interface CaptureMirrorIdentity { id: string; erp_doctype: string; erp_name: string; account_class?: string }

function minorUnits(value: string | null): bigint {
  if (value === null || !/^-?\d+(?:\.\d{1,2})?$/.test(value)) throw new Error('ledger amount is unavailable or not exact');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return negative ? -result : result;
}

/** The binding map is inverted with the same ambiguity rule as the actuals snapshot. */
export function normaliseCaptureLedger(
  row: CaptureMirrorLedgerLine,
  projectMap: Readonly<Record<string, unknown>>,
  documents: CaptureMirrorIdentity[],
): { projectId: string | null; line: import('../captureHistory.ts').CaptureLedgerLine; reason?: string } {
  const projectId = row.project === null ? null : invertProjectMap(projectMap).get(row.project) ?? null;
  const docs = documents.filter((doc) => doc.erp_name === row.voucher_no && doc.erp_doctype === row.voucher_type);
  const document = docs.length === 1 ? docs[0] : undefined;
  let kind: CaptureKind = row.voucher_type === 'Journal Entry' ? 'journal'
    : row.voucher_type === 'Purchase Invoice' ? 'supplier_invoice'
    : row.voucher_type === 'Payment Entry' ? 'supplier_payment' : 'other';
  if (!row.mapped && (document?.account_class === 'capital_spending' || document?.account_class === 'mixed')) kind = 'capital_spending';
  const line = { id: row.id, documentId: document?.id ?? null,
    amountCents: (minorUnits(row.debit) - minorUnits(row.credit)).toString(), kind };
  return { projectId, line, ...(projectId === null ? { reason: 'project_unmapped' }
    : docs.length > 1 ? { reason: 'document_ambiguous' }
    : !row.mapped && kind !== 'capital_spending' ? { reason: 'account_unmapped' } : {}) };
}
