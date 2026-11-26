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
import { StatTiles, type StatTile } from '@/src/components/ui/StatTiles';
import { ErrBanner } from '@/src/components/ui/ErrBanner';
import { Icon } from '@/src/components/ui/icons';
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
import { computeBudgetSignal, PANEL_VISIBLE_STATUSES } from '@/src/lib/procurement/computeBudgetSignal';
import { AT_RISK_THRESHOLD } from '@/src/lib/dashboardConstants';


const UnavailableComparison: React.FC<{ reason: string }> = ({ reason }) => {
  const { t } = useTranslation('procurement');
  const inFigureScope = useFigureReport([{ label: t('decisionSupport.comparison', 'Budget comparison'), reason }]);
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
  /** Inside a record header's band: no frame of its own, a rule above it (the header panel is the frame). */
  bare?: boolean;
  /** Record page only: the decision's own facts and note, placed under the decision figure (or at the end in other states). */
  aside?: React.ReactNode;
}

/** The panel's frame: a card on its own, or a bare block inside the record header's band (the page draws its rule or surface). */
const Frame: React.FC<{ bare: boolean; children: React.ReactNode }> = ({ bare, children }) => (bare
  ? <section className="@container">{children}</section>
  : <Card className="mb-4"><CardPad>{children}</CardPad></Card>);

export const DecisionSupportPanel: React.FC<DecisionSupportPanelProps> = ({
  projectId,
  totalValue,
  projectName,
  projectLegalName,
  projectStatus,
  captionInTooltip = false,
  status,
  currency,
  bare = false,
  aside = null,
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

  const openProjectLink = (
    <Link
      to={`/projects/${scopedProjectId}`}
      className="inline-flex items-center gap-1 text-control font-medium text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring underline-offset-4"
    >
      {t('decisionSupport.openProject', 'Open project')}
    </Link>
  );
  const projectLine = (
    <>
      {projectName ? (
        <ProjectNameLink
          projectId={scopedProjectId}
          name={projectName}
          legalName={projectLegalName}
          className={bare ? 'text-control font-normal text-muted-foreground' : 'text-control font-medium text-foreground'}
        />
      ) : null}
      {projectStatus && PIPELINE_STATUSES.includes(projectStatus) ? (
        <StatusPill record="project" state={projectStatus} wrap={false} className="ml-1" />
      ) : null}
    </>
  );
  // Record page: one line, the title, the project it measures (truncated, never wrapped) and Open project at the end.
  const heading = bare ? (
    <div className="mb-2 flex min-w-0 items-baseline gap-x-2">
      <h2 className="shrink-0 text-section font-semibold text-foreground">{t('decisionSupport.heading', 'Budget impact')}</h2>
      <span className="min-w-0 truncate">{projectLine}</span>
      <span className="ml-auto shrink-0 pl-2">{openProjectLink}</span>
    </div>
  ) : (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-1 gap-y-1">
      <h2 className="text-control font-semibold text-muted-foreground">
        {t('decisionSupport.heading', 'Budget impact')}
      </h2>
      {projectLine}
    </div>
  );

  // On the record page the panel carries the request total (the money block leaves it out), so every state shows it.
  const totalRow = bare ? (
    <dl className="mt-3 flex items-baseline justify-between gap-x-6">
      <dt className="text-control font-medium text-foreground">{t('decisionSupport.thisProcurement', 'Procurement total')}</dt>
      <dd className="whitespace-nowrap text-group font-medium text-foreground tabular-nums">{formatCurrency(totalValue, currency)}</dd>
    </dl>
  ) : null;

  // The decision figure needs the reading and who owns purchasing, so the panel waits for both rather than flash "not known".
  const isPending = budget.isPending || committed.isPending || reservedQ.isPending || positions.isPending || committed.ownershipPending;
  const isError = budget.isError || committed.isError || reservedQ.isError;

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isPending) {
    return (
      <Frame bare={bare}>
          {heading}
          <div className="flex flex-col gap-2" aria-label={t('decisionSupport.loading', 'Loading budget impact')}>
            <div className="skel h-[18px] w-3/4" />
            <div className="skel h-[14px] w-1/2" />
          </div>
          {totalRow}
          {aside}
        </Frame>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <Frame bare={bare}>
          {heading}
          <p className="text-control text-muted-foreground">
            {t('decisionSupport.budgetUnavailable', "Budget unavailable: budget impact can't be shown right now.")}
          </p>
          {totalRow}
          {aside}
        </Frame>
    );
  }

  const budgetAmount = budget.data ?? 0;

  // ── No active budget ───────────────────────────────────────────────────────
  if (budgetAmount === 0) {
    return (
      <Frame bare={bare}>
          {heading}
          <p className="text-control text-muted-foreground">
            {t('decisionSupport.noActiveBudget', 'No active budget set for this project.')}
          </p>
          {totalRow}
          {aside}
        </Frame>
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
      <Frame bare={bare}>{heading}
        <UnavailableComparison reason={t('decisionSupport.currencyUnavailable', 'Budget comparison unavailable for these currencies.')} />
        {totalRow}
          {aside}
      </Frame>
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
  // ONE reading feeds Left and Budget used, so a failed refetch never shows a Budget used number beside "Not known".
  const reading = positions.isError ? undefined : positions.data?.[scopedProjectId];
  const inputs = wholeBudgetInputs(reading, committed, projectCurrency);
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
    return <Frame bare={bare}>{heading}
      <UnavailableComparison reason={t('decisionSupport.amountUnavailable', 'Budget comparison unavailable for these amounts.')} />
      {totalRow}
          {aside}
    </Frame>;
  }
  const { afterRequest, otherReserved } = signal;
  // The budget-impact bar: what is already spoken for (spent + open orders + other reserved), then this purchase's share.
  const usedBefore = (inputs?.spent ?? 0) + (inputs?.openOrders ?? 0) + otherReserved;
  const usedAfter = budgetAmount - afterRequest;
  const spokenPct = Math.min(100, (usedBefore / budgetAmount) * 100);
  const thisPct = Math.min(100 - spokenPct, (Math.max(0, usedAfter - usedBefore) / budgetAmount) * 100);
  const usedAfterPct = (usedAfter / budgetAmount) * 100;
  const impactTone = usedAfterPct >= AT_RISK_THRESHOLD * 100 ? 'bg-destructive' : usedAfterPct >= 70 ? 'bg-warning' : 'bg-success';

  const budgetUsedPct = projectBudgetUsedPercent(reading, projectCurrency);
  const budgetUsedReadFailed = positions.isError && !(projectStatus && PIPELINE_STATUSES.includes(projectStatus));

  const leftLabel = t('decisionSupport.leftAfterPurchase', 'Left after this purchase');
  const leftTooltip = t('decisionSupport.leftAfterPurchaseTooltip', 'Budget minus recorded spending, open orders, reserved requests and this purchase, each counted once, before tax.');
  // The figures Left is made of, in the order it subtracts them (plain-string labels; each layout dresses them).
  type Part = { key: string; label: string; value: string; sub?: string; exactValue?: string };
  const procurementPart: Part = {
    key: 'procurement',
    label: t('decisionSupport.thisProcurement', 'Procurement total'),
    value: formatCurrency(totalValue, currency),
    ...(requestInOtherCurrency
      ? { sub: t('decisionSupport.notCompared', 'In a different currency: not compared with the budget') }
      : bare ? { sub: t('decisionSupport.beforeTax', 'Before tax') } : {}),
  };
  const reservedPart: Part = {
    key: 'reserved',
    label: t('decisionSupport.reserved', 'Reserved'),
    value: formatCurrency(otherReserved, budgetCurrency),
    sub: otherCurrencyReserved ? t('decisionSupport.otherReservedCurrencies', { defaultValue: 'Approved, not yet ordered. Other currencies: {{amounts}}', amounts: otherCurrencyReserved }) : t('decisionSupport.reservedSub', 'Approved, not yet ordered'),
  };
  // Orders placed and not yet billed, the figure Left subtracts: shown whenever it is known, so the approver can add it up.
  const openOrdersPart: Part | null = inputs !== null ? {
    key: 'openOrders',
    label: t('decisionSupport.openOrders', 'Open orders'),
    value: formatCurrency(inputs.openOrders, budgetCurrency),
    sub: t('decisionSupport.openOrdersSub', 'Ordered, not yet in spending'),
  } : null;
  // The project's canonical Budget used, mirroring the project header: no figure there (a project still in the
  // pipeline, or a reading that does not apply) means no tile here. Only a failed read shows a short unknown mark.
  const budgetUsedPart: Part | null = budgetUsedPct !== null ? {
    key: 'budgetUsed',
    label: t('decisionSupport.budgetUsed', 'Budget used'),
    value: `${formatNumberExact(budgetUsedPct)}%`,
    sub: t('decisionSupport.budgetUsedBasis', 'Recorded spending, before tax'),
  } : budgetUsedReadFailed ? {
    key: 'budgetUsed',
    label: t('decisionSupport.budgetUsed', 'Budget used'),
    value: '—',
    exactValue: t('decisionSupport.budgetUsedUnknown', 'Budget used is unknown or unavailable.'),
  } : null;
  const budgetPart: Part = { key: 'budget', label: t('decisionSupport.projectBudget', 'Project budget'), value: formatCurrency(budgetAmount, budgetCurrency) };
  const leftTile: StatTile | null = requestInOtherCurrency ? null : spendingKnown ? {
    // The whole-budget decision figure. The inbox row is tight: its caption moves into the label's tooltip.
    label: <span title={leftTooltip}>{leftLabel}{captionInTooltip ? <span className="sr-only">. {leftTooltip}</span> : null}</span>,
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
    
  };
  // The strip aligns labels and figures across each row itself (alignRows), so a label is plain text.
  const asTile = (part: Part): StatTile => ({ label: part.label, value: part.value, ...(part.sub ? { sub: part.sub } : {}), ...(part.exactValue ? { exactValue: part.exactValue } : {}) });
  const tiles: StatTile[] = [
    asTile(procurementPart),
    asTile(reservedPart),
    ...(openOrdersPart ? [asTile(openOrdersPart)] : []),
    ...(budgetUsedPart ? [asTile(budgetUsedPart)] : []),
    asTile(budgetPart),
    ...(leftTile ? [leftTile] : []),
  ];
  // The record page reads Left as a sum: the budget, what is already spoken for, this purchase.
  const recordParts = [budgetPart, budgetUsedPart, openOrdersPart, reservedPart, procurementPart].filter((part): part is Part => part !== null);
  // Only spending is unknown: the figure without it, under its own label, so it is never read as the Left figure.
  const withoutSpending = inputs !== null && inputs.spent === null && !requestInOtherCurrency ? afterRequest : null;

  // The bar shows the same budget as spoken-for + this purchase (text beside it, so it never reads as broken at 0%);
  // the bare strip has no grey filler cell. Not drawn while Left is not known.
  const bar = spendingKnown ? (
    <div className={bare ? 'mt-4' : 'mb-4'}>
      <div
        role="progressbar"
        aria-label={t('decisionSupport.spentOrCommittedBarLabel', { defaultValue: 'Committed, including this purchase: {{pct}}% of {{budget}}', pct: Math.round(usedAfterPct), budget: formatCurrency(budgetAmount, budgetCurrency) })}
        aria-valuenow={Math.max(0, Math.min(100, Math.round(usedAfterPct)))}
        aria-valuemin={0}
        aria-valuemax={100}
        className="flex h-2 overflow-hidden rounded-full bg-secondary"
      >
        <span className="bg-mark-neutral/55" style={{ width: `${spokenPct}%` }} />
        <span className={impactTone} style={{ width: `${thisPct}%` }} />
      </div>
      <p className="mt-1 text-control text-muted-foreground tabular">
        {t('decisionSupport.spentOrCommittedBarCaption', { defaultValue: 'Committed, including this purchase: {{pct}}%', pct: formatNumberExact(Math.round(usedAfterPct)) })}
      </p>
    </div>
  ) : null;
  // Over-budget advisory — non-blocking, once. ErrBanner is role="status" (gentle, not an alert) and carries the
  // amount in text (WCAG SC 1.4.1, not color-only). Approval is still permitted (OD-W5-4/OD-W5-5).
  const overBudgetSub = t('decisionSupport.overBudgetAfter', { defaultValue: '{{amount}} over the budget after this purchase. Approval is still permitted; this is advisory only.', amount: formatCurrency(-afterRequest, currency) });
  // Inside the record header the advisory is a line, not a box in a box (the band is already the surface).
  const overBudget = spendingKnown && !requestInOtherCurrency && afterRequest < 0 ? bare ? (
    <p role="status" className="mt-3 flex items-start gap-2 text-control text-foreground">
      <Icon name="alert" className="mt-0.5 size-4 shrink-0 text-destructive-text" aria-hidden="true" />
      <span><span className="font-semibold text-destructive-text">{t('decisionSupport.overBudgetTitle', 'Over budget')}</span> · {overBudgetSub}</span>
    </p>
  ) : (
    <ErrBanner
      className="mt-3 mb-0"
      title={t('decisionSupport.overBudgetTitle', 'Over budget')}
      sub={overBudgetSub}
    />
  ) : null;
  // The parts Left is made of, as one row of figures in the money block's style (label, amount, one caption).
  const partsList = (
    // Narrow (phone, drawer): ledger rows, label left and amount right. Wide: five figures in one row.
    <dl data-testid="budget-impact-parts" className="grid grid-cols-1 @3xl:grid-cols-5 @3xl:gap-x-6">
      {recordParts.map((part) => (
        <div key={part.key} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] content-start items-baseline gap-x-6 border-b border-border py-2 first:pt-0 last:border-b-0 last:pb-0 @3xl:grid-cols-1 @3xl:border-b-0 @3xl:py-0">
          <dt className="text-control font-medium text-foreground">{part.label}</dt>
          <dd className="whitespace-nowrap text-right text-group font-medium text-foreground tabular-nums @3xl:mt-1 @3xl:text-left" title={part.exactValue}>{part.value}</dd>
          {part.sub && <dd className="mt-0.5 text-control text-muted-foreground">{part.sub}</dd>}
        </div>
      ))}
    </dl>
  );

  return (
    <Frame bare={bare}>
        {heading}

        {bare ? (
          // Record page: the decision figure and its bar, the parts it is made of, then the decision itself.
          <>
            {leftTile && <StatTiles tiles={[leftTile]} columns={1} variant="bare" />}
            {bar}
            {overBudget}
            <div className={leftTile ? 'mt-6' : undefined}>{partsList}</div>
          </>
        ) : (
          <>
            {bar}
            {/* Six tiles go 3 across (3 rows of 2 on a phone): six abreast crowd to 3-4px gaps in Bahasa at 1440.
                Fewer take as many columns as they have, so no column is left empty. */}
            <StatTiles tiles={tiles} columns={tiles.length >= 6 ? 3 : tiles.length} variant="bare" wideFigures alignRows />
          </>
        )}

        {withoutSpending !== null && (
          <p className="mt-3 text-control text-muted-foreground tabular">
            {t('decisionSupport.leftWithoutSpending', { defaultValue: 'Without spending: {{amount}} left after orders, reserved and this purchase.', amount: formatCurrency(withoutSpending, currency) })}
          </p>
        )}

        {!bare && overBudget}
        {bare && aside && <div className="mt-6 border-t border-warning/25 pt-4">{aside}</div>}

        {/* Explicit affordance to drill into the project budget detail.
            Styled as a quiet link (not a competing CTA) — the decision zone
            primary action owns the blue; this is a secondary navigation escape. On the record page it sits
            at the heading's end instead, so the panel ends on its figures. */}
        {!bare && <div className="mt-3 pt-3 border-t border-border/50">{openProjectLink}</div>}
      </Frame>
  );
};
