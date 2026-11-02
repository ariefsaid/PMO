import type { PipelineProject } from '@/src/lib/db/dashboard';
import type { StatusVariant } from '@/src/components/ui';
import type { LifecycleStep } from '@/src/components/ui';
import type { ListName } from '@/src/lib/listWorkingSet';
import {
  PIPELINE_STATUSES,
  LOST_STATUSES,
  ON_HAND_STATUSES,
  LEGAL_PROJECT_TRANSITIONS,
  projectStatusGroup,
  type ProjectStatus,
} from '@/src/lib/db/projectTransitions';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import { formatPercent as formatLocalizedPercent, formatDayMonth } from '@/src/lib/format';
import { OPEN_BID_STATUSES, STALE_BID_THRESHOLD_DAYS } from '@/src/lib/dashboardConstants';

/**
 * Kanban column model (OD-SP-1 / FR-SPD-014). Seven columns in fixed order: the five open
 * pipeline stages plus TWO terminal columns — "Won" (on-hand) and "Lost" (lost).
 *
 * Model B (ADR-0020, AC-IXD-PROJ-007): the previously-combined "Won / Lost" terminal column is
 * split so a Loss Tender deal is reachable as its OWN terminal "Lost" column (sales win/loss
 * history) — lost deals stay in the Pipeline (not the active Projects list), and the dedicated
 * column makes them visible without clipping.
 *
 * Batch-3 polish: open-stage dots are a calm, consistent neutral treatment so the
 * pipeline's categorical markers do not compete with the page's primary action.
 * Terminal Won/Lost keep their outcome colors. Every dot is an `hsl(var(--…))` token.
 */
export interface SalesColumn {
  /** Display title (English default; may differ from the enum, e.g. "Pre-Qual"). Translated on the
   *  board via `useSalesStageLabel()` keyed by `testId` — the enum itself never changes. */
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

/**
 * The five open (non-terminal) funnel stages, in staleness order, as a literal
 * tuple. The SALES_COLUMNS board and the list-return working-set codec both draw
 * the open-stage set from here so a new stage stays in sync across list URLs and
 * the funnel. `satisfies` keeps it a literal rather than widening to string[].
 */
export const OPEN_FUNNEL_STAGES = [
  'Leads',
  'PQ Submitted',
  'Quotation Submitted',
  'Tender Submitted',
  'Negotiation',
] as const satisfies readonly string[];
export type OpenFunnelStage = (typeof OPEN_FUNNEL_STAGES)[number];

/** Board titles for the open stages (may differ from the enum, e.g. "Pre-Qual"). */
const OPEN_STAGE_TITLES: Record<OpenFunnelStage, string> = {
  Leads: 'Leads',
  'PQ Submitted': 'Pre-Qual',
  'Quotation Submitted': 'Quotation',
  'Tender Submitted': 'Tender',
  Negotiation: 'Negotiation',
};

export const SALES_COLUMNS: readonly SalesColumn[] = [
  // Open stages come from OPEN_FUNNEL_STAGES; their dots are a quiet neutral (Batch-3 polish).
  ...OPEN_FUNNEL_STAGES.map((stage) => ({
    title: OPEN_STAGE_TITLES[stage],
    statuses: [stage],
    dotColor: 'hsl(var(--muted-foreground))',
    testId: `stage-${stage}`,
  })),
  {
    title: 'Won',
    statuses: [...ON_HAND_STATUSES],
    dotColor: 'hsl(var(--success))',
    testId: 'stage-Won',
    terminal: true,
  },
  {
    title: 'Lost',
    statuses: [...LOST_STATUSES],
    dotColor: 'hsl(var(--destructive))',
    testId: 'stage-Lost',
    terminal: true,
  },
] as const;

/** What dropping a deal on a board column means (DND, #1637). Derived from the status menu's rule source only. */
export type ProjectDropResolution =
  | { kind: 'noop' }
  | { kind: 'refused' }
  | { kind: 'target'; to: ProjectStatus }
  | { kind: 'choice'; options: ProjectStatus[] };

export function resolveProjectDrop(status: ProjectStatus, column: SalesColumn): ProjectDropResolution {
  if (column.statuses.includes(status as string)) return { kind: 'noop' };
  const legal = (LEGAL_PROJECT_TRANSITIONS[status as string] ?? []).filter((s) => column.statuses.includes(s)) as ProjectStatus[];
  if (legal.length === 0) return { kind: 'refused' };
  if (legal.length === 1) return { kind: 'target', to: legal[0] };
  return { kind: 'choice', options: legal };
}

/**
 * Aging threshold in days. A pipeline deal untouched for >= 30 days is flagged as
 * "needs attention". Applied to any row that carries `last_update`.
 *
 * DATA AVAILABILITY: `last_update` is now supplied for BOTH open pipeline rows
 * (get_sales_pipeline() projects it — migration 0020, AC-IXD-PIPE-W5-C5) AND lost
 * deals (useLostDeals, full projects row). So the attention filter spans open ∪ lost.
 * A row that genuinely lacks `last_update` (defensive only) returns false — no false
 * positive from missing data, per the honest-dashboard rule.
 */
export const ATTENTION_THRESHOLD_DAYS = 30;

/** An open bid is stale after 90 days without a move to a new pipeline stage. */
export function isStaleBid(
  project: Pick<PipelineProject, 'status' | 'stage_started_at'>,
): boolean {
  if (!OPEN_BID_STATUSES.has(project.status as string)) return false;
  const ageInDays = daysSince(project.stage_started_at);
  return ageInDays !== null && ageInDays >= STALE_BID_THRESHOLD_DAYS;
}

/**
 * Returns the number of days since the given ISO timestamp, or null if the
 * timestamp is absent. Used for both display ("X days ago") and the attention gate.
 */
export function daysSince(isoTs: string | undefined | null): number | null {
  if (!isoTs) return null;
  const ms = Date.now() - new Date(isoTs).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/**
 * Returns true if the row qualifies as "needs attention": `last_update` is present
 * AND the days-since exceeds the threshold. Rows without `last_update` return false
 * (honest — no data, no false flag, per the honest-dashboard rule).
 */
export function isNeedsAttention(p: Pick<PipelineProject, 'last_update'>): boolean {
  const d = daysSince(p.last_update);
  return d !== null && d >= ATTENTION_THRESHOLD_DAYS;
}

/** Weighted forecast value (computed client-side per Director decision 1). */
export function weightedValue(p: Pick<PipelineProject, 'contract_value' | 'win_probability'>): number {
  return p.contract_value * p.win_probability;
}

/**
 * StatusPill variant for a project status (ADR-0029).
 *
 * Delegates to the CW-2 registry `workflowVariant` — the single authority for
 * every status tint. The previous group-based derivation was retired so this
 * helper and `pillVariantForProjectStatus` can never drift from the registry.
 *
 * Per the Freed-Blue Status Rule, no status pill may use the action-blue (`open`);
 * in-pipeline (pre-win) statuses are neutral grey `draft` — the distinct stage
 * LABEL carries identity, not colour.
 */
export function pillVariantForStatus(status: PipelineProject['status']): StatusVariant {
  return workflowVariant(status);
}

/** Whole-number percent label from an RPC win_probability fraction. */
export function formatPercent(probability: number): string {
  return formatLocalizedPercent(probability, 0);
}

/**
 * Opens the deal's canonical detail route. Model B (ADR-0020): a project/opportunity has ONE
 * detail URL, `/projects/:id`, at every stage — so a pipeline drill goes to the same place the
 * Projects list does, and the stage-adaptive lens picks the pipeline view pre-win. The URL is the
 * single source of truth and the top-bar breadcrumb derives from it.
 *
 * list-working-set-return (#682, AC-LRC-004): `open` is `useListReturn({list:'sales'}).openRecord`
 * — the shared seam that captures the current Sales list URL + scroll position as validated
 * return context. The explicit `'projects'` owner stamps that context onto the PROJECT record (a
 * Sales list may open a Projects record; see `canCaptureFromList`), so only the project's
 * PipelineLens Sales link can read it back — the structural Projects breadcrumb/BackBar never do.
 */
export function openOpportunity(
  open: (path: string, owner?: ListName) => boolean,
  project: Pick<PipelineProject, 'id'>,
): void {
  open(`/projects/${project.id}`, 'projects');
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
  const labels = ['Leads', 'Pre-Qualification', 'Quotation', 'Tender', 'Negotiation'];

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

/** #1638 — key-date label per stage: [i18n key, English default]. Spec §3. */
export const STAGE_KEY_DATE_LABEL: Record<string, readonly [string, string]> = {
  'Leads': ['sales:stageDate.lead', 'Lead'],
  'PQ Submitted': ['sales:stageDate.pq', 'Pre-qual sent'],
  'Quotation Submitted': ['sales:stageDate.quoted', 'Quoted'],
  'Tender Submitted': ['sales:stageDate.tender', 'Tender sent'],
  'Negotiation': ['sales:stageDate.negotiation', 'Negotiation'],
  'Won, Pending KoM': ['sales:stageDate.signed', 'Signed'],
  'Loss Tender': ['sales:stageDate.lost', 'Lost'],
  'Declined': ['sales:stageDate.declined', 'Declined'],
  'Ongoing Project': ['sales:stageDate.started', 'Started'],
  'On Hold': ['sales:stageDate.onHold', 'On hold'],
  'Close Out': ['sales:stageDate.closedOut', 'Closed out'],
  'Internal Project': ['sales:stageDate.internal', 'Internal'],
};

/** Whole calendar days from `fromIso` to `toIso` (both 'YYYY-MM-DD'); 0 when from is after to. */
export function daysBetweenDates(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

type Translate = (key: string, defaultValue: string) => string;

/**
 * A 'YYYY-MM-DD' calendar date as "12 Oct". formatDayMonth formats in the BROWSER's timezone, so the Date must be
 * local midnight — `T00:00:00Z` would print the day before in any browser west of UTC (spec T15).
 */
export function formatIsoDayMonth(iso: string): string {
  return formatDayMonth(new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
}

/** The card's one line for the latest stage entry: "Quoted 12 Oct · 20 d" (FR-PSH-013). */
export function stageLine(status: string, enteredOn: string, todayIso: string, t: Translate): string {
  const [key, fallback] = STAGE_KEY_DATE_LABEL[status] ?? ['', status];
  const label = key ? t(key, fallback) : fallback;
  const day = enteredOn.slice(0, 10);
  return `${label} ${formatIsoDayMonth(day)} · ${daysBetweenDates(day, todayIso)} ${t('sales:stageDate.daysShort', 'd')}`;
}
