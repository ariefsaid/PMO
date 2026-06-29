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
}

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
): Promise<{ id: string }> {
  const type = row.type as CycleType;
  const ref = parseRef(row.externalRef);
  const status = parseStatus(row.status);
  const date = parseDate(row.date);
  const amount = parseAmount(row.amount);

  switch (type) {
    case 'PR': {
      const result = await createPurchaseRequest(procurementId, ref, status, date, amount);
      return { id: result.id };
    }

    case 'RFQ': {
      const result = await createRfq(procurementId, ref, status, date, amount);
      return { id: result.id };
    }

    case 'PO': {
      const result = await createPurchaseOrder(procurementId, ref, status, date, amount);
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
      );
      return { id: result.id };
    }

    case 'GR': {
      const grStatus = (status ?? '') as GrStatus;
      const result = await createReceipt(procurementId, grStatus, date ?? '', ref);
      return { id: result.id };
    }

    case 'VI': {
      const viStatus = (status ?? '') as ViStatus;
      const result = await createInvoice(procurementId, viStatus, date ?? '', ref, amount);
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
  { requestedById, projectLookup, vendorLookup }: CommitOptions,
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

  // Step 1: create procurement header
  let procurementId: string;
  try {
    const header = await createProcurement(
      {
        title: attrs.title ?? attrs.project ?? group.caseRef,
        projectId,
        vendorId,
      },
      requestedById,
    );
    procurementId = header.id;
  } catch (err) {
    const { headline, detail } = classifyMutationError(err);
    return {
      caseRef: group.caseRef,
      headerStatus: 'failed',
      headerError: `${headline}: ${detail}`,
      records: [],
    };
  }

  // Build a map from rowNumber → validated row (for valid-row filtering)
  const validRowNumbers = new Set(validatedRows.filter((r) => r.valid).map((r) => r.rowNumber));

  // Step 2: sort valid rows in canonical order, then create records best-effort
  const validRows = group.rows.filter((r) => validRowNumbers.has(r.rowNumber));
  validRows.sort((a, b) => {
    const ai = CYCLE_ORDER.indexOf(a.type as CycleType);
    const bi = CYCLE_ORDER.indexOf(b.type as CycleType);
    // Unknown types sort to the end
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  // First pass: track the VI created in this group (for Payment FK settlement)
  let groupInvoiceId: string | null = null;
  const records: CommitRecordResult[] = [];

  for (const row of validRows) {
    try {
      const { id } = await createRecord(row, procurementId, groupInvoiceId, vendorLookup);
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

  return {
    caseRef: group.caseRef,
    procurementId,
    headerStatus: 'created',
    records,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Commits all VALID validated groups to the DB.
 *
 * Groups where `valid=false` are silently skipped (no DB writes, not counted).
 * Per-case: header failure → children skipped; recorded as a failed case.
 * Per-record: best-effort — one failure does NOT abort the rest of the group.
 *
 * @param validatedGroups - Output of validateGroups.
 * @param options - requestedById (the importing user's id) + ref lookups.
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
    if (caseResult.headerStatus === 'created') {
      cases.push(caseResult);
      for (const rec of caseResult.records) {
        if (rec.status === 'created') created++;
        else failed++;
      }
    } else {
      // Header-failed cases ARE included in 'cases' so the result UI can surface the failure reason.
      cases.push(caseResult);
    }
  }

  return { created, failed, cases };
}
