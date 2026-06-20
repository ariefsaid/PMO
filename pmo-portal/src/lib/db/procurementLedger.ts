/**
 * procurementLedger.ts — pure view-model over the already-loaded ProcurementDetail bundle.
 *
 * `buildLedgerRows(detail)` unions all 7 record collections (PR / RFQ / Quote / PO / GR /
 * Invoice / Payment) into one chronological list of LedgerRow[], newest-first. No fetch,
 * no N+1 (NFR-PR-PERF-002). Empty record types contribute no row (the de-dup contract,
 * AC-PR-LEDGER-004). Multiple records per phase each produce their own row
 * (AC-PR-LEDGER-005).
 *
 * Business-date extraction:
 *   - purchase_requests / rfqs / purchase_orders / payments → `.date`
 *   - receipts → `.receipt_date`
 *   - invoices → `.invoice_date`
 *   - quotations → `.received_date`
 *   All fall back to `.created_at` when the business date is null.
 *
 * `financial` flag (AC-PR-LEDGER-007):
 *   true  = PR, Quote, PO, Invoice, Payment (carry a monetary commitment)
 *   false = RFQ, GR (process milestones without a direct financial value)
 *
 * `statusVariant` is derived from the record's status string via `workflowVariant` —
 * the single-source status registry (CW-2, DESIGN.md).
 */

import type { ProcurementDetail } from './procurementLifecycle';
import type { StatusVariant } from '@/src/components/ui/StatusPill';
import { workflowVariant } from '@/src/lib/status/statusVariants';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RecordType = 'PR' | 'RFQ' | 'Quote' | 'PO' | 'GR' | 'Invoice' | 'Payment';

export interface LedgerRow {
  /** Unique ID for this row — `<type>-<recordId>` to avoid cross-type collisions. */
  id: string;
  /** Business date string (ISO 8601 date or datetime). Used for sort + display. */
  date: string;
  /** Record type label. */
  type: RecordType;
  /** System-minted number (e.g. "PO-2026-0077"). Null if not yet minted. */
  systemNumber: string | null;
  /** Human-set external reference (e.g. "PO/MER/0077"). Null when absent. */
  externalRef: string | null;
  /** Numeric amount (optional — RFQ and GR typically null). */
  amount: number | null;
  /** Status label for the StatusPill. */
  status: string;
  /** StatusPill variant derived from status. */
  statusVariant: StatusVariant;
  /**
   * Storage path of the first non-archived file for this record (from the bundle embed).
   * Null when no file is attached. Used for the "Has file" filter and as the lazy-sign target.
   * Populated from embedded *_files arrays in buildLedgerRows; zero per-row network calls.
   */
  fileHref: string | null;
  /**
   * Display title for the first file (title column if set, else basename of file_path).
   * Null when no file is attached.
   */
  fileTitle: string | null;
  /**
   * Count of non-archived files for this record (from the bundle embed).
   * 0 when no files are attached.
   */
  fileCount: number;
  /**
   * true = this record type has a monetary commitment (PR / Quote / PO / Invoice / Payment).
   * false = process milestone without a direct financial value (RFQ / GR).
   * Drives the "Financial" filter chip.
   */
  financial: boolean;
  /** The underlying record's UUID (for keying, file-subsection phase+parentId). */
  recordId: string;
}

// ---------------------------------------------------------------------------
// Internal builder helpers
// ---------------------------------------------------------------------------

/** The financial record types (carry a direct monetary commitment). */
const FINANCIAL_TYPES = new Set<RecordType>(['PR', 'Quote', 'PO', 'Invoice', 'Payment']);

function isFinancial(type: RecordType): boolean {
  return FINANCIAL_TYPES.has(type);
}

/** Minimal shape of the file rows embedded in the bundle. */
interface EmbeddedFileRow {
  title?: string | null;
  file_path?: string | null;
  archived_at?: string | null;
}

/** Extract basename from a storage path — last segment after the final '/'. */
function fileBasename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

/**
 * Derive file presence (href, title, count) from the embedded file rows.
 * Filters out archived rows (archived_at != null). Zero network calls.
 */
function filePresence(files: EmbeddedFileRow[] | undefined): {
  fileHref: string | null;
  fileTitle: string | null;
  fileCount: number;
} {
  const active = (files ?? []).filter((f) => f.archived_at == null && f.file_path);
  if (active.length === 0) return { fileHref: null, fileTitle: null, fileCount: 0 };
  const first = active[0];
  const path = first.file_path!;
  const title = first.title ? first.title : fileBasename(path);
  return { fileHref: path, fileTitle: title, fileCount: active.length };
}

function makeRow(
  type: RecordType,
  recordId: string,
  date: string | null,
  createdAt: string,
  systemNumber: string | null,
  externalRef: string | null,
  amount: number | null | undefined,
  status: string,
  files?: EmbeddedFileRow[],
): LedgerRow {
  const businessDate = date ?? createdAt;
  const { fileHref, fileTitle, fileCount } = filePresence(files);
  return {
    id: `${type}-${recordId}`,
    date: businessDate,
    type,
    systemNumber: systemNumber ?? null,
    externalRef: externalRef ?? null,
    amount: amount ?? null,
    status,
    statusVariant: workflowVariant(status),
    fileHref,
    fileTitle,
    fileCount,
    financial: isFinancial(type),
    recordId,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Unions all 7 procurement record collections from the already-loaded
 * `ProcurementDetail` bundle into one chronological LedgerRow[], newest-first.
 *
 * Pure function — no side effects, no async. Safe to call in a React render.
 */
export function buildLedgerRows(detail: ProcurementDetail): LedgerRow[] {
  const rows: LedgerRow[] = [];

  // ── 1. Purchase Requests ──────────────────────────────────────────────────
  for (const pr of detail.purchase_requests ?? []) {
    rows.push(
      makeRow(
        'PR',
        pr.id,
        pr.date,
        pr.created_at,
        pr.pr_number,
        pr.reference_number,
        pr.amount,
        pr.status,
        (pr as unknown as { files?: EmbeddedFileRow[] }).files,
      ),
    );
  }

  // ── 2. RFQs ───────────────────────────────────────────────────────────────
  for (const rfq of detail.rfqs ?? []) {
    rows.push(
      makeRow(
        'RFQ',
        rfq.id,
        rfq.date,
        rfq.created_at,
        rfq.rfq_number,
        rfq.reference_number,
        rfq.amount,
        rfq.status,
        (rfq as unknown as { files?: EmbeddedFileRow[] }).files,
      ),
    );
  }

  // ── 3. Quotations — business date = received_date ─────────────────────────
  // Note: procurement_quotations has no `status` column in the DB schema;
  // derive a display status from is_selected.
  for (const vq of detail.quotations ?? []) {
    const vqStatus = vq.is_selected ? 'Selected' : 'Received';
    rows.push(
      makeRow(
        'Quote',
        vq.id,
        vq.received_date,      // business date for quotations
        detail.created_at,     // fallback: the case's created_at (quotations have no created_at)
        vq.vq_number,
        vq.reference ?? null,  // supplier's own quote reference (e.g. "SVX-Q-2501-01")
        vq.total_amount,
        vqStatus,
        (vq as unknown as { files?: EmbeddedFileRow[] }).files,
      ),
    );
  }

  // ── 4. Purchase Orders ────────────────────────────────────────────────────
  for (const po of detail.purchase_orders ?? []) {
    rows.push(
      makeRow(
        'PO',
        po.id,
        po.date,
        po.created_at,
        po.po_number,
        po.reference_number,
        po.amount,
        po.status,
        (po as unknown as { files?: EmbeddedFileRow[] }).files,
      ),
    );
  }

  // ── 5. Goods Receipts — business date = receipt_date ─────────────────────
  // GRs are non-financial (no amount); reference_number is the supplier delivery-note.
  for (const gr of detail.receipts ?? []) {
    rows.push(
      makeRow(
        'GR',
        gr.id,
        gr.receipt_date,               // business date for GRs
        gr.created_at,
        gr.gr_number,
        gr.reference_number ?? null,   // supplier delivery-note (e.g. "DN-44120")
        null,                          // GRs are non-financial — no amount
        gr.status,
        (gr as unknown as { files?: EmbeddedFileRow[] }).files,
      ),
    );
  }

  // ── 6. Vendor Invoices — business date = invoice_date ────────────────────
  // reference_number = supplier's own invoice number; amount = invoice total.
  for (const vi of detail.invoices ?? []) {
    rows.push(
      makeRow(
        'Invoice',
        vi.id,
        vi.invoice_date,               // business date for invoices
        vi.created_at,
        vi.vi_number,
        vi.reference_number ?? null,   // supplier invoice number (e.g. "INV-SF-2291")
        vi.amount ?? null,             // invoice total (migration 0040)
        vi.status,
        (vi as unknown as { files?: EmbeddedFileRow[] }).files,
      ),
    );
  }

  // ── 7. Payments ───────────────────────────────────────────────────────────
  for (const pay of detail.payments ?? []) {
    rows.push(
      makeRow(
        'Payment',
        pay.id,
        pay.date,
        pay.created_at,
        pay.pay_number,
        pay.reference_number,
        pay.amount,
        pay.status,
        (pay as unknown as { files?: EmbeddedFileRow[] }).files,
      ),
    );
  }

  // ── Sort: newest-first (descending by business date) ─────────────────────
  rows.sort((a, b) => {
    if (a.date > b.date) return -1;
    if (a.date < b.date) return 1;
    return 0;
  });

  return rows;
}
