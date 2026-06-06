import React, { useMemo, useState } from 'react';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useDashboard, useSalesPipeline } from '@/src/hooks/useDashboard';
import { KPITile } from '@/src/components/ui/KPITile';
import { Card, CardHead } from '@/src/components/ui/Card';
import { Button } from '@/src/components/ui/Button';
import { Icon } from '@/src/components/ui/icons';
import { ListState } from '@/src/components/ui/ListState';
import { useToast } from '@/src/components/ui/Toast';
import { formatCurrency } from '@/src/lib/format';
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

type MarginLens = 'onhand' | 'weighted';

const ExecutiveDashboard: React.FC = () => {
  const { effectiveRole } = useEffectiveRole();
  // All hooks called unconditionally at the top (hooks rules) — the role switch
  // is the very last statement so no hook is conditional.
  const { data, isPending, isError, refetch } = useDashboard();
  const { data: pipeline, isPending: pipePending, isError: pipeError, refetch: refetchPipe } = useSalesPipeline();
  const { toast } = useToast();
  const [lens, setLens] = useState<MarginLens>('onhand');

  const procByStatus = useMemo(
    () =>
      (data?.procurements_by_status ?? []).map((s) => ({
        status: s.status as Tables<'procurements'>['status'],
        count: s.count,
      })),
    [data?.procurements_by_status],
  );

  const renderExecutiveView = () => {
    if (isPending) {
      return (
        <section
          data-testid="dashboard-loading"
          aria-label="Portfolio KPIs"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 min-[920px]:grid-cols-3 min-[1180px]:grid-cols-6"
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
            title="Couldn't load the dashboard"
            sub="The dashboard query failed. Retry, or check back shortly."
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
            title="No data yet"
            sub="Create your first project to see portfolio KPIs here."
          />
        </div>
      );
    }

    const onHandPct = `${(data.on_hand_margin * 100).toFixed(1)}%`;
    const weightedPct = `${(data.pipeline_projected_margin * 100).toFixed(1)}%`;

    return (
      <div className="space-y-4">
        <DashPageHead
          title="Executive Dashboard"
          sub="Portfolio health across the contracting book — margin on hand, pipeline forecast, and delivery exposure."
          actions={
            <Button
              variant="outline"
              onClick={() => toast('Generating board pack…', undefined, 'info')}
            >
              <Icon name="export" />
              Board pack
            </Button>
          }
        />

        {/* KPI band — reflows 6 → 3 → 2 → 1 at 1180 / 920 / 560 (mockup breakpoints). */}
        <section
          aria-label="Portfolio KPIs"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 min-[920px]:grid-cols-3 min-[1180px]:grid-cols-6"
        >
          <KPITile testId="kpi-on-hand-margin" tone="green" icon="dollar" label="On-hand margin"
            value={formatCurrency(data.on_hand_value)} vs={`${onHandPct} realized`}
            help="Realized actual margin on active + closed-out contracts: booked value minus actual cost to date." />
          <KPITile testId="kpi-pipeline-weighted-value" tone="violet" icon="pipe" label="Pipeline (weighted)"
            value={formatCurrency(data.pipeline_weighted_value)} vs={`of ${formatCurrency(data.pipeline_total_value)} gross`}
            help="Sum of (opportunity value × stage win-probability) across all open stages." />
          <KPITile<MarginLens>
            testId="kpi-pipeline-projected-margin" tone="blue" icon="up" label="Projected margin"
            value={lens === 'onhand' ? onHandPct : weightedPct}
            help="Two lenses: on-hand (delivered) vs weighted (probability-adjusted pipeline). Toggle to compare."
            dual={{
              lens,
              options: [
                { value: 'onhand', label: 'On-hand' },
                { value: 'weighted', label: 'Weighted' },
              ],
              onLens: setLens,
            }} />
          <KPITile testId="kpi-active-projects" tone="cyan" icon="folder" label="Active projects"
            value={String(data.active_projects)} vs={`${data.projects_at_risk} at-risk`}
            help="Projects currently in delivery." />
          <KPITile testId="kpi-total-contract-value" tone="amber" icon="grid" label="Total contract value"
            value={formatCurrency(data.total_contract_value)} vs="active + closed-out"
            help="Total contract value across the active portfolio." />
          <KPITile testId="kpi-total-spend" tone="red" icon="cart" label="Total project spend"
            value={formatCurrency(data.top_projects.reduce((s, p) => s + (p.spent || 0), 0))}
            vs="actual to date"
            help="Sum of actual spend across the portfolio's top projects. (A committed-spend aggregate is a deferred follow-up.)" />
        </section>

        <DashGrid>
          <Card data-testid="dashboard-pipeline">
            <span className="sr-only">{`${data.active_projects} active projects`}</span>
            <CardHead>Budget vs Actual — Active Projects</CardHead>
            <div className="px-4 pb-3.5">
              {data.top_projects.length === 0 ? (
                <ListState variant="empty" icon="folder" title="No active projects yet" />
              ) : (
                <BvACard projects={data.top_projects} />
              )}
            </div>
          </Card>

          <WinRateCard />
        </DashGrid>

        <DashGrid>
          <Card data-testid="dashboard-proc-status">
            <span className="sr-only">{`${data.procurements_by_status.length} statuses`}</span>
            <CardHead>Procurement by Status</CardHead>
            <div className="px-4 pb-4 pt-2">
              {procByStatus.length === 0 ? (
                <ListState variant="empty" icon="cart" title="No procurement activity yet" />
              ) : (
                <StatusBarChart data={procByStatus} toneFor={procurementStatusTone}
                  label="Procurement by status" noun="requests" />
              )}
            </div>
          </Card>

          <Card>
            <CardHead>Pipeline — Projected Margin</CardHead>
            <div className="px-4 pb-4 pt-3">
              {pipeError ? (
                <ListState variant="error" title="Couldn't load the pipeline" onRetry={() => refetchPipe()} />
              ) : pipePending ? (
                <ListState variant="loading" rows={5} />
              ) : !pipeline || pipeline.stages.length === 0 ? (
                <ListState variant="empty" icon="pipe" title="No open pipeline" />
              ) : (
                <ProjectedMarginBars projectedMargin={data.pipeline_projected_margin} stages={pipeline.stages} />
              )}
            </div>
          </Card>
        </DashGrid>
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
