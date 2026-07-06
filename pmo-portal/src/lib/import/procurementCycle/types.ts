/**
 * Procurement-cycle bulk-import types (ADR-0035).
 *
 * A single uploaded sheet carries rows of multiple `type` values (PR, RFQ, …,
 * Payment), grouped by `caseRef`. One case = one procurement header + N records.
 * Insert-only v1. Preview = zero writes. Model-C: a case need NOT contain a PR
 * or PO — e.g. a legacy VI+Payment-only case is fully legal.
 */

/** The seven record types in the procure-to-pay cycle. */
export type CycleType = 'PR' | 'RFQ' | 'Quotation' | 'PO' | 'GR' | 'VI' | 'Payment';

/** Canonical processing order for committing records within a case. */
export const CYCLE_ORDER: CycleType[] = ['PR', 'RFQ', 'Quotation', 'PO', 'GR', 'VI', 'Payment'];

/**
 * A single raw-parsed row from the import sheet.
 * All string cells are preserved as-is (trim/cast happens in validate/commit);
 * `rowNumber` is 1-based (matching the source sheet row for user-facing messages).
 */
export interface CycleRow {
  /** The grouping key — identifies which procurement case this row belongs to. */
  caseRef: string | undefined;
  /** Record type. Must be one of the CycleType enum values. */
  type: CycleType | string;
  /** Case-level: the associated project name (resolved via projectLookup). */
  project: string | undefined;
  /** Case-level: the case title (human label for the procurement). */
  title: string | undefined;
  /** Case-level: overall procurement status (optional, may be set from sheet). */
  caseStatus: string | undefined;
  /** Vendor name (required for Quotation; optional for other types). */
  vendor: string | undefined;
  /** External/legacy reference number from the source system. */
  externalRef: string | undefined;
  /** Record-level status string (validated per-type). */
  status: string | undefined;
  /** Record date string (expected ISO YYYY-MM-DD). */
  date: string | undefined;
  /** Monetary amount string (expected numeric ≥ 0). */
  amount: string | undefined;
  /** 1-based source sheet row number (for user-facing error messages). */
  rowNumber: number;
}

/**
 * Case-level attributes derived from the group's rows (first-row-wins per attr).
 * These become the procurement header fields when committing.
 */
export interface CaseAttrs {
  project: string | undefined;
  title: string | undefined;
  caseStatus: string | undefined;
}

/**
 * A group of rows sharing the same caseRef (trim+case-insensitive key, original preserved).
 * `errors` accumulates group-level validation errors (e.g. missing title+project).
 */
export interface CaseGroup {
  /** Original caseRef string (first seen, for display). */
  caseRef: string;
  /** Case-level attrs resolved first-row-wins across the group's rows. */
  attrs: CaseAttrs;
  /** All rows belonging to this case (in sheet order). */
  rows: CycleRow[];
  /** Group-level errors (populated by validateGroups, not groupRows). */
  errors: string[];
}

// ---------------------------------------------------------------------------
// Validate-phase result types
// ---------------------------------------------------------------------------

/** Per-row validation result from validateGroups. */
export interface ValidatedRow {
  rowNumber: number;
  valid: boolean;
  errors: string[];
}

/** Per-group validation result from validateGroups. */
export interface ValidatedGroup {
  group: CaseGroup;
  groupErrors: string[];
  rows: ValidatedRow[];
  /** True iff groupErrors is empty AND ≥1 row is valid. */
  valid: boolean;
}

// ---------------------------------------------------------------------------
// Commit-phase result types
// ---------------------------------------------------------------------------

export interface CommitRecordResult {
  rowNumber: number;
  type: string;
  /** Created (or pre-existing, if skipped) record id. */
  id?: string;
  status: 'created' | 'failed' | 'skipped';
  error?: string;
  /** Present only when status === 'skipped': the reason (AC-IDEM-003/006). */
  skipReason?: string;
}

export interface CommitCaseResult {
  caseRef: string;
  /** The created (or pre-existing, if skipped) procurement header id. */
  procurementId?: string;
  headerStatus: 'created' | 'failed' | 'skipped';
  headerError?: string;
  /** Present only when headerStatus === 'skipped' (AC-IDEM-003/006). */
  headerSkipReason?: string;
  records: CommitRecordResult[];
}

export interface CommitResult {
  created: number;
  failed: number;
  cases: CommitCaseResult[];
}
