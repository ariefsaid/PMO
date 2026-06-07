import type { PipelineProject } from '@/src/lib/db/dashboard';
import type { StatusVariant } from '@/src/components/ui';
import type { LifecycleStep } from '@/src/components/ui';
import {
  PIPELINE_STATUSES,
  LOST_STATUSES,
  ON_HAND_STATUSES,
  projectStatusGroup,
} from '@/src/lib/db/projectTransitions';

/**
 * IA-3 Kanban column model (OD-SP-1 / FR-SPD-014). Six columns in fixed order:
 * the five open pipeline stages plus ONE terminal Won/Lost column (Director
 * decision 7).
 *
 * C2 de-rainbow (2026-06-07): the per-stage dots are now a calm
 * neutral-progression — upstream open stages are `muted-foreground`, the
 * closest-to-close open stage (Negotiation, the "active" stage) carries the one
 * blue `primary` accent (One Blue Rule), and the terminal Won/Lost is `success`.
 * The off-palette cyan (Quotation) and orange (Negotiation) — which mapped to NO
 * DESIGN.md token — are deleted, as is the categorical violet on Pre-Qual
 * (categorical violet is not a stage-progression device). Every dot is now an
 * `hsl(var(--…))` token; this collapses Open Q4 ("promote stage-* to tokens") —
 * the rainbow was the thing being removed, so distinct per-stage hues are moot.
 */
export interface SalesColumn {
  /** Display title (may differ from the enum, e.g. "Pre-Qual"). */
  title: string;
  /** The project status enum value(s) this column collects. */
  statuses: string[];
  /** Stage-dot color — a DESIGN.md `hsl(var(--…))` token (neutral / primary / success). */
  dotColor: string;
  /** e2e test id hook (AC-1117 preserves `stage-Tender Submitted`). */
  testId: string;
  /** True for the terminal Won/Lost column (excluded from funnel + weighted totals). */
  terminal?: boolean;
}

export const SALES_COLUMNS: readonly SalesColumn[] = [
  {
    title: 'Leads',
    statuses: ['Leads'],
    dotColor: 'hsl(var(--muted-foreground))',
    testId: 'stage-Leads',
  },
  {
    title: 'Pre-Qual',
    statuses: ['PQ Submitted'],
    dotColor: 'hsl(var(--muted-foreground))', // quiet upstream (was categorical violet)
    testId: 'stage-PQ Submitted',
  },
  {
    title: 'Quotation',
    statuses: ['Quotation Submitted'],
    dotColor: 'hsl(var(--muted-foreground))', // quiet upstream (was off-palette cyan)
    testId: 'stage-Quotation Submitted',
  },
  {
    title: 'Tender',
    statuses: ['Tender Submitted'],
    dotColor: 'hsl(var(--muted-foreground))', // quiet upstream (was categorical warning hue)
    testId: 'stage-Tender Submitted',
  },
  {
    title: 'Negotiation',
    statuses: ['Negotiation'],
    dotColor: 'hsl(var(--primary))', // the one active (closest-to-close) open stage
    testId: 'stage-Negotiation',
  },
  {
    title: 'Won / Lost',
    statuses: [...ON_HAND_STATUSES, ...LOST_STATUSES],
    dotColor: 'hsl(var(--success))',
    testId: 'stage-Won-Lost',
    terminal: true,
  },
] as const;

/** Weighted forecast value (computed client-side per Director decision 1). */
export function weightedValue(p: Pick<PipelineProject, 'contract_value' | 'win_probability'>): number {
  return p.contract_value * p.win_probability;
}

/** StatusPill variant for a project status, via the OD-SP-1 group. */
export function pillVariantForStatus(status: PipelineProject['status']): StatusVariant {
  const group = projectStatusGroup(status);
  if (group === 'onHand') return 'won';
  if (group === 'lost') return 'lost';
  return 'open';
}

/** Whole-number percent label from an RPC win_probability fraction. */
export function formatPercent(probability: number): string {
  return `${Math.round(probability * 100)}%`;
}

/**
 * Navigates to the opportunity's detail route (AC-NAV-006). With the workspace
 * tab layer removed, the row drill is a plain react-router navigate — the URL is
 * the single source of truth and the top-bar breadcrumb derives from it.
 */
export function openOpportunity(
  navigate: (path: string) => void,
  project: Pick<PipelineProject, 'id'>,
): void {
  navigate(`/sales/${project.id}`);
}

/**
 * The deal-stage journey for the detail page's LifecycleStepper (AC-SP-208).
 * Six steps: the five pipeline stages + a terminal node. Stages before the deal's
 * current status are `done`, the current is `current`, later are `upcoming`. A won
 * deal marks every pipeline step done + the terminal `paid`; a lost deal marks the
 * terminal `skipped`. Derived from `PIPELINE_STATUSES` (single source).
 */
export function dealJourneySteps(status: PipelineProject['status']): LifecycleStep[] {
  const group = projectStatusGroup(status);
  const labels = ['Leads', 'Pre-Qual', 'Quotation', 'Tender', 'Negotiation'];

  if (group === 'onHand') {
    return [
      ...labels.map((label): LifecycleStep => ({ label, state: 'done' })),
      { label: 'Won', state: 'paid' },
    ];
  }
  if (group === 'lost') {
    return [
      ...labels.map((label): LifecycleStep => ({ label, state: 'done' })),
      { label: 'Lost', state: 'skipped' },
    ];
  }

  const currentIdx = PIPELINE_STATUSES.indexOf(status as string);
  return [
    ...labels.map((label, i): LifecycleStep => {
      if (i < currentIdx) return { label, state: 'done' };
      if (i === currentIdx) return { label, state: 'current' };
      return { label, state: 'upcoming' };
    }),
    { label: 'Won', state: 'upcoming' },
  ];
}
