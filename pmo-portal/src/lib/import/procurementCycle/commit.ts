/**
 * M3 — Commit validated procurement-cycle groups to the DB (ADR-0035).
 *
 * For each VALID group:
 *   1. Create the procurement header (case) via createProcurement.
 *   2. Create each group's records in canonical order PR→RFQ→Quotation→PO→GR→VI→Payment.
 *   3. Intra-group settlement: Payment.invoiceId = the VI created in step 2 (null if none).
 *
 * Per-case: header failure → whole group skipped (no children attempted).
 * Per-record: best-effort — one failure does NOT abort remaining records.
 * Invalid groups (valid=false) are silently skipped.
 *
 * org_id is NEVER client-supplied — RLS/RPC stamps it.
 *
 * Import idempotency (Deliverable 2, D-ONB-1/D-ONB-3): when `importBatchId` + `skipLookup`
 * are supplied, the case-header skip and each child record's skip are INDEPENDENT decisions
 * (FR-IDEM-003/005) — a header skip does not skip its still-missing children. NULL/absent
 * `importBatchId` preserves the legacy create-only behavior exactly (opt-in, never changes
 * existing non-import callers).
 */
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { createProcurement } from '@/src/lib/db/procurementCrud';
import {
  createPurchaseRequest,
  createRfq,
  createPurchaseOrder,
  createPayment,
} from '@/src/lib/db/procurementRecords';
import {
  createQuotation,
  createReceipt,
  createInvoice,
} from '@/src/lib/db/procurementLifecycle';
import type { RefLookup } from '@/src/lib/import/refLookup';
import { refId } from '@/src/lib/import/refLookup';
import type { ImportSkipLookup, RecordTableName } from '@/src/lib/db/procurementImportSkip';
import { computeCaseImportKey, computeRecordImportKey } from './importKey';
import type {
  ValidatedGroup,
  CycleRow,
  CycleType,
  CommitCaseResult,
  CommitRecordResult,
  CommitResult,
} from './types';
import { CYCLE_ORDER } from './types';
import { GR_STATUS, VI_STATUS } from './validate';

type GrStatus = (typeof GR_STATUS)[number];
type ViStatus = (typeof VI_STATUS)[number];

// ─── Commit options ────────────────────────────────────────────────────────────

export interface CommitOptions {
  requestedById: string;
  projectLookup: RefLookup;
  vendorLookup: RefLookup;
  /** Present only when the caller wants re-run-safe skip semantics (import commit path).
   *  Absent (undefined) ⇒ legacy create-only behavior (opt-in, FR-IDEM-003 NULL-key note) —
   *  used by any future non-import caller of commitGroups, preserving old behavior exactly. */
  importBatchId?: string;
  skipLookup?: ImportSkipLookup;
}

const TYPE_TO_TABLE: Record<CycleType, RecordTableName> = {
  PR: 'purchase_requests',
  RFQ: 'rfqs',
  Quotation: 'procurement_quotations',
  PO: 'purchase_orders',
  GR: 'procurement_receipts',
  VI: 'procurement_invoices',
  Payment: 'payments',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseAmount(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const n = Number(raw.trim());
  return isNaN(n) ? null : n;
}

function parseDate(raw: string | undefined): string | null {
  return raw?.trim() || null;
}

function parseStatus(raw: string | undefined): string | null {
  return raw?.trim() || null;
}

function parseRef(raw: string | undefined): string | null {
  return raw?.trim() || null;
}

// ─── Per-record dispatch ───────────────────────────────────────────────────────

/**
 * Dispatches a single CycleRow to its matching create fn.
 * Returns the created record's id or throws on failure.
 */
async function createRecord(
  row: CycleRow,
  procurementId: string,
  groupInvoiceId: string | null,
  vendorLookup: RefLookup,
  importKey?: string,
  importBatchId?: string,
  importedAt?: string,
): Promise<{ id: string }> {
  const type = row.type as CycleType;
  const ref = parseRef(row.externalRef);
  const status = parseStatus(row.status);
  const date = parseDate(row.date);
  const amount = parseAmount(row.amount);

  switch (type) {
    case 'PR': {
      const result = await createPurchaseRequest(procurementId, ref, status, date, amount, importKey, importBatchId, importedAt);
      return { id: result.id };
    }

    case 'RFQ': {
      const result = await createRfq(procurementId, ref, status, date, amount, importKey, importBatchId, importedAt);
      return { id: result.id };
    }

    case 'PO': {
      const result = await createPurchaseOrder(procurementId, ref, status, date, amount, importKey, importBatchId, importedAt);
      return { id: result.id };
    }

    case 'Quotation': {
      const vendorIdStr = refId(vendorLookup, row.vendor ?? '');
      // vendorId must be non-null here (validate guarantees it for valid rows)
      const result = await createQuotation(
        procurementId,
        vendorIdStr ?? '',
        amount ?? 0,
        date ?? '',
        importKey,
        importBatchId,
        importedAt,
      );
      return { id: result.id };
    }

    case 'GR': {
      const grStatus = (status ?? '') as GrStatus;
      const result = await createReceipt(procurementId, grStatus, date ?? '', ref, importKey, importBatchId, importedAt);
      return { id: result.id };
    }

    case 'VI': {
      const viStatus = (status ?? '') as ViStatus;
      const result = await createInvoice(procurementId, viStatus, date ?? '', ref, amount, importKey, importBatchId, importedAt);
      return { id: result.id };
    }

    case 'Payment': {
      const result = await createPayment(
        procurementId,
        groupInvoiceId, // null if no VI in this group
        ref,
        status,
        date,
        amount,
        importKey,
        importBatchId,
        importedAt,
      );
      return { id: result.id };
    }

    default:
      throw new Error(`Unknown record type: "${type}"`);
  }
}

// ─── Case-level commit ────────────────────────────────────────────────────────

async function commitCase(
  validated: ValidatedGroup,
  { requestedById, projectLookup, vendorLookup, importBatchId, skipLookup }: CommitOptions,
): Promise<CommitCaseResult> {
  const { group, rows: validatedRows } = validated;
  const { attrs } = group;

  // Resolve project and vendor for the header (vendor optional — may be null)
  const projectId = attrs.project ? refId(projectLookup, attrs.project) : null;
  // Header vendorId: pick from first Quotation row's vendor if present, else null
  const quotationRow = group.rows.find((r) => r.type === 'Quotation');
  const vendorId = quotationRow?.vendor
    ? refId(vendorLookup, quotationRow.vendor)
    : null;

  const caseImportKey = importBatchId ? computeCaseImportKey(group) : null;
  const importedAtIso = importBatchId ? new Date().toISOString() : undefined;

  // ── Case-header: skip-if-exists (FR-IDEM-003, independent of per-record decisions) ──
  let procurementId: string;
  let headerStatus: 'created' | 'skipped';
  let headerSkipReason: string | undefined;

  if (importBatchId && skipLookup && caseImportKey) {
    // org_id is resolved server-side by the skip-lookup's RLS-scoped read (never client-supplied).
    const existing = await skipLookup.findExistingCase(caseImportKey, importBatchId);
    // FR-IDEM-006: a case with the same import_key from an EARLIER batch must be skipped, not
    // duplicated. Checked only when the same-batch lookup missed (same-batch is the common path).
    const collision = existing
      ? null
      : await skipLookup.findCrossBatchCollision('procurements', caseImportKey, importBatchId);
    const priorCase = existing ?? collision;
    if (priorCase) {
      procurementId = priorCase.id;
      headerStatus = 'skipped';
      headerSkipReason = existing
        ? `already imported (batch ${importBatchId})`
        : `already imported by an earlier batch (${(collision as { import_batch_id: string }).import_batch_id})`;
    } else {
      try {
        const header = await createProcurement(
          {
            title: attrs.title ?? attrs.project ?? group.caseRef, projectId, vendorId,
            importKey: caseImportKey ?? undefined, importBatchId, importedAt: importedAtIso,
          },
          requestedById,
        );
        procurementId = header.id;
        headerStatus = 'created';
      } catch (err) {
        const { headline, detail } = classifyMutationError(err);
        return {
          caseRef: group.caseRef, headerStatus: 'failed',
          headerError: `${headline}: ${detail}`, records: [],
        };
      }
    }
  } else {
    try {
      const header = await createProcurement(
        { title: attrs.title ?? attrs.project ?? group.caseRef, projectId, vendorId },
        requestedById,
      );
      procurementId = header.id;
      headerStatus = 'created';
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      return {
        caseRef: group.caseRef, headerStatus: 'failed',
        headerError: `${headline}: ${detail}`, records: [],
      };
    }
  }

  // Build a map from rowNumber → validated row (for valid-row filtering)
  const validRowNumbers = new Set(validatedRows.filter((r) => r.valid).map((r) => r.rowNumber));

  // Sort valid rows in canonical order, then create records best-effort
  const validRows = group.rows.filter((r) => validRowNumbers.has(r.rowNumber));
  validRows.sort((a, b) => {
    const ai = CYCLE_ORDER.indexOf(a.type as CycleType);
    const bi = CYCLE_ORDER.indexOf(b.type as CycleType);
    // Unknown types sort to the end
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  // Track the VI created (or pre-existing, if skipped) in this group (for Payment FK settlement)
  let groupInvoiceId: string | null = null;
  const records: CommitRecordResult[] = [];

  for (const row of validRows) {
    const recordImportKey = importBatchId ? computeRecordImportKey(row) : null;

    // ── Per-record: skip-if-exists, evaluated INDEPENDENTLY of the header decision (FR-IDEM-003/005) ──
    if (importBatchId && skipLookup && recordImportKey) {
      const table = TYPE_TO_TABLE[row.type as CycleType];
      const existing = table
        ? await skipLookup.findExistingRecord(table, procurementId, recordImportKey, importBatchId)
        : null;
      // FR-IDEM-006: a record with the same import_key from an EARLIER batch (under this case)
      // must be skipped, not duplicated. Checked only when the same-batch lookup missed.
      const collision = table && !existing
        ? await skipLookup.findCrossBatchCollision(table, recordImportKey, importBatchId, procurementId)
        : null;
      const priorRecord = existing ?? collision;
      if (priorRecord) {
        if (row.type === 'VI') groupInvoiceId = priorRecord.id; // preserve Payment FK settlement on skip
        records.push({
          rowNumber: row.rowNumber, type: row.type, id: priorRecord.id,
          status: 'skipped',
          skipReason: existing
            ? `already imported (batch ${importBatchId})`
            : `already imported by an earlier batch (${(collision as { import_batch_id: string }).import_batch_id})`,
        });
        continue;
      }
    }

    try {
      const { id } = await createRecord(
        row, procurementId, groupInvoiceId, vendorLookup,
        recordImportKey ?? undefined, importBatchId, importedAtIso,
      );
      // If this was a VI, capture its id for subsequent Payment rows
      if (row.type === 'VI') groupInvoiceId = id;
      records.push({ rowNumber: row.rowNumber, type: row.type, id, status: 'created' });
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      records.push({
        rowNumber: row.rowNumber,
        type: row.type,
        status: 'failed',
        error: `${headline}: ${detail}`,
      });
    }
  }

  return { caseRef: group.caseRef, procurementId, headerStatus, headerSkipReason, records };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Commits all VALID validated groups to the DB.
 *
 * Groups where `valid=false` are silently skipped (no DB writes, not counted).
 * Per-case: header failure → children skipped; recorded as a failed case.
 * Per-record: best-effort — one failure does NOT abort the rest of the group.
 * When `importBatchId`/`skipLookup` are supplied, case-header and per-record skip
 * decisions are independent (FR-IDEM-003/005) — see module docstring.
 *
 * @param validatedGroups - Output of validateGroups.
 * @param options - requestedById (the importing user's id) + ref lookups (+ optional import provenance).
 * @returns CommitResult with aggregate created/failed counts + per-case detail.
 */
export async function commitGroups(
  validatedGroups: ValidatedGroup[],
  options: CommitOptions,
): Promise<CommitResult> {
  const cases: CommitCaseResult[] = [];
  let created = 0;
  let failed = 0;

  for (const validated of validatedGroups) {
    // Skip invalid groups entirely
    if (!validated.valid) continue;

    const caseResult = await commitCase(validated, options);
    cases.push(caseResult);
    if (caseResult.headerStatus === 'created' || caseResult.headerStatus === 'skipped') {
      for (const rec of caseResult.records) {
        if (rec.status === 'created') created++;
        else if (rec.status === 'failed') failed++;
        // 'skipped' counts toward neither — surfaced via the per-case/per-record detail instead.
      }
    }
  }

  return { created, failed, cases };
}
