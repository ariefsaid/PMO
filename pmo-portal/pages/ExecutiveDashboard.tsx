import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useDashboard, useSalesPipeline } from '@/src/hooks/useDashboard';
import { KPITile } from '@/src/components/ui/KPITile';
import { Card, CardHead } from '@/src/components/ui/Card';
import { ListState } from '@/src/components/ui/ListState';
import { BoardPackAction } from '@/src/components/reports/BoardPackAction';
import { formatDashboardMoney } from '@/src/lib/dashboardMoney';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import type { Tables } from '@/src/lib/supabase/database.types';
import { WinRateCard } from '@/src/components/dashboard/WinRateCard';
import { BvACard } from '@/src/components/dashboard/BvACard';
import { ProjectedMarginBars } from '@/src/components/dashboard/ProjectedMarginBars';
import { StatusBarChart } from '@/src/components/dashboard/StatusBarChart';
import { procurementStatusTone } from '@/src/components/dashboard/procurementStatusTone';
import { DashPageHead, DashGrid } from '@/src/components/dashboard/layout';
import { PMDashboard } from '@/src/components/dashboard/PMDashboard';
import { FinanceDashboard } from '@/src/components/dashboard/FinanceDashboard';
import { EngineerDashboard } from '@/src/components/dashboard/EngineerDashboard';
import { AwaitingApprovalTile } from '@/src/components/dashboard/AwaitingApprovalTile';
import { StillToInvoiceCard } from '@/src/components/dashboard/StillToInvoiceCard';
import { MobileExecutiveDashboard } from '@/src/components/dashboard/MobileExecutiveDashboard';
import { useIsDesktop } from '@/src/components/ui/useIsDesktop';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useTimesheetsAwaitingApproval } from '@/src/hooks/useTimesheetApproval';
import { useAuth } from '@/src/auth/useAuth';
import { can } from '@/src/auth/policy';
import { pendingProcurementApprovals } from '@/src/lib/selectors/approvals';
import { AtRiskProjectsLink } from '@/src/components/dashboard/AtRiskProjectsLink';

const ExecutiveDashboard: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { effectiveRole, realRole } = useEffectiveRole();
  // All hooks called unconditionally at the top (hooks rules) — the role switch
  // is the very last statement so no hook is conditional.
  const { data, isPending, isError, refetch } = useDashboard();
  const { data: pipeline, isPending: pipePending, isError: pipeError, refetch: refetchPipe } = useSalesPipeline();
  const isDesktop = useIsDesktop();

  // Approval count — computed unconditionally (hooks rules) so the mobile
  // approvals band has an honest count without re-querying inside the mobile
  // component. The same predicate as AwaitingApprovalTile (H7 — single source).
  const { currentUser } = useAuth();
  const selfId = currentUser?.id;
  // Org-denominated RPC aggregates (no money row of their own) — useOrgCurrency, not a record currency.
  const orgCurrency = useOrgCurrency();
  const { data: procurements, isError: procError } = useProcurements();
  const { data: timesheets, isError: tsError } = useTimesheetsAwaitingApproval();
  const canApproveProc = can('transition', 'procurement', { realRole });
  const mobileApprovalCount = useMemo(() => {
    const procCount = canApproveProc
      ? pendingProcurementApprovals(procurements, selfId, realRole === 'Admin').length
      : 0;
    const tsCount = timesheets?.length ?? 0;
    return procCount + tsCount;
  }, [canApproveProc, procurements, selfId, realRole, timesheets]);

  /** AC-W2-4-06: true when any contributing query errored (shows "—" on mobile band). */
  const mobileApprovalError = Boolean(procError || tsError);

  const procByStatus = useMemo(
    () =>
      (data?.procurements_by_status ?? []).map((s) => ({
        status: s.status as Tables<'procurements'>['status'],
        count: s.count,
      })),
    [data?.procurements_by_status],
  );

  const procurementStatusLabels: Record<string, string> = {
    Draft: t('dashboard.procurementStatus.draft', 'Draft'),
    Requested: t('dashboard.procurementStatus.requested', 'Requested'),
    Approved: t('dashboard.procurementStatus.approved', 'Approved'),
    'Vendor Quoted': t('dashboard.procurementStatus.vendorQuoted', 'Vendor Quoted'),
    Ordered: t('dashboard.procurementStatus.ordered', 'Ordered'),
    Received: t('dashboard.procurementStatus.received', 'Received'),
    'Vendor Invoiced': t('dashboard.procurementStatus.vendorInvoiced', 'Vendor Invoiced'),
    Paid: t('dashboard.procurementStatus.paid', 'Paid'),
  };

  const renderExecutiveView = () => {
    if (isPending) {
      return (
        <section
          data-testid="dashboard-loading"
          aria-label={t('dashboard.kpiBand.label', 'Portfolio KPIs')}
          className="grid grid-cols-1 gap-3 min-[560px]:grid-cols-2 min-[920px]:grid-cols-3 min-[1180px]:grid-cols-6"
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <KPITile key={i} loading tone="blue" icon="grid" label="" value="" />
          ))}
        </section>
      );
    }
    if (isError || !data) {
      return (
        <div data-testid="dashboard-error">
          <ListState
            variant="error"
            title={t('dashboard.error.title', "Couldn't load the dashboard")}
            sub={t('dashboard.error.sub', 'The dashboard query failed. Retry, or check back shortly.')}
            onRetry={() => refetch()}
          />
        </div>
      );
    }
    const isEmpty = data.top_projects.length === 0 && data.procurements_by_status.length === 0;
    if (isEmpty) {
      return (
        <div data-testid="dashboard-empty">
          <ListState
            variant="empty"
            icon="grid"
            title={t('dashboard.empty.title', 'No data yet')}
            sub={t('dashboard.empty.sub', 'Create your first project to see portfolio KPIs here.')}
          />
        </div>
      );
    }

    const money = (value: number | null) => formatDashboardMoney(value, orgCurrency, i18n.language)
      ?? t('uxs03.notAvailableYet', 'Not available yet');
    const mixedPipelineCurrencies = (data.pipeline_total_value_by_currency ?? []).length > 1;
    const unknownMarginProjects = (data.on_hand_realized_margin_by_currency ?? [])
      .reduce((sum, item) => sum + item.unknown_projects, 0);
    const marginLabel = unknownMarginProjects > 0
      ? t('uxs03.realizedMarginKnown', 'Known margin on billed work')
      : t('uxs03.realizedMargin', 'Margin on billed work');
    const actualCoverage = t('uxs03.coverage', 'Actual available for {{known}} of {{total}} delivery projects', {
      known: data.on_hand_actual_project_count ?? 0, total: data.on_hand_actual_project_total ?? 0,
    }) + ' · ' + t('uxs03.coverageCategories', 'Actual coverage: {{known}} of {{total}} mapped cost categories', {
      known: data.on_hand_actual_coverage_count ?? 0, total: data.on_hand_actual_coverage_total ?? 0,
    });
    const weightedPct = data.pipeline_projected_margin === null
      ? mixedPipelineCurrencies
        ? t('uxs03.mixedCurrencyTotalUnavailable', 'Unavailable for mixed currencies')
        : data.pipeline_total_value === 0
          ? t('uxs03.noPipelineValue', 'No pipeline value to calculate margin')
          : t('uxs03.noActiveBudget', 'No active budget')
      : `${(data.pipeline_projected_margin * 100).toFixed(1)}%`;

    /** Chart/detail section — shared between mobile (below fold) and desktop. */
    const chartsSection = (
      <>
        {/* OD-BILL-1 / #786: what is still to invoice on the client's POs (gated inside on salesInvoice.view). */}
        <StillToInvoiceCard />
        <DashGrid>
          <Card data-testid="dashboard-pipeline">
            <span className="sr-only">{`${data.active_projects} ${t('dashboard.sr.activeProjects', 'active projects')}`}</span>
            <CardHead>{t('uxs03.spendingContract', 'Spending vs contract')}</CardHead>
            <div className="px-4 pb-3.5">
              {data.top_projects.length === 0 ? (
                <ListState
                  variant="empty"
                  icon="folder"
                  title={t('dashboard.chart.bva.empty', 'No active projects yet')}
                />
              ) : (
                <BvACard projects={data.top_projects} currency={orgCurrency} />
              )}
            </div>
          </Card>

          <WinRateCard currency={orgCurrency} />
        </DashGrid>

        <DashGrid>
          <Card data-testid="dashboard-proc-status">
            <span className="sr-only">{`${data.procurements_by_status.length} ${t('dashboard.sr.statuses', 'statuses')}`}</span>
            <CardHead>{t('uxs03.pmoPurchasing', 'PMO purchasing requests')}</CardHead>
            <p className="px-4 text-xs text-muted-foreground">{t('uxs03.pmoPurchasingScope', 'ERP-native purchases are outside this PMO request chart.')}</p>
            <div className="px-4 pb-4 pt-2">
              {procByStatus.length === 0 ? (
                <ListState
                  variant="empty"
                  icon="cart"
                  title={t('dashboard.chart.procStatus.empty', 'No procurement activity yet')}
                />
              ) : (
                <StatusBarChart
                  data={procByStatus}
                  toneFor={procurementStatusTone}
                  label={t('dashboard.chart.procStatus.chartLabel', 'Procurement by status')}
                  noun={t('dashboard.chart.procStatus.noun', 'requests')}
                  hrefFor={(s) => `/procurement?status=${encodeURIComponent(s)}`}
                  labelFor={(status) => procurementStatusLabels[status] ?? status}
                />
              )}
            </div>
          </Card>

          <Card data-testid="dashboard-pipeline-margin">
            {/* DASH-002: the chart heading reads the SAME canonical noun as the KPI tile
                ("Pipeline forecast margin"), not the divergent "Pipeline — Projected Margin". */}
            <CardHead>{t('dashboard.chart.pipelineMargin.title', 'Pipeline forecast margin')}</CardHead>
            <div className="px-4 pb-4 pt-3">
              {pipeError ? (
                <ListState
                  variant="error"
                  title={t('dashboard.chart.pipelineMargin.error', "Couldn't load the pipeline")}
                  onRetry={() => refetchPipe()}
                />
              ) : pipePending ? (
                <ListState variant="loading" rows={5} />
              ) : mixedPipelineCurrencies ? (
                <p className="text-sm text-muted-foreground">{t('uxs03.mixedCurrencyTotalUnavailable', 'Unavailable for mixed currencies')}</p>
              ) : !pipeline || pipeline.stages.length === 0 ? (
                <ListState
                  variant="empty"
                  icon="pipe"
                  title={t('dashboard.chart.pipelineMargin.empty', 'No open pipeline')}
                />
              ) : (
                <ProjectedMarginBars projectedMargin={data.pipeline_projected_margin} stages={pipeline.stages} currency={orgCurrency} />
              )}
            </div>
          </Card>
        </DashGrid>
      </>
    );

    // ── Mobile branch (<768px, useIsDesktop()=false) ──────────────────────────
    // Single-render seam: exactly one DOM branch (mobile or desktop) is in the
    // tree at a time. No dual a11y tree, no flash of wrong layout on first paint.
    if (!isDesktop) {
      return (
        <div className="space-y-4">
          <DashPageHead
            title={t('dashboard.title', 'Executive Dashboard')}
            sub={t('dashboard.subtitle.mobile', 'What needs your attention across the contracting book.')}
          />
          <MobileExecutiveDashboard
            data={data}
            headingAction={<BoardPackAction />}
            approvalCount={mobileApprovalCount}
            approvalError={mobileApprovalError}
            belowFold={<div className="mt-3 space-y-4">{chartsSection}</div>}
          />
        </div>
      );
    }

    // ── Desktop branch (≥768px) — VERBATIM existing layout ───────────────────
    return (
      <div className="space-y-4">
        <DashPageHead
          title={t('dashboard.title', 'Executive Dashboard')}
          sub={t(
            'dashboard.subtitle.desktop',
            'Portfolio health across the contracting book — margin on hand, pipeline forecast, and delivery exposure.',
          )}
          actions={<BoardPackAction />}
        />

        <section aria-label={t('uxs03.attentionAndApprovals', 'Attention and approvals')} className="space-y-2">
          <AtRiskProjectsLink count={data.projects_at_risk}
            className="inline-flex min-h-8 items-center font-medium text-warning-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring" />
          <AwaitingApprovalTile includeTimesheets />
        </section>

        {/* KPI band follows actionable work. */}
        <section
          aria-label={t('dashboard.kpiBand.label', 'Portfolio KPIs')}
          className="grid grid-cols-1 gap-3 min-[560px]:grid-cols-2 min-[920px]:grid-cols-3 min-[1180px]:grid-cols-6"
        >
          {/* Revenue on hand: PLAIN tile — no single "on-hand" list view exists (OD-W5-C2-D).
              The tile shows `on_hand_value` — a REVENUE figure (can exceed total contract value),
              NOT a margin $ (SP-7 honesty). The true realized margin RATIO rides as the `vs` sub. */}
          <KPITile
            testId="kpi-on-hand-margin"
            tone="green"
            icon="dollar"
            label={t('uxs03.contractValueOnHand', 'Contract value on hand')}
            value={money(data.on_hand_value)}
            vs={t('uxs03.contractRemaining', 'Contract remaining after known Actual') + ': ' + money(data.on_hand_contract_remaining)
              + ' · ' + marginLabel + ': ' + money(data.on_hand_realized_margin) + ' · ' + actualCoverage}
            helpLabel={t('dashboard.kpi.aboutMetric', 'About this metric')}
            help={t(
              'dashboard.kpi.revenueOnHand.help',
              'Contract value across delivery projects. Margin is billed-work revenue less Actual; it is not cash received.',
            )}
          />
          {/* AC-IXD-DASH-W5-C2A: Pipeline (weighted) → /sales (the pipeline IS the weighted-value view) */}
          <KPITile
            testId="kpi-pipeline-weighted-value"
            tone="violet"
            icon="pipe"
            label={t('dashboard.kpi.pipelineWeighted.label', 'Pipeline (weighted)')}
            value={money(data.pipeline_weighted_value)}
            vs={t('dashboard.kpi.pipelineWeighted.vs', 'of {{gross}} gross', {
              gross: money(data.pipeline_total_value),
            })}
            to="/sales"
            linkLabel={t('dashboard.kpi.pipelineWeighted.linkLabel', 'Open the sales pipeline')}
            help={t(
              'dashboard.kpi.pipelineWeighted.help',
              'Sum of (project value × stage win-probability) across all open stages.',
            )}
          />
          {/* Pipeline forecast margin: PLAIN tile (OD-W5-C2-D — /sales has no margin lens; drilling
              would misrepresent). ONE metric, ONE number — the probability-weighted pipeline
              projected margin only (SP-7). */}
          <KPITile
            testId="kpi-pipeline-projected-margin"
            tone="blue"
            icon="up"
            label={t('dashboard.kpi.pipelineMargin.label', 'Pipeline forecast margin')}
            value={weightedPct}
            vs={t('dashboard.kpi.pipelineMargin.vs', 'probability-weighted')}
            help={t(
              'dashboard.kpi.pipelineMargin.help',
              'Probability-adjusted projected margin across the open pipeline (Σ(value − budget) / Σ value, weighted by stage win-probability).',
            )}
          />
          {/* AC-IXD-DASH-W5-C2A: Active projects → /projects?filter=Ongoing.
              The "N at-risk" vs text stays informational — a11y: whole tile is ONE link; no nested
              interactive. The dedicated at-risk drill is via the PM at-risk tile. */}
          <KPITile
            testId="kpi-active-projects"
            tone="violet"
            icon="folder"
            label={t('dashboard.kpi.activeProjects.label', 'Active projects')}
            value={String(data.active_projects)}
            vs={`${data.projects_at_risk} ${t('dashboard.kpi.activeProjects.vs', 'at-risk')}`}
            to="/projects?filter=Ongoing"
            linkLabel={t('dashboard.kpi.activeProjects.linkLabel', 'Open the active projects list')}
            help={t('dashboard.kpi.activeProjects.help', 'Projects currently in delivery.')}
          />
          {/* AC-IXD-DASH-W5-C2A: Total contract value → /projects?filter=Ongoing.
              vs copy corrected from "active + closed-out" to "active" — the RPC total_contract_value
              is Ongoing-project only; the drill destination matches the data (honesty fix). */}
          <KPITile
            testId="kpi-total-contract-value"
            tone="amber"
            icon="grid"
            label={t('uxs03.contractValueOnHand', 'Contract value on hand')}
            value={money(data.total_contract_value)}
            vs={t('dashboard.kpi.totalContractValue.vs', 'active projects')}
            to="/projects?filter=Ongoing"
            linkLabel={t(
              'dashboard.kpi.totalContractValue.linkLabel',
              'Open active projects to see total contract value',
            )}
            help={t(
              'dashboard.kpi.totalContractValue.help',
              'Total contract value across the active portfolio.',
            )}
          />
          {/* AC-IXD-DASH-W5-C2A: Total project spend → /projects?filter=Ongoing */}
          <KPITile
            testId="kpi-total-spend"
            tone="red"
            icon="cart"
            label={t('dashboard.kpi.totalSpend.label', 'Total project spend')}
            value={money(data.on_hand_actual_known)}
            vs={t('uxs03.coverage', 'Actual available for {{known}} of {{total}} delivery projects', {
              known: data.on_hand_actual_project_count ?? 0, total: data.on_hand_actual_project_total ?? 0,
            })}
            to="/projects?filter=Ongoing"
            linkLabel={t(
              'dashboard.kpi.totalSpend.linkLabel',
              'Open active projects to see spend breakdown',
            )}
            help={t(
              'dashboard.kpi.totalSpend.help',
              "Sum of actual spend across the portfolio's top projects. (A committed-spend aggregate is a deferred follow-up.)",
            )}
          />
        </section>

        {chartsSection}
      </div>
    );
  };

  // Per-role presentation selection off the impersonation-aware effectiveRole
  // (ADR-0008 — never touches RLS). Hooks above are unconditional.
  switch (effectiveRole) {
    case 'Engineer':
      return <EngineerDashboard />;
    case 'Project Manager':
      return <PMDashboard />;
    case 'Finance':
      return <FinanceDashboard />;
    default:
      return renderExecutiveView();
  }
};

export default ExecutiveDashboard;
