import type { StatusVariant } from '@/src/components/ui';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';
import type { Tables } from '@/src/lib/supabase/database.types';

/**
 * IA-3 procurement lifecycle model (master plan §4.2; Wave-1 Area-5 tasks 22-24).
 * Six board stages — PR → VQ → PO → GR → VI → Paid — group the eleven-value
 * `procurements.status` enum for collection scanning. The record's current status
 * and dated progression are shown in its identity and Activity chronology.
 *
 * **Approval is a GATE, not a stage** (owner directive 2026-06-21, reversing the
 * prior PROC-002 classification). An approval is a quality
 * gate that sits across the PR step — it does not mint a document and is not a
 * place a request "rests". So approval has no separate board column. An Approved
 * request groups with Vendor Quote because quote sourcing is its next useful step;
 * the record still displays the exact Approved status.
 *
 * **Quote Selected groups with Vendor Quote** (PROC-003), not Purchase Order.
 * Selecting a quote does not imply that a PO exists; that board stage begins at
 * Ordered.
 *
 * This is presentation only — `LEGAL_TRANSITIONS` and the RPC stay the single
 * source of truth for what may actually move (never re-derived here).
 */
export interface PrStage {
  /** Short stage key (board test-id + doc-ref prefix). */
  key: 'pr' | 'vq' | 'po' | 'gr' | 'vi' | 'paid';
  /** Compact label (table pip tooltip / board column short). */
  label: string;
  /** Full stage name used for board grouping and explanatory labels. */
  full: string;
}

export const PR_STAGES: readonly PrStage[] = [
  { key: 'pr', label: 'PR', full: 'Purchase Request' },
  { key: 'vq', label: 'VQ', full: 'Vendor Quote' },
  { key: 'po', label: 'PO', full: 'Purchase Order' },
  { key: 'gr', label: 'GR', full: 'Goods Receipt' },
  { key: 'vi', label: 'VI', full: 'Vendor Invoice' },
  { key: 'paid', label: 'Paid', full: 'Payment' },
] as const;

/**
 * Maps each procurement status to its 0-based collection board stage.
 * Draft/Requested → PR (0); Approved, Vendor Quoted and Quote Selected → VQ (1);
 * Ordered → PO (2). Approval remains visible as the record status, not a stage.
 */
const STATUS_TO_STAGE: Record<string, number> = {
  Draft: 0,
  Requested: 0,
  Approved: 1,
  'Vendor Quoted': 1,
  'Quote Selected': 1,
  Ordered: 2,
  Received: 3,
  'Vendor Invoiced': 4,
  Paid: 5,
};

// ---------------------------------------------------------------------------
// AC-IXD-PROC-001 — ONE canonical user-facing label per state (IxD #13).
// The badge, the success toast, and the button verb that reaches a state all
// read from this single map, so they can never drift: the verb the user clicks
// names the state, the resulting badge shows that same state, and the toast
// confirms that same state.
// ---------------------------------------------------------------------------

/** The single canonical noun shown for each `procurements.status`. */
export const STATUS_LABEL: Record<string, string> = {
  Draft: 'Draft',
  Requested: 'Purchase Request',
  Approved: 'Approved',
  'Vendor Quoted': 'Vendor Quote',
  'Quote Selected': 'Quote Selected',
  Ordered: 'Purchase Order',
  Received: 'Goods Receipt',
  'Vendor Invoiced': 'Vendor Invoice',
  Paid: 'Paid',
  Rejected: 'Rejected',
  Cancelled: 'Cancelled',
};

/** The imperative verb shown on the button that transitions TO a state. */
const STATUS_VERB: Record<string, string> = {
  Requested: 'Submit Request',
  Approved: 'Approve',
  Rejected: 'Reject',
  Draft: 'Rework (Back to Draft)',
  'Vendor Quoted': 'Request Vendor Quotes',
  'Quote Selected': 'Select Quote',
  Ordered: 'Generate Purchase Order',
  Received: 'Confirm Receipt',
  'Vendor Invoiced': 'Mark Vendor Invoiced',
  Paid: 'Mark as Paid',
  Cancelled: 'Cancel request',
};

/**
 * The button verb that moves a request TO `to`. Names the same canonical state
 * the resulting badge + toast will show (AC-IXD-PROC-001).
 */
export function transitionVerb(to: ProcurementStatus): string {
  return STATUS_VERB[to as string] ?? (to as string);
}

/**
 * The state noun used in a success toast after a transition — the SAME canonical
 * label the badge shows, not the raw enum value (AC-IXD-PROC-001).
 */
export function toastStateLabel(to: ProcurementStatus): string {
  return STATUS_LABEL[to as string] ?? (to as string);
}

/** Terminal statuses do not appear in an in-flight board stage. */
const TERMINAL_OFF_TRACK = new Set<string>(['Rejected', 'Cancelled']);

/**
 * The board stage index (0..5) for a status, or `-1` for terminal statuses.
 */
export function stageIndexForStatus(status: ProcurementStatus): number {
  const s = status as string;
  if (TERMINAL_OFF_TRACK.has(s)) return -1;
  return STATUS_TO_STAGE[s] ?? 0;
}

/**
 * StatusPill variant: Paid → won, Rejected/Cancelled → lost, Draft → draft, all
 * other in-flight statuses → `progress` (the quiet neutral pill).
 *
 * In-flight statuses use the neutral `progress` pill; their exact state text
 * carries the meaning, while the collection board provides stage grouping.
 */
export function pillVariantForStatus(status: ProcurementStatus): StatusVariant {
  const s = status as string;
  if (s === 'Paid') return 'won';
  if (TERMINAL_OFF_TRACK.has(s)) return 'lost';
  if (s === 'Draft') return 'draft';
  return 'progress';
}

/**
 * The badge/pill/crumb label for a status — the ONE canonical noun for that
 * state (AC-IXD-PROC-001). Reads `STATUS_LABEL` so the badge can never disagree
 * with the success toast or the button verb that reached the state.
 *
 * This is the per-status label (for example, Quote Selected remains Quote
 * Selected even though the collection board groups it with Vendor Quote).
 */
export function stageLabelForStatus(status: ProcurementStatus): string {
  const s = status as string;
  return STATUS_LABEL[s] ?? s;
}

/**
 * A plain-language description of the next useful step for an in-flight request.
 * This is explanatory copy only; legal transitions and available actions remain
 * owned by `LEGAL_TRANSITIONS` and the server-side gates.
 */
const NEXT_PROCUREMENT_STEP: Partial<Record<ProcurementStatus, string>> = {
  Draft: 'Submit request',
  Requested: 'Await approval',
  Approved: 'Request vendor quotes',
  'Vendor Quoted': 'Select quote',
  'Quote Selected': 'Prepare purchase order',
  Ordered: 'Record receipt',
  Received: 'Record vendor invoice',
  'Vendor Invoiced': 'Record payment',
};

/** The next-step description for a known non-terminal status, or `null` otherwise. */
export function nextProcurementStep(status: ProcurementStatus): string | null {
  return NEXT_PROCUREMENT_STEP[status] ?? null;
}

// ---------------------------------------------------------------------------
// AC-IXD-PROC-004 — the selected quotation that backs the "Selected quote" tile
// + the QuotationsSection row "Selected" pill (PROC-004 re-review).
// ---------------------------------------------------------------------------

type QuotationRow = Tables<'procurement_quotations'>;

/** The synced header fields the select-quote RPC writes — used as the flag-drift fallback. */
interface SelectedQuoteHeader {
  total_value: number | string | null;
  vendor_id: string | null;
}

/**
 * The chosen quotation for a PR — the single source of truth the "Selected quote" StatTile and
 * the QuotationsSection row marker both read, so the selection binds from the `Quote Selected`
 * state onward through Paid (AC-IXD-PROC-004), not only at Ordered/Paid.
 *
 * Resolution order:
 *  1. The quotation flagged `is_selected` (set by the `select_procurement_quote` RPC — the canonical
 *     signal). This is the normal path: selecting a quote sets the flag + syncs the header in one txn.
 *  2. FLAG-DRIFT FALLBACK — only when the PR is at-or-past `Quote Selected` (a quote IS committed by
 *     definition of the stage): the quotation whose amount + vendor match the synced header
 *     (`total_value` / `vendor_id`). This keeps the tile bound even if the flag is somehow absent
 *     (e.g. a legacy/seed/aborted-flow row), instead of silently reverting to "Pending".
 *  3. If at-or-past `Quote Selected` and a single quotation exists, that one.
 *
 * Returns `undefined` before `Quote Selected` (no quote committed yet) or when no quotation matches —
 * so the tile correctly stays "Pending" at `Vendor Quoted`.
 */
export function selectedQuotation(
  status: ProcurementStatus,
  quotations: QuotationRow[],
  header: SelectedQuoteHeader,
): QuotationRow | undefined {
  // 1. The flagged quote always wins, at any stage (the RPC's canonical signal).
  const flagged = quotations.find((q) => q.is_selected);
  if (flagged) return flagged;

  // Below the flag-drift fallback only applies once a quote is genuinely committed —
  // i.e. the PR has reached the VQ stage's selected sub-state or beyond (Quote Selected → Paid).
  // `Vendor Quoted` (idx 2 but not selected) and earlier carry NO committed quote.
  const committed =
    status !== 'Vendor Quoted' && stageIndexForStatus(status) >= stageIndexForStatus('Quote Selected' as ProcurementStatus);
  if (!committed) return undefined;

  // 2. Match the synced header (amount + vendor) the RPC wrote from the selected quote.
  const total = header.total_value == null ? null : Number(header.total_value);
  if (total != null) {
    const byHeader = quotations.find(
      (q) =>
        Number(q.total_amount) === total &&
        (header.vendor_id == null || q.vendor_id === header.vendor_id),
    );
    if (byHeader) return byHeader;
  }

  // 3. A single quotation on a committed PR is the selected one by elimination.
  return quotations.length === 1 ? quotations[0] : undefined;
}

/**
 * Navigates to the procurement's detail route (AC-NAV-006). With the workspace
 * tab layer removed, the row drill is a plain react-router navigate; the URL is
 * the single source of truth and the top-bar breadcrumb derives from it.
 * Mirrors `openOpportunity`.
 */
export function openPR(
  navigate: (path: string) => void,
  pr: { id: string },
): void {
  navigate(`/procurement/${pr.id}`);
}
