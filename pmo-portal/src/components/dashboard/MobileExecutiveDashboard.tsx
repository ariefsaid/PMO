/**
 * MobileExecutiveDashboard — glanceable mobile composition for the Executive role.
 *
 * Wave-0 S1. Answers the exec's three questions in order:
 *   (a) What's on fire? → at-risk block
 *   (b) What's waiting on me? → approvals action band
 *   (c) Is the book healthy? → Contract book (Revenue on hand + Total contract value)
 *
 * Then defers: pipeline below fold, charts single-column.
 *
 * Design tokens: DESIGN.md only. No raw hex / px. Single-render (rendered only
 * when useIsDesktop()=false, so exactly one DOM branch exists).
 *
 * CW-7 (coherence wave §4): mobile presents the SAME metrics with the SAME LABELS/TERMS as the
 * desktop ExecutiveDashboard — it is a condensed/reordered REFLOW of the same content, never a
 * different page. Shared metric labels: "Revenue on hand", "Total contract value", "Active
 * projects", "Total project spend". The B-MIN-3 grouping (a "Contract book" overline + per-tile
 * source micro-lines explaining each figure's scope) is retained, but the headline metric terms no
 * longer fork from desktop.
 */
import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '@/src/components/ui/cn';
import { Icon } from '@/src/components/ui/icons';
import { KPITile } from '@/src/components/ui/KPITile';
import { AtRiskProjectsLink } from './AtRiskProjectsLink';
import { formatDashboardMoney } from '@/src/lib/dashboardMoney';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import type { ExecutiveDashboard } from '@/src/lib/db/dashboard';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MobileExecutiveDashboardProps {
  data: ExecutiveDashboard;
  /** Approval items waiting on this user (proc + timesheets). */
  approvalCount: number;
  /**
   * True when a contributing approval query (procurements or timesheets) errored.
   * The band shows "—" instead of a fabricated 0 count (AC-W2-4-06).
   */
  approvalError?: boolean;
  /** Quiet dashboard doorway shown in the mobile heading area. */
  headingAction?: React.ReactNode;
  /** Rendered below the above-fold section (charts, pipeline, etc.). */
  belowFold: React.ReactNode;
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

/**
 * Overline label — DESIGN.md typography.overline tokens.
 * 11px / 600 / 0.06em / uppercase / muted-foreground.
 */
const Overline: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <p
    className={cn(
      'text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground',
      className
    )}
  >
    {children}
  </p>
);

/**
 * AtRiskBlock — the primary decision card.
 *
 * Tone: warning (amber icon tile, warning-foreground value).
 * Zero state: success/neutral copy ("all on track"), amber tile → neutral.
 *
 * Drill cells link to /projects?filter=Ongoing (active projects) and
 * /projects?filter=Ongoing (spend breakdown). Both are single links
 * with descriptive aria-labels (no nested interactive — DESIGN.md a11y rule).
 */
const AtRiskBlock: React.FC<{
  atRisk: number;
  activeProjects: number;
  totalSpend: number | null;
  actualProjectCount: number;
  actualProjectTotal: number;
  actualCoverageCount: number;
  actualCoverageTotal: number;
  /** FR-L10N-020: `totalSpend` is a dashboard AGGREGATE — the RPC row carries no currency of its own,
   *  so it is denominated in the org default and threaded from the parent rather than re-read here.
   *  A leaf that called the hook itself would work today and diverge the moment one is rendered for
   *  a different org. */
  currency: string;
}> = ({ atRisk, activeProjects, totalSpend, actualProjectCount, actualProjectTotal, actualCoverageCount, actualCoverageTotal, currency }) => {
  const { t, i18n } = useTranslation();
  const spendText = formatDashboardMoney(totalSpend, currency, i18n.language)
    ?? t('uxs03.notAvailableYet', 'Not available yet');
  const isAtRisk = atRisk > 0;

  return (
    <div
      data-testid="dashboard-at-risk"
      aria-label={isAtRisk
        ? t('dashboard.mobile.atRiskCount', '{{count}} projects at risk', { count: atRisk })
        : t('dashboard.mobile.atRiskZero', 'All projects on track')}
      className="rounded-lg border border-border bg-card p-4"
    >
      {/* Icon + label row */}
      <div className="flex items-center gap-[10px]">
        <span
          aria-hidden="true"
          className={cn(
            'grid size-[30px] shrink-0 place-items-center rounded-lg [&_svg]:size-[17px]',
            isAtRisk
              ? 'bg-warning/[0.14] text-warning-foreground'
              : 'bg-success/[0.13] text-success'
          )}
        >
          <Icon name="alert" />
        </span>
        <span className="text-[12px] font-semibold text-muted-foreground">
          {t('dashboard.mobile.atRiskRegion', 'Projects at risk')}
        </span>
      </div>

      {/* Value + sub row */}
      <div className="mt-2 flex items-baseline gap-2">
        <span
          className={cn(
            'tabular text-[23px] font-bold leading-tight',
            isAtRisk ? 'text-warning-foreground' : 'text-foreground'
          )}
        >
          {atRisk}
        </span>
        <span className="text-[12.5px] text-muted-foreground">
          {isAtRisk
            ? t('dashboard.mobile.riskSummary', 'of {{count}} active projects flagged over budget or behind schedule', { count: activeProjects })
            : t('dashboard.mobile.noRiskSummary', 'of {{count}} active projects · all on track', { count: activeProjects })}
        </span>
      </div>

      {isAtRisk && (
        <div className="mt-3">
          <AtRiskProjectsLink
            count={atRisk}
            className="touch-target inline-flex items-center rounded-md border border-warning/30 px-3 font-medium text-warning-foreground hover:bg-warning/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        </div>
      )}

      {/* Drill cells — two links, each a single focusable element */}
      <div className="mt-3 flex gap-[10px]">
        <Link
          to="/projects?filter=Ongoing"
          aria-label={t('dashboard.mobile.activeProjectsLink', 'Open active projects · {{count}} projects', { count: activeProjects })}
          className="touch-target flex-1 rounded-[6px] border border-border p-[9px_10px] text-inherit no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span className="block text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
            {t('dashboard.kpi.activeProjects.label', 'Active projects')}
          </span>
          <span className="tabular mt-[3px] block text-[17px] font-bold">
            {activeProjects}
          </span>
          <span className="mt-1 block text-[11px] font-semibold text-primary-text">
            {t('dashboard.mobile.view', 'View')} →
          </span>
        </Link>

        <Link
          to="/projects?filter=Ongoing"
          aria-label={t('dashboard.mobile.spendLink', 'Open spend breakdown · {{amount}} spent to date', { amount: spendText })}
          className="touch-target flex-1 rounded-[6px] border border-border p-[9px_10px] text-inherit no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span className="block text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
            {t('dashboard.kpi.totalSpend.label', 'Total project spend')}
          </span>
          <span className="tabular mt-[3px] block text-[17px] font-bold">
            {spendText}
          </span>
          <span className="mt-1 block text-[11px] text-muted-foreground">
            {t('uxs03.coverage', 'Actual available for {{known}} of {{total}} delivery projects', { known: actualProjectCount ?? 0, total: actualProjectTotal ?? 0 })}
            {' · '}{t('uxs03.coverageCategories', 'Actual coverage: {{known}} of {{total}} mapped cost categories', { known: actualCoverageCount ?? 0, total: actualCoverageTotal ?? 0 })}
          </span>
          <span className="mt-1 block text-[11px] font-semibold text-primary-text">
            {t('dashboard.mobile.breakdown', 'Breakdown')} →
          </span>
        </Link>
      </div>
    </div>
  );
};

/**
 * MobileApprovalsBand — one-line action band.
 *
 * A single <Link> to /approvals with a primary "Review →" CTA on the right.
 * One Blue Rule: this is the only `primary`-colored affordance above the fold.
 * The whole row is a link (no nested button inside link — single focusable element).
 */
const MobileApprovalsBand: React.FC<{ count: number; error?: boolean }> = ({ count, error }) => {
  const { t } = useTranslation();
  const label = error
    ? t('dashboard.mobile.approvalsLinkError', 'Awaiting your approval. Open approvals inbox.')
    : t('dashboard.mobile.approvalsLink', 'Awaiting your approval: {{count}} items. Open approvals inbox.', { count });
  return (
    <Link
      to="/approvals"
      data-testid="mobile-approvals-band"
      aria-label={label}
      className="touch-target flex items-center gap-3 rounded-lg border border-border bg-card p-[13px_14px] text-inherit no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {/* Amber icon tile */}
      <span
        aria-hidden="true"
        className="grid size-[30px] shrink-0 place-items-center rounded-lg bg-warning/[0.14] text-warning-foreground [&_svg]:size-[17px]"
      >
        <Icon name="check" />
      </span>

      {/* Count + label */}
      <div>
        <div className="tabular text-[21px] font-bold leading-none">
          {error ? '—' : count}
        </div>
        <div className="mt-[2px] text-[12.5px] text-muted-foreground">
          {t('dashboard.mobile.awaitingApproval', 'Awaiting your approval')}
        </div>
      </div>

      {/* Primary "Review" CTA — visual only (parent link handles navigation) */}
      <span
        aria-hidden="true"
        className="ml-auto inline-flex h-8 items-center gap-[6px] rounded-lg bg-primary px-3 text-[13px] font-semibold text-primary-foreground shadow-[0_1px_2px_hsl(var(--primary)/0.25)] [&_svg]:size-[14px]"
      >
        {t('dashboard.mobile.review', 'Review')}
        <Icon name="chev" />
      </span>
    </Link>
  );
};

/**
 * ContractBook — B-MIN-3 fix.
 *
 * Two headline money tiles grouped under a "Contract book" overline.
 * Each has an explicit source micro-label so the asymmetry (revenue includes
 * closed-out work; contract value is active-only) is self-explanatory.
 *
 * CW-7: headline labels match desktop ("Revenue on hand", "Total contract value"); the scope
 * asymmetry is carried by the source micro-lines, not by forking the term.
 */
const ContractBook: React.FC<{
  onHandValue: number | null;
  onHandContractRemaining: number | null;
  realizedMargin: number | null;
  realizedMarginLabel: string;
  activeContractValue: number | null;
  activeProjects: number;
}> = ({ onHandValue, onHandContractRemaining, realizedMargin, realizedMarginLabel, activeContractValue, activeProjects }) => {
  const { t, i18n } = useTranslation();
  const orgCurrency = useOrgCurrency();
  const money = (value: number | null) => formatDashboardMoney(value, orgCurrency, i18n.language)
    ?? t('uxs03.notAvailableYet', 'Not available yet');

  return (
    <div
      data-testid="mobile-contract-book"
      aria-label={t('dashboard.mobile.contractBook', 'Contract book')}
      className="space-y-[10px]"
    >
      {/* Tile 1: Revenue on hand — CW-3b: the canonical KPITile, not one-off tile markup.
          The B-MIN-3 scope micro-line rides as the tile's `vs` sub. */}
      <KPITile
        testId="mobile-kpi-on-hand"
        tone="green"
        icon="dollar"
        label={t('uxs03.contractedRevenue', 'Contracted revenue')}
        value={money(onHandValue)}
        vs={t('uxs03.contractRemaining', 'Contract remaining after known Actual') + ': ' + money(onHandContractRemaining) + ' · '
          + realizedMarginLabel + ': ' + money(realizedMargin)}
        helpLabel={t('dashboard.kpi.aboutMetric', 'About this metric')}
        help={t('dashboard.kpi.revenueOnHand.help', 'Contract value across delivery projects. Margin is billed-work revenue less Actual; it is not cash received.')}
      />

      {/* Tile 2: Total contract value — same canonical KPITile.
          CW-7 (coherence wave §4): mobile reads the SAME metric LABEL as desktop ("Total contract
          value", ExecutiveDashboard kpi-total-contract-value) — both render the same active-only
          `total_contract_value` figure. The B-MIN-3 source micro-line (the `vs` sub) keeps the scope
          honest without forking the headline term. */}
      <KPITile
        testId="mobile-kpi-total-contract-value"
        tone="amber"
        icon="grid"
        label={t('dashboard.kpi.totalContractValue.label', 'Total contract value')}
        value={money(activeContractValue)}
        vs={t('dashboard.kpi.totalContractValue.mobileVs', 'Signed value of the {{count}} projects still in delivery', { count: activeProjects })}
      />
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

/**
 * MobileExecutiveDashboard — the full mobile composition.
 *
 * Rendered only when useIsDesktop()=false (single-render seam per DESIGN.md §5).
 * Desktop layout is unaffected — the parent (ExecutiveDashboard) controls which
 * branch renders.
 */
export const MobileExecutiveDashboard: React.FC<MobileExecutiveDashboardProps> = ({
  data,
  approvalCount,
  approvalError,
  headingAction,
  belowFold,
}) => {
  const { t } = useTranslation();
  const orgCurrency = useOrgCurrency();
  const totalSpend = data.on_hand_actual_known;
  const unknownMarginProjects = (data.on_hand_realized_margin_by_currency ?? [])
    .reduce((sum, item) => sum + item.unknown_projects, 0);
  const marginLabel = unknownMarginProjects > 0
    ? t('uxs03.realizedMarginKnown', 'Known margin on billed work')
    : t('uxs03.realizedMargin', 'Margin on billed work');

  return (
    <div className="space-y-3">
      {headingAction && <div className="flex justify-end">{headingAction}</div>}
      {/* Section 1: Needs attention — Projects at risk */}
      <section aria-label={t('dashboard.mobile.needsAttention', 'Needs attention')}>
        <Overline className="mb-2">{t('dashboard.mobile.needsAttention', 'Needs attention')}</Overline>
        <AtRiskBlock
          atRisk={data.projects_at_risk}
          activeProjects={data.active_projects}
          totalSpend={totalSpend}
          actualProjectCount={data.on_hand_actual_project_count ?? 0}
          actualProjectTotal={data.on_hand_actual_project_total ?? 0}
          actualCoverageCount={data.on_hand_actual_coverage_count ?? 0}
          actualCoverageTotal={data.on_hand_actual_coverage_total ?? 0}
          currency={orgCurrency}
        />
      </section>

      {/* Section 2: Awaiting approval — primary action band */}
      <section aria-label={t('dashboard.mobile.approvals', 'Approvals')}>
        <MobileApprovalsBand count={approvalCount} error={approvalError} />
      </section>

      {/* Section 3: Contract book — B-MIN-3 grouped money pair */}
      <section aria-label={t('dashboard.mobile.contractBook', 'Contract book')}>
        <Overline className="mb-2">{t('dashboard.mobile.contractBook', 'Contract book')}</Overline>
        <ContractBook
          onHandValue={data.on_hand_value}
          onHandContractRemaining={data.on_hand_contract_remaining}
          realizedMargin={data.on_hand_realized_margin}
          realizedMarginLabel={marginLabel}
          activeContractValue={data.total_contract_value}
          activeProjects={data.active_projects}
        />
      </section>

      {/* Everything below the fold — charts, pipeline, etc. */}
      {belowFold}
    </div>
  );
};
