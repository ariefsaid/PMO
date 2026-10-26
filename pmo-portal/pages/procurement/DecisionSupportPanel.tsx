/**
 * AC-IXD-PROC-W5-2 / AC-RB-004..014 — DecisionSupportPanel
 *
 * Read-only budget-impact evidence within the ProcurementDetails review section.
 * Renders ONLY when p.project_id is set AND the case status
 * is pre-Ordered (Draft..Quote Selected) — ADR-0034 §6.
 *
 * Three budget layers (ADR-0034):
 *   • Budget    = useProjectBudget(projectId) — Σ Active budget-version line items.
 *   • Committed = useProjectCommittedSpend(projectId) — Σ PO total_value in
 *                 Ordered/Received/Vendor Invoiced/Paid (the EXACT basis the dashboards
 *                 use, 0009_dashboard_margin.sql). UNCHANGED by this feature.
 *   • Reserved  = useProjectReservedSpend(projectId) — Σ total_value in Approved/Vendor
 *                 Quoted/Quote Selected (approved, not yet ordered — "encumbrance").
 * No new RPC — three focused org-scoped reads.
 *
 * Available = Budget − Committed − Reserved (the over-commitment-safe headroom).
 *
 * The five figures (text-labelled, a11y: text-not-color-only per DESIGN.md §4):
 *   This request · Reserved (other) · Available · Project budget · After this request.
 * Over-budget is a non-blocking advisory (approval still permitted — OD-W5-4/OD-W5-5).
 *
 * Per-stage "After this request" math (ADR-0034 §5 — the double-count fix): when the
 * viewed case is itself already in Reserved (status ∈ Approved/Vendor Quoted/Quote
 * Selected), its value is already inside `reserved`, so After == Available (do NOT
 * subtract thisRequest again). Otherwise (Draft/Requested) After = Available − thisRequest.
 */
import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ErrBanner } from '@/src/components/ui/ErrBanner';
import { ProjectNameLink } from '@/src/components/ui/ProjectNameLink';
import { useProjectBudget } from '@/src/hooks/useBudget';
import { useProjectCommittedSpend, useProjectReservedSpend } from '@/src/hooks/useProcurements';
import { usePermission } from '@/src/auth/usePermission';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';
import { formatCurrency, formatNumber } from '@/src/lib/format';
import { computeBudgetSignal } from './computeBudgetSignal';

/** Pre-Ordered statuses where the panel is a live decision-support tool (ADR-0034 §6). */
const PANEL_VISIBLE_STATUSES: ProcurementStatus[] = [
  'Draft',
  'Requested',
  'Approved',
  'Vendor Quoted',
  'Quote Selected',
];

export interface DecisionSupportPanelProps {
  /** The procurement's project_id. Pass null/undefined to suppress the panel. */
  projectId: string | null | undefined;
  /** The procurement's total_value (this request's cost). */
  totalValue: number;
  /** Project display name (from DETAIL_SELECT join). */
  projectName: string | null | undefined;
  /** Contractual title behind a short `projectName`. */
  projectLegalName?: string | null;
  /** The case's current status — drives per-stage math + the visibility boundary. */
  status: ProcurementStatus;
  /** The procurement's own ISO-4217 currency (FR-L10N-020) — every figure here derives
   *  from `totalValue`/the project's budget rollups, which share this record's currency. */
  currency: string;
  /** The record Review can name this fact once beside its selected quote and PO amount. */
  showRequestValue?: boolean;
  /** The record scope already names the project; avoid repeating it in that context. */
  showProjectName?: boolean;
}

export const DecisionSupportPanel: React.FC<DecisionSupportPanelProps> = ({
  projectId,
  totalValue,
  projectName,
  projectLegalName,
  status,
  currency,
  showRequestValue = true,
  showProjectName = true,
}) => {
  const { t } = useTranslation();
  const headingId = React.useId();
  // Committed and Reserved sum every request on the project. A role that reads only the requests it
  // raised (Engineer, migration 0350) would get a partial sum and an overstated Available, so the
  // panel is not offered to it and its reads are not issued.
  const may = usePermission();
  const readsProjectWideSpend = may('view', 'procurement');
  const scopedProjectId = readsProjectWideSpend ? projectId : null;

  // Hooks must be called unconditionally; all are no-ops (enabled:false) when
  // the project id is falsy, so the early returns below are safe.
  const budget = useProjectBudget(scopedProjectId ?? '');
  const committed = useProjectCommittedSpend(scopedProjectId);
  const reservedQ = useProjectReservedSpend(scopedProjectId);

  // Bail out — no project linked (takes precedence over the status gate, FR-RB-020),
  // or a viewer whose purchasing read is limited to their own requests.
  if (!scopedProjectId) return null;

  // Bail out — post-Ordered / terminal: the panel is a pre-decision tool only, and
  // hiding it here makes the legacy double-count path structurally impossible.
  if (!PANEL_VISIBLE_STATUSES.includes(status)) return null;

  const heading = (
    <div className="mb-4 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 id={headingId} className="break-words text-xl font-bold text-foreground">
        {t('procurementDetail.budgetImpactWithCurrency', 'Budget impact · {{currency}}', { currency })}
      </h2>
      {showProjectName && projectName ? (
        <ProjectNameLink
          projectId={scopedProjectId}
          name={projectName}
          legalName={projectLegalName}
          className="break-words text-sm text-foreground"
        />
      ) : null}
    </div>
  );

  const isPending = budget.isPending || committed.isPending || reservedQ.isPending;
  const isError = budget.isError || committed.isError || reservedQ.isError;

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isPending) {
    return (
      <section className="min-w-0" aria-labelledby={headingId}>
        {heading}
        <div className="flex flex-col gap-2" role="status" aria-label={t('procurementDetail.loadingBudget', 'Loading budget impact')}>
          <div className="skel h-[18px] w-3/4" />
          <div className="skel h-[14px] w-1/2" />
        </div>
      </section>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <section className="min-w-0" aria-labelledby={headingId}>
        {heading}
        <p role="status" className="text-sm text-muted-foreground">
          {t('procurementDetail.budgetUnavailable', 'Budget unavailable — budget impact cannot be shown right now.')}
        </p>
      </section>
    );
  }

  const budgetAmount = budget.data ?? 0;

  // ── No active budget ───────────────────────────────────────────────────────
  if (budgetAmount === 0) {
    return (
      <section className="min-w-0" aria-labelledby={headingId}>
        {heading}
        <p role="status" className="text-sm text-muted-foreground">
          {t('procurementDetail.noActiveBudget', 'No active budget is set for this project — budget impact cannot be shown.')}
        </p>
      </section>
    );
  }

  // ── Figures (three layers, ADR-0034) ─────────────────────────────────────────
  // Interdependent budget math lives in the pure computeBudgetSignal helper so it is
  // independently unit-testable; this block is presentation-only.
  const committedSpend = committed.data ?? 0;
  const otherCurrencyCommitted = (committed.otherCurrencies ?? [])
    .map((position) => formatCurrency(position.amount, position.currency)).join(', ');
  const reserved = reservedQ.data ?? 0; // TOTAL reserved (incl. this case if applicable)
  const { available, afterRequest, otherReserved, overAvailable, overAvailableAmount, overBudgetReserved } =
    computeBudgetSignal({
      budget: budgetAmount,
      committed: committedSpend,
      reserved,
      totalValue,
      status,
    });
  const afterPct = budgetAmount > 0 ? (afterRequest / budgetAmount) * 100 : 0;
  const formattedHeadroom = formatNumber(Math.round(afterPct * 10) / 10);

  const facts = [
    ...(showRequestValue ? [{ label: t('procurementDetail.budget.request', 'This request'), value: formatNumber(totalValue) }] : []),
    {
      label: t('procurementDetail.budget.reserved', 'Reserved'),
      value: formatNumber(otherReserved),
      sub: t('procurementDetail.budget.reservedSub', 'approved, not yet ordered'),
    },
    {
      label: t('procurementDetail.budget.available', 'Available'),
      value: formatNumber(available),
      tone: available < 0 ? ('neg' as const) : undefined,
      // 0373: committed spend in another currency is not subtracted (no conversion); say so rather than hide it.
    },
    { label: t('procurementDetail.budget.projectBudget', 'Project budget'), value: formatNumber(budgetAmount) },
    {
      label: t('procurementDetail.budget.afterRequest', 'After this request'),
      value: formatNumber(afterRequest),
      // I4 (design-review): afterPct is headroom remaining (afterRequest/budget),
      // NOT utilization — labelled "% headroom remaining" for honest spend control.
      sub: t('procurementDetail.budget.headroomRemaining', '{{percent}}% headroom remaining', { percent: formattedHeadroom }),
      tone: afterRequest < 0 ? ('neg' as const) : undefined,
    },
  ];

  return (
    <section className="min-w-0" aria-labelledby={headingId}>
      {heading}
      <dl className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-4">
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0">
            <dt className="break-words text-xs font-semibold text-muted-foreground">{fact.label}</dt>
            <dd className={`mt-2 break-words text-sm font-normal tabular-nums ${fact.tone === 'neg' ? 'text-destructive-text' : 'text-foreground'}`}>
              {fact.value}
            </dd>
            {'sub' in fact && fact.sub && <p className="mt-2 break-words text-sm text-muted-foreground">{fact.sub}</p>}
          </div>
        ))}
      </dl>
      {otherCurrencyCommitted && (
        <p role="note" className="mt-4 break-words text-sm text-muted-foreground">
          {t('procurementDetail.budget.otherCurrencies', 'Not included in available budget: {{amounts}}', { amounts: otherCurrencyCommitted })}
        </p>
      )}

        {/* Over-available advisory — non-blocking and named in text; approval remains permitted. */}
        {overAvailable && (
          <ErrBanner
            className="mt-3 mb-0"
            title={t('procurementDetail.budget.overAvailable', 'Over available budget')}
            sub={
              <>
                {t('procurementDetail.budget.overAvailableSub', 'This request exceeds available budget by')}{' '}
                <strong className="tabular-nums">{formatNumber(overAvailableAmount)}</strong>.{' '}
                {t('procurementDetail.budget.advisoryOnly', 'Approval is still permitted — this is an advisory only.')}
              </>
            }
          />
        )}

        {/* Already-reserved + project over budget — no thisRequest advisory (it is
            already counted in Reserved); surface the over-budget condition instead. */}
        {overBudgetReserved && (
          <ErrBanner
            className="mt-3 mb-0"
            title={t('procurementDetail.budget.projectOverBudget', 'Project over budget')}
            sub={
              <>
                {t('procurementDetail.budget.projectOverBudgetSub', 'This project is over budget by')}{' '}
                <strong className="tabular-nums">{formatNumber(-available)}</strong> across committed
                {t('procurementDetail.budget.projectOverBudgetDetail', ' across committed and reserved demand. This is an advisory only.')}
              </>
            }
          />
        )}

        {/* Explicit affordance to drill into the project budget detail.
            Styled as a quiet link (not a competing CTA) — the decision zone
            primary action owns the blue; this is a secondary navigation escape. */}
        <div className="mt-4 border-t border-border pt-4">
          <Link
            to={`/projects/${scopedProjectId}`}
            className="inline-flex min-h-11 items-center gap-1 text-sm text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring underline-offset-4"
          >
            {t('procurementDetail.budget.openProject', 'Open project')}
          </Link>
        </div>
    </section>
  );
};
