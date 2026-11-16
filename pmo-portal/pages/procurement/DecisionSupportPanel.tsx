/**
 * AC-IXD-PROC-W5-2 / AC-RB-004..014 — DecisionSupportPanel
 *
 * A read-only budget-impact card placed in the evidence zone of ProcurementDetails,
 * directly under StatTiles. Renders ONLY when p.project_id is set AND the case status
 * is pre-Ordered (Draft..Quote Selected) — ADR-0034 §6.
 *
 * Three budget layers (ADR-0034):
 *   • Budget    = useProjectBudget(projectId) — Σ Active budget-version line items.
 *   • Committed = useProjectCommittedSpend(projectId) — the project-currency open
 *                 commitment position, with ERP ledger treatment per ADR-0093.
 *   • Reserved  = useProjectReservedSpend(projectId) — Σ total_value in Approved/Vendor
 *                 Quoted/Quote Selected (approved, not yet ordered — "encumbrance").
 * Three focused org-scoped reads.
 *
 * Available = Budget − Committed − Reserved (the over-commitment-safe headroom).
 *
 * The figures (text-labelled, a11y: text-not-color-only per DESIGN.md §4):
 *   This request · Reserved (other) · Not yet committed to purchases · Budget used · Project budget ·
 *   After this request.
 * "Not yet committed to purchases" is the policy figure above (Available) and says it leaves out recorded
 * spending; "Budget used" is the project's canonical reading (the same shared positions read the project
 * header uses, no sum of its own) so the approver sees both beside each other.
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
import { Card, CardPad } from '@/src/components/ui/Card';
import { StatTiles } from '@/src/components/ui/StatTiles';
import { ErrBanner } from '@/src/components/ui/ErrBanner';
import { useFigureReport } from '@/src/components/ui/useFigureScope';
import { ProjectNameLink } from '@/src/components/ui/ProjectNameLink';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { useProjectBudget } from '@/src/hooks/useBudget';
import { useProjectBudgetPositions } from '@/src/hooks/useProjectBudgetPositions';
import { PIPELINE_STATUSES } from '@/src/lib/db/projectTransitions';
import { projectBudgetUsedPercent } from '@/src/lib/projectFinances';
import { useProjectCommittedSpend, useProjectReservedSpend } from '@/src/hooks/useProcurements';
import { usePermission } from '@/src/auth/usePermission';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';
import { formatCurrency, formatNumberExact } from '@/src/lib/format';
import { computeBudgetSignal } from './computeBudgetSignal';
import { AT_RISK_THRESHOLD } from '@/src/lib/dashboardConstants';

/** Pre-Ordered statuses where the panel is a live decision-support tool (ADR-0034 §6). */
const PANEL_VISIBLE_STATUSES: ProcurementStatus[] = [
  'Draft',
  'Requested',
  'Approved',
  'Vendor Quoted',
  'Quote Selected',
];

const UnavailableComparison: React.FC<{ reason: string }> = ({ reason }) => {
  const inFigureScope = useFigureReport([{ label: 'Budget comparison', reason }]);
  return inFigureScope ? null : <p className="text-control text-muted-foreground">{reason}</p>;
};

export interface DecisionSupportPanelProps {
  /** The procurement's project_id. Pass null/undefined to suppress the panel. */
  projectId: string | null | undefined;
  /** The procurement's total_value (this request's cost). */
  totalValue: number;
  /** Project display name (from DETAIL_SELECT join). */
  projectName: string | null | undefined;
  /** Contractual title behind a short `projectName`. */
  projectLegalName?: string | null;
  /** The project's own status; a project still in the pipeline (not won yet) names its stage at the heading. */
  projectStatus?: string | null;
  /** The approvals inbox row is tight: the purchasing figure's caption moves into its label's tooltip. */
  captionInTooltip?: boolean;
  /** The case's current status — drives per-stage math + the visibility boundary. */
  status: ProcurementStatus;
  /** The procurement's own ISO-4217 currency. */
  currency: string;
}

export const DecisionSupportPanel: React.FC<DecisionSupportPanelProps> = ({
  projectId,
  totalValue,
  projectName,
  projectLegalName,
  projectStatus,
  captionInTooltip = false,
  status,
  currency,
}) => {
  const { t } = useTranslation('procurement');
  // Committed and Reserved sum every request on the project. A role that reads only the requests it
  // raised (Engineer, migration 0350) would get a partial sum and an overstated Available, so the
  // panel is not offered to it and its reads are not issued.
  const may = usePermission();
  const readsProjectWideSpend = may('view', 'procurement');
  // A status the panel hides renders nothing, so its three budget reads are not issued either (#2107).
  const scopedProjectId = readsProjectWideSpend && PANEL_VISIBLE_STATUSES.includes(status) ? projectId : null;

  // Hooks must be called unconditionally; all are no-ops (enabled:false) when
  // the project id is falsy, so the early returns below are safe.
  const budget = useProjectBudget(scopedProjectId ?? '');
  const committed = useProjectCommittedSpend(scopedProjectId);
  const reservedQ = useProjectReservedSpend(scopedProjectId);
  // The canonical Budget used reading is shown beside the purchasing figure; it never holds the panel back.
  const positions = useProjectBudgetPositions(scopedProjectId ? [scopedProjectId] : []);

  // Bail out — no project linked (takes precedence over the status gate, FR-RB-020),
  // or a viewer whose purchasing read is limited to their own requests.
  if (!scopedProjectId) return null;

  // Bail out — post-Ordered / terminal: the panel is a pre-decision tool only, and
  // hiding it here makes the legacy double-count path structurally impossible.
  if (!PANEL_VISIBLE_STATUSES.includes(status)) return null;

  const heading = (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-1 gap-y-1">
      <h2 className="text-control font-semibold text-muted-foreground">
        {t('decisionSupport.heading', 'Budget impact')}
      </h2>
      {projectName ? (
        <ProjectNameLink
          projectId={scopedProjectId}
          name={projectName}
          legalName={projectLegalName}
          className="text-control font-medium text-foreground"
        />
      ) : null}
      {projectStatus && PIPELINE_STATUSES.includes(projectStatus) ? (
        <StatusPill record="project" state={projectStatus} wrap={false} className="ml-1" />
      ) : null}
    </div>
  );

  const isPending = budget.isPending || committed.isPending || reservedQ.isPending;
  const isError = budget.isError || committed.isError || reservedQ.isError;

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isPending) {
    return (
      <Card className="mb-4">
        <CardPad>
          {heading}
          <div className="flex flex-col gap-2" aria-label="Loading budget impact">
            <div className="skel h-[18px] w-3/4" />
            <div className="skel h-[14px] w-1/2" />
          </div>
        </CardPad>
      </Card>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <Card className="mb-4">
        <CardPad>
          {heading}
          <p className="text-control text-muted-foreground">
            Budget unavailable — budget impact can&apos;t be shown right now.
          </p>
        </CardPad>
      </Card>
    );
  }

  const budgetAmount = budget.data ?? 0;

  // ── No active budget ───────────────────────────────────────────────────────
  if (budgetAmount === 0) {
    return (
      <Card className="mb-4">
        <CardPad>
          {heading}
          <p className="text-control text-muted-foreground">
            No active budget set for this project — budget impact can&apos;t be shown.
          </p>
        </CardPad>
      </Card>
    );
  }

  const projectCurrency = reservedQ.projectCurrency;
  const budgetCurrency = reservedQ.budgetCurrency;
  // #1354: the project's own figures (budget, committed, reserved) share one currency. A request in another
  // currency is shown in ITS currency beside them, with no conversion and no after-request comparison.
  const requestInOtherCurrency = !!currency && !!projectCurrency && budgetCurrency === projectCurrency && currency !== projectCurrency;
  if (!currency || !projectCurrency || !budgetCurrency ||
      (!requestInOtherCurrency && (currency !== projectCurrency || budgetCurrency !== projectCurrency))) {
    return (
      <Card className="mb-4"><CardPad>{heading}
        <UnavailableComparison reason={t('decisionSupport.currencyUnavailable', 'Budget comparison unavailable for these currencies.')} />
      </CardPad></Card>
    );
  }

  // ── Figures (three layers, ADR-0034) ─────────────────────────────────────────
  // Interdependent budget math lives in the pure computeBudgetSignal helper so it is
  // independently unit-testable; this block is presentation-only.
  const committedSpend = committed.data ?? 0;
  const otherCurrencyCommitted = (committed.otherCurrencies ?? [])
    .map((position) => formatCurrency(position.amount, position.currency)).join(', ');
  const otherCurrencyReserved = (reservedQ.otherCurrencies ?? [])
    .map((position) => position.currency ? formatCurrency(position.amount, position.currency) : t('decisionSupport.currencyUnknown', 'currency unavailable'))
    .join(', ');
  const reserved = reservedQ.data ?? 0; // TOTAL reserved (incl. this case if applicable)
  let signal;
  try {
    // A request in another currency is not part of the project's figures: compute them without it.
    signal = requestInOtherCurrency
      ? computeBudgetSignal({ budget: budgetAmount, committed: committedSpend, reserved, totalValue: 0, status: 'Draft', projectCurrency, budgetCurrency, requestCurrency: projectCurrency })
      : computeBudgetSignal({ budget: budgetAmount, committed: committedSpend, reserved, totalValue, status, projectCurrency, budgetCurrency, requestCurrency: currency });
  } catch {
    return <Card className="mb-4"><CardPad>{heading}
      <UnavailableComparison reason={t('decisionSupport.amountUnavailable', 'Budget comparison unavailable for these amounts.')} />
    </CardPad></Card>;
  }
  const { available, afterRequest, otherReserved, overAvailable, overAvailableAmount, overBudgetReserved } = signal;
  // The budget-impact bar: what is already spoken for (committed + other reserved), then this procurement's share.
  const usedBefore = committedSpend + otherReserved;
  const usedAfter = budgetAmount - afterRequest;
  const spokenPct = Math.min(100, (usedBefore / budgetAmount) * 100);
  const thisPct = Math.min(100 - spokenPct, (Math.max(0, usedAfter - usedBefore) / budgetAmount) * 100);
  const usedAfterPct = (usedAfter / budgetAmount) * 100;
  const roundedUsedPct = Math.round(usedAfterPct);
  const roundedHeadroomPct = 100 - roundedUsedPct;
  const impactTone = usedAfterPct >= AT_RISK_THRESHOLD * 100 ? 'bg-destructive' : usedAfterPct >= 70 ? 'bg-warning' : 'bg-success';

  const budgetUsedPct = projectBudgetUsedPercent(positions.data?.[scopedProjectId], projectCurrency);
  const budgetUsedReadFailed = positions.isError && !(projectStatus && PIPELINE_STATUSES.includes(projectStatus));

  // A long label wraps to two lines; every label reserves two and sits on the bottom so the figures line up across a row.
  const tileLabel = (text: string) => <span className="flex min-h-[2lh] items-end">{text}</span>;
  const uncommittedLabel = t('decisionSupport.uncommittedToPurchases', 'Not yet committed to purchases');
  const uncommittedCaption = otherCurrencyCommitted
    ? t('decisionSupport.otherCurrencyCommitments', { defaultValue: 'Not counting commitments in other currencies: {{amounts}}', amounts: otherCurrencyCommitted })
    : t('decisionSupport.notCountingRecordedSpending', 'Not counting recorded spending');
  const tiles = [
    {
      label: tileLabel(t('decisionSupport.thisProcurement', 'Procurement total')),
      value: formatCurrency(totalValue, currency),
      ...(requestInOtherCurrency ? { sub: t('decisionSupport.notCompared', 'In a different currency: not compared with the budget') } : {}),
    },
    {
      label: tileLabel(t('decisionSupport.reserved', 'Reserved')),
      value: formatCurrency(otherReserved, budgetCurrency),
      sub: otherCurrencyReserved ? t('decisionSupport.otherReservedCurrencies', { defaultValue: 'Approved, not yet ordered. Other currencies: {{amounts}}', amounts: otherCurrencyReserved }) : t('decisionSupport.reservedSub', 'Approved, not yet ordered'),
    },
    {
      // The budget less open orders and reservations, before recorded spending: what is still free for purchases, not a cash balance.
      // 0373: committed spend in another currency is not subtracted (no conversion); say so rather than hide it.
      label: captionInTooltip && !otherCurrencyCommitted
        ? <span className="flex min-h-[2lh] items-end" title={uncommittedCaption}>{uncommittedLabel}<span className="sr-only">. {uncommittedCaption}</span></span>
        : tileLabel(uncommittedLabel),
      ...(captionInTooltip && !otherCurrencyCommitted ? {} : { sub: uncommittedCaption }),
      value: formatCurrency(available, budgetCurrency),
      tone: available < 0 ? ('neg' as const) : undefined,
    },
    // The project's canonical Budget used, mirroring the project header: no figure there (a project still in the
    // pipeline, or a reading that does not apply) means no tile here. Only a failed read shows a short unknown mark.
    ...(budgetUsedPct !== null ? [{
      label: tileLabel(t('decisionSupport.budgetUsed', 'Budget used')),
      value: `${formatNumberExact(budgetUsedPct)}%`,
      sub: t('decisionSupport.budgetUsedBasis', 'Recorded spending, before tax'),
    }] : budgetUsedReadFailed ? [{
      label: tileLabel(t('decisionSupport.budgetUsed', 'Budget used')),
      value: '—',
      exactValue: t('decisionSupport.budgetUsedUnknown', 'Budget used is unknown or unavailable.'),
    }] : []),
    { label: tileLabel(t('decisionSupport.projectBudget', 'Project budget')), value: formatCurrency(budgetAmount, budgetCurrency) },
    ...(requestInOtherCurrency ? [] : [{
      label: tileLabel(t('decisionSupport.afterThisProcurement', 'After this procurement')),
      value: formatCurrency(afterRequest, currency),
      // Whole percent and its exact complement to used always total 100.
      sub: t('decisionSupport.headroom', { defaultValue: '{{pct}}% headroom left', pct: formatNumberExact(roundedHeadroomPct) }),
      tone: afterRequest < 0 ? ('neg' as const) : undefined,
    }]),
  ];

  return (
    <Card className="mb-4">
      <CardPad>
        {heading}

        {/* Five stat tiles — text-labelled, tabular-nums (a11y: not color-only).
            Available (Budget − Committed − Reserved) is the over-commitment-safe
            headroom. The bar above shows the same budget as spoken-for + this procurement
            (text beside it, so it never reads as broken at 0%); the bare strip has no grey filler cell. */}
        <div className="mb-4">
          <div
            role="progressbar"
            aria-label={t('decisionSupport.committedBarLabel', { defaultValue: 'Committed to purchases, with this one: {{pct}}% of {{budget}}', pct: Math.round(usedAfterPct), budget: formatCurrency(budgetAmount, budgetCurrency) })}
            aria-valuenow={Math.max(0, Math.min(100, Math.round(usedAfterPct)))}
            aria-valuemin={0}
            aria-valuemax={100}
            className="flex h-2 overflow-hidden rounded-full bg-secondary"
          >
            <span className="bg-muted-foreground/55" style={{ width: `${spokenPct}%` }} />
            <span className={impactTone} style={{ width: `${thisPct}%` }} />
          </div>
          <p className="mt-1 text-control text-muted-foreground tabular">
            {t('decisionSupport.committedBarCaption', { defaultValue: 'Committed to purchases, with this one: {{pct}}%', pct: formatNumberExact(Math.round(usedAfterPct)) })}
          </p>
        </div>
        {/* The strip's column queries resolve against the nearest ANCESTOR container, so give it one. */}
        {/* Six tiles go 2 rows of 3: six abreast crowd to 3-4px gaps in Bahasa at 1440. */}
        <div className="@container"><StatTiles tiles={tiles} columns={tiles.length >= 6 ? 3 : 5} variant="bare" /></div>

        {/* Over-available advisory — non-blocking. ErrBanner is role="status" (gentle,
            not an alert) and carries the dollar overage in text (WCAG SC 1.4.1, not
            color-only). Approval is still permitted (OD-W5-4/OD-W5-5). */}
        {overAvailable && !requestInOtherCurrency && (
          <ErrBanner
            className="mt-3 mb-0"
            title="Over available budget"
            sub={
              <>
                {t('decisionSupport.overBudgetLead', 'This procurement exceeds available budget by')}{' '}
                <strong className="tabular">{formatCurrency(overAvailableAmount, currency)}</strong>. Approval
                is still permitted — this is an advisory only.
              </>
            }
          />
        )}

        {/* Already-reserved + project over budget — no thisRequest advisory (it is
            already counted in Reserved); surface the over-budget condition instead. */}
        {overBudgetReserved && !requestInOtherCurrency && (
          <ErrBanner
            className="mt-3 mb-0"
            title="Project over budget"
            sub={
              <>
                This project is over budget by{' '}
                <strong className="tabular">{formatCurrency(-available, currency)}</strong> across committed
                and reserved demand. This is an advisory only.
              </>
            }
          />
        )}

        {/* Explicit affordance to drill into the project budget detail.
            Styled as a quiet link (not a competing CTA) — the decision zone
            primary action owns the blue; this is a secondary navigation escape. */}
        <div className="mt-3 pt-3 border-t border-border/50">
          <Link
            to={`/projects/${scopedProjectId}`}
            className="inline-flex items-center gap-1 text-control font-medium text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring underline-offset-4"
          >
            {t('decisionSupport.openProject', 'Open project')}
          </Link>
        </div>
      </CardPad>
    </Card>
  );
};
