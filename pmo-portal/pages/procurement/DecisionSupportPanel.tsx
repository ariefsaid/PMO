/**
 * AC-IXD-PROC-W5-2 / AC-RB-004..018 — DecisionSupportPanel
 *
 * A read-only budget-impact card placed in the evidence zone of ProcurementDetails,
 * directly under StatTiles. Renders ONLY when p.project_id is set AND the case status
 * is pre-Ordered (Draft..Quote Selected) — ADR-0034 §6.
 *
 * Its decision figure is "Left after this purchase" (OD-APPROVAL-LEFT):
 *   Active budget − recorded spending − open orders − Reserved − this purchase, each counted once.
 *   • Budget   = useProjectBudget(projectId) — Σ Active budget-version line items.
 *   • Spending + open orders = wholeBudgetInputs: the project header's own reading (`useProjectBudgetPositions`)
 *                plus ADR-0093's per-order position on ERP. No sum of its own.
 *   • Reserved = useProjectReservedSpend(projectId) — Σ total_value in Approved/Vendor Quoted/Quote Selected.
 * The arithmetic lives in the pure computeBudgetSignal helper; this component only presents it.
 *
 * Unknown is never drawn as a number: when spending or open orders are not known the Left tile says so, with
 * no bar and no advisory. When ONLY spending is unknown the panel also states the figure without it, under its
 * own explicit label, so a reader is never shown less than the purchasing-only amount the panel used to give.
 *
 * Over-budget is a non-blocking advisory (approval still permitted — OD-W5-4/OD-W5-5), shown once, when the
 * figure is negative.
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
import { wholeBudgetInputs } from '@/src/lib/budget/wholeBudgetInputs';
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
  /** The approvals inbox row is tight: the Left figure's label also carries its formula for screen readers. */
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
  const committed = useProjectCommittedSpend(scopedProjectId, true);
  const reservedQ = useProjectReservedSpend(scopedProjectId);
  // The project header's reading: Budget used, and the spending behind Left after this purchase.
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

  // The decision figure needs the reading and who owns purchasing, so the panel waits for both rather than flash "not known".
  const isPending = budget.isPending || committed.isPending || reservedQ.isPending || positions.isPending || committed.ownershipPending;
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

  // ── Figures (OD-APPROVAL-LEFT) ───────────────────────────────────────────────
  // Interdependent budget math lives in the pure computeBudgetSignal helper so it is
  // independently unit-testable; this block is presentation-only.
  const otherCurrencyCommitted = (committed.otherCurrencies ?? [])
    .map((position) => formatCurrency(position.amount, position.currency)).join(', ');
  const otherCurrencyReserved = (reservedQ.otherCurrencies ?? [])
    .map((position) => position.currency ? formatCurrency(position.amount, position.currency) : t('decisionSupport.currencyUnknown', 'currency unavailable'))
    .join(', ');
  const reserved = reservedQ.data ?? 0; // TOTAL reserved (incl. this case if applicable)
  const inputs = wholeBudgetInputs(positions.isError ? undefined : positions.data?.[scopedProjectId], committed, projectCurrency);
  // null = open orders not known; spent null = only spending not known.
  const spendingKnown = inputs !== null && inputs.spent !== null;
  let signal;
  try {
    // A request in another currency is not part of the project's figures: compute them without it.
    // An unknown input is passed as 0 only to get Reserved (other) and the purchasing-only amount; Left itself is never drawn from it.
    signal = computeBudgetSignal({
      budget: budgetAmount, spent: inputs?.spent ?? 0, openOrders: inputs?.openOrders ?? 0, reserved,
      totalValue: requestInOtherCurrency ? 0 : totalValue, status: requestInOtherCurrency ? 'Draft' : status,
      projectCurrency, budgetCurrency, requestCurrency: requestInOtherCurrency ? projectCurrency : currency,
    });
  } catch {
    return <Card className="mb-4"><CardPad>{heading}
      <UnavailableComparison reason={t('decisionSupport.amountUnavailable', 'Budget comparison unavailable for these amounts.')} />
    </CardPad></Card>;
  }
  const { afterRequest, otherReserved } = signal;
  // The budget-impact bar: what is already spoken for (spent + open orders + other reserved), then this purchase's share.
  const usedBefore = (inputs?.spent ?? 0) + (inputs?.openOrders ?? 0) + otherReserved;
  const usedAfter = budgetAmount - afterRequest;
  const spokenPct = Math.min(100, (usedBefore / budgetAmount) * 100);
  const thisPct = Math.min(100 - spokenPct, (Math.max(0, usedAfter - usedBefore) / budgetAmount) * 100);
  const usedAfterPct = (usedAfter / budgetAmount) * 100;
  const impactTone = usedAfterPct >= AT_RISK_THRESHOLD * 100 ? 'bg-destructive' : usedAfterPct >= 70 ? 'bg-warning' : 'bg-success';

  const budgetUsedPct = projectBudgetUsedPercent(positions.data?.[scopedProjectId], projectCurrency);
  const budgetUsedReadFailed = positions.isError && !(projectStatus && PIPELINE_STATUSES.includes(projectStatus));

  // A long label wraps to two lines; every label reserves two and sits on the bottom so the figures line up across a row.
  const tileLabel = (text: string) => <span className="flex min-h-[2lh] items-end">{text}</span>;
  const leftLabel = t('decisionSupport.leftAfterPurchase', 'Left after this purchase');
  const leftTooltip = t('decisionSupport.leftAfterPurchaseTooltip', 'Budget minus recorded spending, open orders, reserved requests and this purchase, each counted once, before tax.');
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
    // Orders placed and not yet billed, the figure Left subtracts: shown whenever it is known, so the approver can add it up.
    ...(inputs !== null ? [{
      label: tileLabel(t('decisionSupport.openOrders', 'Open orders')),
      value: formatCurrency(inputs.openOrders, budgetCurrency),
      sub: t('decisionSupport.openOrdersSub', 'Ordered, not invoiced'),
    }] : []),
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
    ...(requestInOtherCurrency ? [] : [spendingKnown ? {
      // The whole-budget decision figure. The inbox row is tight: its caption moves into the label's tooltip.
      label: <span className="flex min-h-[2lh] items-end" title={leftTooltip}>{leftLabel}{captionInTooltip ? <span className="sr-only">. {leftTooltip}</span> : null}</span>,
      value: formatCurrency(afterRequest, currency),
      sub: t('decisionSupport.leftAfterPurchaseSub', 'After spending, orders and reserved'),
      tone: afterRequest < 0 ? ('neg' as const) : undefined,
    } : {
      // Never a number here when spending or open orders are not known (a plain-string label so a figure scope can name it).
      label: leftLabel,
      value: null,
      unavailableReason: (committed.otherCurrencies ?? []).length > 0
        ? t('decisionSupport.leftOtherCurrency', { defaultValue: 'Open orders in another currency: {{amounts}}', amounts: otherCurrencyCommitted })
        // One short line each, so the reason fits its cell: open orders unknown (inputs null) or only spending unknown.
        : inputs === null ? t('decisionSupport.leftOrdersUnknown', 'Open orders not known yet')
        : t('decisionSupport.leftSpendingUnknown', 'Spending not known yet'),
      // Only spending unknown: the tile says one short word, the sentence under the tiles carries the fallback.
      ...(inputs !== null ? { unavailableShort: t('decisionSupport.leftNotKnown', 'Not known') } : {}),
    }]),
  ];
  // Only spending is unknown: the figure without it, under its own label, so it is never read as the Left figure.
  const withoutSpending = inputs !== null && inputs.spent === null && !requestInOtherCurrency ? afterRequest : null;

  return (
    <Card className="mb-4">
      <CardPad>
        {heading}

        {/* The bar shows the same budget as spoken-for + this purchase (text beside it, so it never reads as
            broken at 0%); the bare strip has no grey filler cell. Not drawn while Left is not known. */}
        {spendingKnown && (
          <div className="mb-4">
            <div
              role="progressbar"
              aria-label={t('decisionSupport.spentOrCommittedBarLabel', { defaultValue: 'Spent or committed, with this one: {{pct}}% of {{budget}}', pct: Math.round(usedAfterPct), budget: formatCurrency(budgetAmount, budgetCurrency) })}
              aria-valuenow={Math.max(0, Math.min(100, Math.round(usedAfterPct)))}
              aria-valuemin={0}
              aria-valuemax={100}
              className="flex h-2 overflow-hidden rounded-full bg-secondary"
            >
              <span className="bg-muted-foreground/55" style={{ width: `${spokenPct}%` }} />
              <span className={impactTone} style={{ width: `${thisPct}%` }} />
            </div>
            <p className="mt-1 text-control text-muted-foreground tabular">
              {t('decisionSupport.spentOrCommittedBarCaption', { defaultValue: 'Spent or committed, with this one: {{pct}}%', pct: formatNumberExact(Math.round(usedAfterPct)) })}
            </p>
          </div>
        )}
        {/* The strip's column queries resolve against the nearest ANCESTOR container, so give it one. */}
        {/* Six tiles go 2 rows of 3: six abreast crowd to 3-4px gaps in Bahasa at 1440. */}
        <div className="@container"><StatTiles tiles={tiles} columns={tiles.length >= 6 ? 3 : 5} variant="bare" /></div>

        {withoutSpending !== null && (
          <p className="mt-3 text-control text-muted-foreground tabular">
            {t('decisionSupport.leftWithoutSpending', { defaultValue: 'Without spending: {{amount}} left after orders, reserved and this purchase.', amount: formatCurrency(withoutSpending, currency) })}
          </p>
        )}

        {/* Over-budget advisory — non-blocking, once. ErrBanner is role="status" (gentle, not an alert) and
            carries the amount in text (WCAG SC 1.4.1, not color-only). Approval is still permitted (OD-W5-4/OD-W5-5). */}
        {spendingKnown && !requestInOtherCurrency && afterRequest < 0 && (
          <ErrBanner
            className="mt-3 mb-0"
            title={t('decisionSupport.overBudgetTitle', 'Over budget')}
            sub={t('decisionSupport.overBudgetAfter', { defaultValue: '{{amount}} over the budget after this purchase. Approval is still permitted; this is advisory only.', amount: formatCurrency(-afterRequest, currency) })}
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
