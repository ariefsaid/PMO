import type { PipelineProject } from '@/src/lib/db/dashboard';
import type { WorkspaceContextValue } from '@/src/components/shell';
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
 * decision 7). Each `dotColor` is a non-interactive categorical literal HSL,
 * sanctioned by master-plan §5 (the only literals permitted on this surface —
 * flagged for promotion to `stage-*` tokens, Open Q4). They never read as the
 * action blue (One Blue Rule).
 */
export interface SalesColumn {
  /** Display title (may differ from the enum, e.g. "Pre-Qual"). */
  title: string;
  /** The project status enum value(s) this column collects. */
  statuses: string[];
  /** Categorical stage-dot color (sanctioned literal / token). */
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
    dotColor: 'hsl(262 83% 58%)', // categorical violet
    testId: 'stage-PQ Submitted',
  },
  {
    title: 'Quotation',
    statuses: ['Quotation Submitted'],
    dotColor: 'hsl(199 89% 48%)', // categorical cyan (mockup STAGES)
    testId: 'stage-Quotation Submitted',
  },
  {
    title: 'Tender',
    statuses: ['Tender Submitted'],
    dotColor: 'hsl(43 96% 56%)', // warning hue, categorical use
    testId: 'stage-Tender Submitted',
  },
  {
    title: 'Negotiation',
    statuses: ['Negotiation'],
    dotColor: 'hsl(25 95% 53%)', // categorical orange (mockup STAGES)
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
 * Opens (or refocuses) the opportunity's workspace record tab with its HUMAN
 * label (AC-SP-207). Passing `project.name` means the reducer stores it; a later
 * synthetic URL re-open (Back/Forward) will not overwrite it. Re-opening the same
 * deal refocuses the existing tab.
 */
export function openOpportunity(
  ws: Pick<WorkspaceContextValue, 'openRecord'>,
  project: Pick<PipelineProject, 'id' | 'name'>,
): void {
  ws.openRecord({
    id: `sales:${project.id}`,
    kind: 'record',
    path: `/sales/${project.id}`,
    icon: 'pipe',
    label: project.name,
    code: project.id,
    module: 'sales',
  });
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
