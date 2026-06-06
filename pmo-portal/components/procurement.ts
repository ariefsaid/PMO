import type { WorkspaceContextValue } from '@/src/components/shell';
import type { StatusVariant, LifecycleStep } from '@/src/components/ui';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';

/**
 * IA-3 procurement lifecycle model (master plan §4.2). Six visible stages —
 * PR → VQ → PO → GR → VI → Paid — collapse the eleven-value `procurements.status`
 * enum into the operator-facing journey shown in the table pips, the by-stage
 * board, and the detail-page node stepper. The request sub-states (Draft /
 * Requested / Approved) all live under the "PR" stage; PO covers Quote Selected
 * and Ordered. This is presentation only — `LEGAL_TRANSITIONS` and the RPC stay
 * the single source of truth for what may actually move (never re-derived here).
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

/** Maps every in-flight `procurements.status` to its 0-based stage index. */
const STATUS_TO_STAGE: Record<string, number> = {
  Draft: 0,
  Requested: 0,
  Approved: 0,
  'Vendor Quoted': 1,
  'Quote Selected': 2,
  Ordered: 2,
  Received: 3,
  'Vendor Invoiced': 4,
  Paid: 5,
};

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

/** StatusPill variant: Paid → won, Rejected/Cancelled → lost, Draft → draft, else open. */
export function pillVariantForStatus(status: ProcurementStatus): StatusVariant {
  const s = status as string;
  if (s === 'Paid') return 'won';
  if (TERMINAL_OFF_TRACK.has(s)) return 'lost';
  if (s === 'Draft') return 'draft';
  return 'open';
}

/**
 * Human stage label for a status pill / crumb: "Paid" at the end, the raw
 * terminal status for off-track ones, otherwise the current stage's full name.
 */
export function stageLabelForStatus(status: ProcurementStatus): string {
  const s = status as string;
  if (s === 'Paid') return 'Paid';
  if (TERMINAL_OFF_TRACK.has(s)) return s;
  const idx = stageIndexForStatus(status);
  return PR_STAGES[idx]?.full ?? s;
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
 */
export function lifecycleSteps(status: ProcurementStatus, refs?: DocRefs): LifecycleStep[] {
  const idx = stageIndexForStatus(status);
  const s = status as string;
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
    return {
      label: st.full,
      state,
      ref: i <= idx ? (refByStage[i] ?? undefined) : undefined,
    };
  });
}

/**
 * Opens (or refocuses) the procurement's workspace record tab with its HUMAN
 * label (master plan §4.2 tab integration). The PR ref is the mono code badge;
 * re-opening the same PR refocuses the existing tab. Mirrors `openOpportunity`.
 */
export function openPR(
  ws: Pick<WorkspaceContextValue, 'openRecord'>,
  pr: { id: string; title: string; code?: string | null },
): void {
  ws.openRecord({
    id: `procurement:${pr.id}`,
    kind: 'record',
    path: `/procurement/${pr.id}`,
    icon: 'cart',
    label: pr.title,
    code: pr.code ?? pr.id.slice(0, 7),
    module: 'procurement',
  });
}
