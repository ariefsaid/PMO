import type { StatusVariant, LifecycleStep } from '@/src/components/ui';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';
import type { Tables } from '@/src/lib/supabase/database.types';

/**
 * IA-3 procurement lifecycle model (master plan §4.2; Wave-1 Area-5 tasks 22-24).
 * Six visible stages — PR → VQ → PO → GR → VI → Paid — collapse the eleven-value
 * `procurements.status` enum into the operator-facing journey shown in the table
 * pips, the by-stage board, and the detail-page node stepper.
 *
 * **Approval is a GATE, not a stage** (owner directive 2026-06-21, reversing the
 * prior PROC-002 "Approved is its own node" decision). An approval is a quality
 * gate that sits across the PR step — it does not mint a document and is not a
 * place a request "rests". So there is NO Approved node. But approval must still
 * be VISIBLE (the original PROC-002 concern — an Approve must not leave the bar
 * stuck on step 1): we make it visible by **advancing the bar on approval** — at
 * status `Approved` the PR node is `done` and the Vendor-Quote node is `current`
 * (VQ is the next action even though no quote exists yet). The status pill
 * ("Approved" vs "Vendor Quote") differentiates the two PR-done/VQ-current states.
 *
 * Other rule (unchanged): **Quote Selected folds into the Vendor-Quote node**
 * (PROC-003), not the PO node. Selecting a quote no longer pre-jumps the badge to
 * "Purchase Order" before a PO genuinely exists; the PO node is reached only at
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
  /** Full stage name (detail node label / status pill text). */
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
 * Maps every in-flight `procurements.status` to its 0-based stage index.
 * Draft/Requested → PR (0); **Approved advances the bar to the VQ node** (1 — the
 * approval gate moves the journey on to its next action, it is not its own node);
 * Vendor Quoted AND Quote Selected → the VQ node (1, PROC-003 — no PO pre-jump);
 * Ordered → PO (2).
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

/**
 * Statuses whose canonical user-facing label (AC-IXD-PROC-001) IS the honest name
 * of the stage NODE they currently occupy — so when they are the active step, the
 * current node renames to that status label instead of the generic stage name.
 *
 * `Quote Selected` qualifies: it sits on the VQ node (PROC-003) and "Quote
 * Selected" is the honest sub-state of that node. `Approved` does NOT qualify: it
 * occupies the VQ node only because approval ADVANCED the bar to the next action
 * — the VQ node must stay labelled "Vendor Quote", never "Approved" (that would
 * mislabel the node for a request that has no quote yet).
 */
const STATUS_RENAMES_CURRENT_NODE = new Set<string>(['Quote Selected']);

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

/** Terminal off-track statuses — no stage position (the lifecycle was abandoned). */
const TERMINAL_OFF_TRACK = new Set<string>(['Rejected', 'Cancelled']);

/**
 * The stage index (0..5) for a status, or `-1` for the terminal off-track
 * statuses (Rejected / Cancelled) which never reach a lifecycle node.
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
 * I1 fix: the list pill shows each record's OWN stage (not a board column), so
 * there is no single "active" stage to render blue — collapsing every in-flight
 * status to the blue `open` produced three identical blue pills (Purchase
 * Request / Vendor Quote / Purchase Order). They are now neutral `progress`,
 * differentiated from each other by their distinct `stageLabelForStatus` label
 * and the row's lifecycle pip stepper (color-not-only). The blue `open` variant
 * is retained for surfaces with a genuine single active item (e.g. sales).
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
 * Note: this is the per-STATUS label (e.g. Quote Selected → "Quote Selected"),
 * which is intentionally distinct from the macro stage NODE's full name (Quote
 * Selected shares the Vendor-Quote node for stepper position, PROC-003, but the
 * pill still reads the honest status the user transitioned to).
 */
export function stageLabelForStatus(status: ProcurementStatus): string {
  const s = status as string;
  return STATUS_LABEL[s] ?? s;
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
  // i.e. the PR has reached the VQ node's selected sub-state or beyond (Quote Selected → Paid).
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

/** The reached doc references, keyed by stage, read from the procurement record. */
export interface DocRefs {
  pr_number?: string | null;
  vq_number?: string | null;
  po_number?: string | null;
  gr_number?: string | null;
  vi_number?: string | null;
}

/**
 * Builds the six-step lifecycle for the LifecycleStepper (node + inline variants).
 * Stages before the current index are `done`, the current is `current`, later are
 * `upcoming`. A Paid procurement marks the whole track done + the final node `paid`;
 * a terminal off-track procurement (Rejected/Cancelled) marks PR `current` and the
 * rest `skipped` (the lifecycle was abandoned). Doc refs decorate reached nodes.
 * Approval is a gate (no node) — it advances an `Approved` request to PR=done,
 * VQ=current (visible on the bar; see the module header).
 */
export function lifecycleSteps(status: ProcurementStatus, refs?: DocRefs): LifecycleStep[] {
  const idx = stageIndexForStatus(status);
  const s = status as string;
  // Aligned to PR_STAGES: PR · VQ · PO · GR · VI · Paid.
  const refByStage: (string | null | undefined)[] = [
    refs?.pr_number,
    refs?.vq_number,
    refs?.po_number,
    refs?.gr_number,
    refs?.vi_number,
    undefined, // Paid node carries no minted doc ref
  ];

  if (s === 'Paid') {
    return PR_STAGES.map((st, i) => ({
      label: st.full,
      state: i === PR_STAGES.length - 1 ? 'paid' : 'done',
      ref: refByStage[i] ?? undefined,
    }));
  }

  if (TERMINAL_OFF_TRACK.has(s)) {
    return PR_STAGES.map((st, i) => ({
      label: st.full,
      state: i === 0 ? 'current' : 'skipped',
      ref: i === 0 ? (refByStage[0] ?? undefined) : undefined,
    }));
  }

  return PR_STAGES.map((st, i) => {
    const state: LifecycleStep['state'] = i < idx ? 'done' : i === idx ? 'current' : 'upcoming';
    // PROC-001: the ACTIVE node names the SAME canonical state the badge + toast show — BUT only
    // when that status canonically belongs to this node. 'Quote Selected' does (PROC-003: it is the
    // honest sub-state of the VQ node → the current node reads "Quote Selected"). 'Approved' does
    // NOT — it occupies the VQ node only because the approval gate advanced the bar, so the node
    // must stay "Vendor Quote" (never "Approved" for a request with no quote yet).
    const label =
      state === 'current' && STATUS_RENAMES_CURRENT_NODE.has(s) ? stageLabelForStatus(status) : st.full;
    return {
      label,
      state,
      ref: i <= idx ? (refByStage[i] ?? undefined) : undefined,
    };
  });
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
