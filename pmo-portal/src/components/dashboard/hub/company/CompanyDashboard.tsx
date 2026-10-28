import React from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui/Button';
import { Card, CardHead } from '@/src/components/ui/Card';
import { DataTable, MenuButton, type Column, type RowMenuItem } from '@/src/components/ui/DataTable';
import { Icon } from '@/src/components/ui/icons';
import { KPIRow, KPITile } from '@/src/components/ui/KPITile';
import { ListState } from '@/src/components/ui/ListState';
import { ProgressBar } from '@/src/components/ui/ProgressBar';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { Tooltip } from '@/src/components/ui/Tooltip';
import { ExportButton } from '@/src/components/export/ExportButton';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { can } from '@/src/auth/policy';
import { useFinanceBudgetReview, useSalesPipeline } from '@/src/hooks/useDashboard';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useProjects } from '@/src/hooks/useProjects';
import { useActualsSnapshot, useApAgingSnapshot, useArAgingSnapshot } from '@/src/hooks/useErpSnapshots';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { useProjectStatusLabel, useProcurementStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import { useCompanyFigures } from '@/src/components/dashboard/restructure/useCompanyFigures';
import { useNeedsYou, type NeedsItem } from '@/src/components/dashboard/restructure/useNeedsYou';
import { FigureGroup, type DashboardFigure } from '@/src/components/dashboard/restructure/FigureGroup';
import { PeriodPicker } from '@/src/components/dashboard/restructure/PeriodPicker';
import { usePeriod } from '@/src/components/dashboard/restructure/usePeriod';
import { AccountingSnapshotsSection } from '@/src/components/dashboard/AccountingSnapshotsSection';
import { StatusBarChart } from '@/src/components/dashboard/StatusBarChart';
import { procurementStatusTone } from '@/src/components/dashboard/procurementStatusTone';
import { WinRateCard } from '@/src/components/dashboard/WinRateCard';
import { formatCurrency } from '@/src/lib/format';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { ACTIVE_PROJECT_STATUSES } from '@/src/lib/db/projects';
import type { ExecutiveDashboard as DashboardData, BudgetReviewRow, PipelineStage, PipelineProject } from '@/src/lib/db/dashboard';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type { Role } from '@/src/auth/AuthContext';
import { ApprovalStrip, AreaPanel, AttentionList, HubGrid } from '../index';

const ICONS: Record<string, 'grid' | 'dollar' | 'pipe' | 'cart' | 'clock' | 'file'> = {
  'contract-on-hand': 'grid', 'billed-margin': 'dollar', pipeline: 'pipe',
  'client-overdue': 'clock', 'supplier-payables': 'cart', 'still-to-invoice': 'file',
};
const TONES: Record<string, 'blue' | 'green' | 'violet' | 'amber' | 'red'> = {
  'contract-on-hand': 'blue', 'billed-margin': 'green', pipeline: 'violet',
  'client-overdue': 'amber', 'supplier-payables': 'red', 'still-to-invoice': 'amber',
};

const money = (value: number | null, currency: string, unavailable = '—') =>
  value === null || !Number.isFinite(value) ? unavailable : formatCurrency(value, currency);

function statusVariant(status: string): 'open' | 'progress' | 'won' | 'lost' | 'warn' | 'neutral' {
  if (/won|complete|paid/i.test(status)) return 'won';
  if (/lost|cancel|reject/i.test(status)) return 'lost';
  if (/risk|overdue|requested|invoice/i.test(status)) return 'warn';
  if (/ongoing|progress|delivery/i.test(status)) return 'progress';
  if (/tender|submitted|qualified/i.test(status)) return 'open';
  return 'neutral';
}

function needsAttention(items: NeedsItem[], ids: string[], t: (key: string, fallback: string) => string) {
  const selected = items.filter((item) => ids.includes(item.id));
  return selected.map((item) => ({
    id: item.id,
    tone: item.tone,
    icon: item.id.includes('invoice') || item.id === 'ready-to-bill' ? 'dollar' as const : item.id.includes('procurement') ? 'cart' as const : 'alert' as const,
    count: item.count,
    label: item.label,
    amount: item.amount,
    href: item.href,
    tooltip: item.id === 'budgets-over' ? t('dashboard:hub.company.budgetAttentionHelp', 'A project budget is over its recorded spend comparison.') : undefined,
  }));
}

function ProjectSpendTable({ dashboard, projects, pending, error, retry }: {
  dashboard: DashboardData | undefined;
  projects: ReturnType<typeof useProjects>['data'];
  pending: boolean;
  error: boolean;
  retry: () => void;
}) {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const statusLabel = useProjectStatusLabel();
  const owners = new Map((projects ?? []).map((project) => [project.id, project.pm?.full_name ?? null]));
  const activeStatuses = new Set<string>(ACTIVE_PROJECT_STATUSES);
  const rows = (dashboard?.top_projects ?? []).filter((row) => activeStatuses.has(row.status)).map((row) => {
    const comparable = row.contract_value != null && row.contract_value > 0 && row.spent != null && row.actual_complete && row.actual_currency === row.currency;
    const percent = comparable ? Math.round(row.spent! / row.contract_value! * 100) : null;
    return { row, percent };
  }).sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1)).slice(0, 5);
  const state = pending ? 'loading' : error ? 'error' : rows.length === 0 ? 'empty' : undefined;
  if (state) return <ListState variant={state} rows={3} title={state === 'empty' ? t('dashboard:hub.company.noProjects', 'No delivery projects to compare yet') : state === 'error' ? t('dashboard:hub.company.projectsError', "Couldn't load delivery projects") : undefined} onRetry={retry} />;
  return <div className="grid gap-2">
    <p className="text-xs text-muted-foreground">{t('dashboard:hub.company.topContractProjectsAttentionOrder', 'Largest 5 projects by contract, most attention first')}</p>
    <ul className="divide-y divide-border" aria-label={t('dashboard:hub.company.spendingVsContract', 'Spending vs contract')}>
      {rows.map(({ row, percent }) => {
        const name = projectDisplayName(row);
        const manager = owners.get(row.id) ?? t('dashboard:hub.company.managerUnknown', 'Manager unavailable');
        const contract = row.contract_value == null ? '—' : money(row.contract_value, row.currency);
        const spent = row.spent == null ? '—' : money(row.spent, row.actual_currency ?? row.currency);
        const menu: RowMenuItem[] = [
          { label: t('dashboard:hub.company.openProject', 'Open project'), onClick: () => navigate(`/projects/${row.id}`) },
          { label: t('dashboard:hub.company.openBudget', 'Open budget'), onClick: () => navigate(`/projects/${row.id}/budget`) },
          { label: t('dashboard:hub.company.openProcurements', 'Open procurements'), onClick: () => navigate(`/procurement?project=${encodeURIComponent(row.id)}`) },
        ];
        return <li key={row.id} className="grid gap-1.5 py-2 first:pt-0 last:pb-0">
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1">
              <Link to={`/projects/${row.id}`} className="block truncate text-sm font-medium text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{name}</Link>
              <p className="truncate text-xs text-muted-foreground">{manager} · {contract}</p>
            </div>
            <StatusPill variant={statusVariant(row.status)}>{statusLabel(row.status)}</StatusPill>
            <MenuButton ariaLabel={t('dashboard:hub.company.rowActionsFor', 'Row actions for {{name}}', { name })} items={menu} />
          </div>
          {percent == null ? <span className="text-xs text-muted-foreground" title={t('dashboard:hub.company.usedUnknown', 'Recorded spending is incomplete or uses a different currency.')}>{t('dashboard:hub.company.spentLabel', 'Spent')} —<span className="sr-only"> {t('dashboard:hub.company.usedUnknown', 'Recorded spending is incomplete or uses a different currency.')}</span></span> : <Tooltip block content={t('dashboard:hub.company.spentOfContract', 'Spent {{spent}} of {{contract}} contract', { spent, contract })}><div className="flex w-full items-center gap-2"><ProgressBar value={percent} widthless className="min-w-0 flex-1 [&>span:first-child]:flex-1" aria-label={t('dashboard:hub.company.usedNamedAria', '{{name}}: {{percent}}% of contract used', { name, percent })} /><span className="w-10 text-right text-xs tabular">{percent}%</span></div></Tooltip>}
        </li>;
      })}
    </ul>
    {(projects?.length ?? 0) > 0 && <Link to="/projects" className="inline-flex min-h-11 items-center text-sm font-medium text-primary-text hover:underline">{t('dashboard:hub.company.viewAllProjects', 'View all {{count}} projects', { count: projects!.length })}</Link>}
  </div>;
}

function PipelineStages({ stages, projects, pending, error, retry }: { stages: PipelineStage[]; projects: PipelineProject[]; pending: boolean; error: boolean; retry: () => void }) {
  const { t } = useTranslation('dashboard');
  const statusLabel = useProjectStatusLabel();
  if (pending) return <ListState variant="loading" rows={4} />;
  if (error) return <ListState variant="error" title={t('dashboard:hub.company.pipelineError', "Couldn't load pipeline stages")} onRetry={retry} />;
  if (stages.length === 0) return <ListState variant="empty" icon="pipe" title={t('dashboard:hub.company.noPipeline', 'No open pipeline stages')} />;
  return <div className="divide-y divide-border">
    {stages.map((stage) => {
      const totals = new Map<string, number>();
      projects.filter((project) => project.status === stage.status).forEach((project) => totals.set(project.currency, (totals.get(project.currency) ?? 0) + project.contract_value));
      const gross = [...totals].map(([currency, amount]) => formatCurrency(amount, currency)).join(' · ') || '—';
      return (
        <Link key={stage.status} to={`/sales?status=${encodeURIComponent(stage.status)}`} className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 py-2 text-sm hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
          <span className="font-medium">{statusLabel(stage.status)}</span><span className="text-right tabular text-muted-foreground">{stage.count}</span><span className="text-right tabular" title={gross === '—' ? t('dashboard:hub.company.stageGrossUnknown', 'The pipeline source did not provide comparable project values for this stage.') : undefined}>{gross}{gross === '—' && <span className="sr-only"> {t('dashboard:hub.company.stageGrossUnknown', 'The pipeline source did not provide comparable project values for this stage.')}</span>}</span><span className="text-right tabular text-muted-foreground" title={t('dashboard:hub.company.stageMarginUnknown', 'The current pipeline source does not return forecast margin by stage.')}>—</span>
        </Link>
      );
    })}
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-3 pt-2 text-[11px] text-muted-foreground"><span>{t('dashboard:hub.company.stage', 'Stage')}</span><span>{t('dashboard:hub.company.count', 'Count')}</span><span>{t('dashboard:hub.company.gross', 'Gross')}</span><span>{t('dashboard:hub.company.forecastMargin', 'Forecast margin')}</span></div>
  </div>;
}

function ReadyToPayTable({ rows, pending, error, retry }: { rows: ProcurementWithRefs[]; pending: boolean; error: boolean; retry: () => void }) {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const statusLabel = useProcurementStatusLabel();
  const displayStatus = (status: string) => status === 'Vendor Invoiced' ? t('dashboard:hub.company.supplierInvoiced', 'Supplier invoiced') : status === 'Vendor Quoted' ? t('dashboard:hub.company.supplierQuoted', 'Supplier quoted') : statusLabel(status);
  const ready = rows.filter((row) => row.status === 'Vendor Invoiced');
  const columns: Column<ProcurementWithRefs>[] = [
    { key: 'procurement', header: t('dashboard:hub.company.procurement', 'Procurement'), rowHeader: true, cell: (row) => <span className="font-medium">{row.title}</span>, exportValue: (row) => row.title },
    { key: 'project', header: t('dashboard:hub.company.project', 'Project'), cell: (row) => row.project?.name ?? <span title={t('dashboard:hub.company.projectUnknown', 'Project is not linked to this procurement.')}>—</span>, exportValue: (row) => row.project?.name ?? '' },
    { key: 'supplier', header: t('dashboard:hub.company.supplier', 'Supplier'), cell: (row) => row.vendor?.name ?? <span title={t('dashboard:hub.company.supplierUnknown', 'Supplier is not recorded on this procurement.')}>—</span>, exportValue: (row) => row.vendor?.name ?? '' },
    { key: 'amount', header: t('dashboard:hub.company.amount', 'Amount'), kind: 'money', align: 'num', cell: (row) => formatCurrency(row.total_value, row.currency), exportValue: (row) => row.total_value },
    { key: 'age', header: t('dashboard:hub.company.daysSinceInvoice', 'Days since invoiced'), align: 'num', cell: (row) => { const stamp = row.vendor_invoiced_at ?? row.updated_at; const days = Math.max(0, Math.floor((Date.now() - new Date(stamp).getTime()) / 86400000)); return <span title={t('dashboard:hub.company.invoiceAgeHelp', 'Uses the recorded supplier invoice date; legacy rows use their last update.')}>{days}</span>; }, exportValue: (row) => Math.max(0, Math.floor((Date.now() - new Date(row.vendor_invoiced_at ?? row.updated_at).getTime()) / 86400000)) },
    { key: 'due', header: t('dashboard:hub.company.dueState', 'Due state'), cell: () => <span title={t('dashboard:hub.company.dueUnknown', 'The procurement record does not include a supplier invoice due date.')}>—</span>, exportValue: () => '' },
    { key: 'status', header: t('dashboard:hub.company.status', 'Status'), cell: (row) => <StatusPill variant="warn">{displayStatus(row.status)}</StatusPill>, exportValue: (row) => displayStatus(row.status) },
  ];
  return <DataTable rows={ready} columns={columns} rowKey={(row) => row.id} onActivate={(row) => navigate(`/procurement/${row.id}`)} rowLabel={(row) => t('dashboard:hub.company.openProcurementNamed', 'Open {{name}}', { name: row.title })} rowMenu={(row) => [{ label: t('dashboard:hub.company.openProcurement', 'Open procurement'), onClick: () => navigate(`/procurement/${row.id}`) }]} state={pending ? 'loading' : error ? 'error' : ready.length === 0 ? 'empty' : undefined} onRetry={retry} emptyTitle={t('dashboard:hub.company.nothingReadyToPay', 'No supplier invoices are awaiting payment')} errorTitle={t('dashboard:hub.company.readyToPayError', "Couldn't load ready-to-pay records")} tableId="dashboard-company-ready-to-pay" className="rounded-t-none border-t-0" />;
}

function BudgetReviewTable({ rows, pending, error, retry }: { rows: BudgetReviewRow[]; pending: boolean; error: boolean; retry: () => void }) {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const statusLabel = useProjectStatusLabel();
  const columns: Column<BudgetReviewRow>[] = [
    { key: 'project', header: t('dashboard:hub.company.project', 'Project'), rowHeader: true, cell: (row) => <span className="font-medium">{projectDisplayName(row)}</span>, exportValue: (row) => projectDisplayName(row) },
    { key: 'budget', header: t('dashboard:hub.company.budget', 'Budget'), kind: 'money', align: 'num', cell: (row) => formatCurrency(row.budget, row.currency), exportValue: (row) => row.budget },
    { key: 'spent', header: t('dashboard:hub.company.spent', 'Spent'), kind: 'money', align: 'num', cell: (row) => row.spent === null || !row.actual_complete || row.actual_currency !== row.currency ? <span title={t('dashboard:hub.company.spentUnknown', 'Recorded spending is incomplete or uses a different currency.')}>—</span> : formatCurrency(row.spent, row.currency), exportValue: (row) => row.spent ?? '' },
    { key: 'used', header: t('dashboard:hub.company.percentUsed', '% used'), kind: 'percent', cell: (row) => { const pct = row.actual_complete && row.spent !== null && row.budget > 0 && row.actual_currency === row.currency && row.budget_currency === row.currency ? Math.round(row.spent / row.budget * 100) : null; return pct === null ? <span title={t('dashboard:hub.company.budgetUsedUnknown', 'Budget or recorded spending cannot be compared.')}>—</span> : <div className="flex min-w-24 items-center gap-2"><ProgressBar value={pct} widthless className="min-w-10 flex-1" aria-label={t('dashboard:hub.company.usedAria', '{{percent}}% of contract used', { percent: pct })} /><span>{pct}%</span></div>; }, exportValue: (row) => row.spent !== null && row.budget > 0 ? row.spent / row.budget : '' },
    { key: 'variance', header: t('dashboard:hub.company.variance', 'Variance'), kind: 'money', align: 'num', cell: (row) => row.variance === null ? <span title={t('dashboard:hub.company.varianceUnknown', 'Recorded spending or budget currency is incomplete.')}>—</span> : formatCurrency(row.variance, row.currency), exportValue: (row) => row.variance ?? '' },
    { key: 'status', header: t('dashboard:hub.company.status', 'Status'), cell: (row) => <StatusPill variant={statusVariant(row.status)}>{statusLabel(row.status)}</StatusPill>, exportValue: (row) => statusLabel(row.status) },
    { key: 'review', header: t('dashboard:hub.company.review', 'Review'), cell: (row) => <Link to={`/projects/${row.id}/budget`} className="inline-flex min-h-11 items-center text-primary-text hover:underline">{t('dashboard:hub.company.reviewBudget', 'Review budget')}</Link>, exportValue: () => '' },
  ];
  return <DataTable rows={rows} columns={columns} rowKey={(row) => row.id} onActivate={(row) => navigate(`/projects/${row.id}/budget`)} rowLabel={(row) => t('dashboard:hub.company.openBudgetFor', 'Open budget for {{name}}', { name: projectDisplayName(row) })} rowMenu={(row) => [
    { label: t('dashboard:hub.company.openProject', 'Open project'), onClick: () => navigate(`/projects/${row.id}`) },
    { label: t('dashboard:hub.company.openBudget', 'Open budget'), onClick: () => navigate(`/projects/${row.id}/budget`) },
  ]} state={pending ? 'loading' : error ? 'error' : rows.length === 0 ? 'empty' : undefined} onRetry={retry} emptyTitle={t('dashboard:hub.company.noBudgetReviews', 'No project budgets to review')} errorTitle={t('dashboard:hub.company.budgetReviewError', "Couldn't load budget review")} tableId="dashboard-company-budget-review" className="rounded-t-none border-t-0" />;
}

function FinanceTableCard<Row>({ title, rows, columns, help, children }: { title: string; rows: Row[]; columns: Column<Row>[]; help: string; children: React.ReactNode }) {
  const { t } = useTranslation('dashboard');
  return <Card><CardHead actions={<div className="flex items-center gap-2"><Tooltip content={help}><button type="button" aria-label={t('dashboard:hub.company.aboutMetric', 'About {{metric}}', { metric: title })} className="touch-target grid size-11 place-items-center rounded-full text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><Icon name="help" /></button></Tooltip><ExportButton rows={rows} columns={columns} entity={title} label={t('dashboard:hub.company.export', 'Export')} /></div>}>{title}</CardHead>{children}</Card>;
}

function ClientAgingBlock() {
  const arAging = useArAgingSnapshot();
  return <AccountingSnapshotsSection showActuals={false} showApAging={false} showArAging embedded actuals={[]} apAging={[]} arAging={arAging.data ?? []} arAgingPending={arAging.isPending} arAgingError={arAging.isError} onRetryArAging={() => void arAging.refetch()} />;
}

function FinanceAccountingBlocks() {
  const actuals = useActualsSnapshot();
  const apAging = useApAgingSnapshot();
  return <AccountingSnapshotsSection showActuals showApAging showArAging={false} actuals={actuals.data ?? []} actualsPending={actuals.isPending} actualsError={actuals.isError} onRetryActuals={() => void actuals.refetch()} apAging={apAging.data ?? []} apAgingPending={apAging.isPending} apAgingError={apAging.isError} onRetryApAging={() => void apAging.refetch()} arAging={[]} />;
}

export function CompanyDashboard({ role }: { role: Extract<Role, 'Executive' | 'Admin' | 'Finance'> }) {
  const { t } = useTranslation('dashboard');
  const { realRole } = useEffectiveRole();
  const canOpenAccountingMap = can('edit', 'budgetLine', { realRole });
  const periodState = usePeriod();
  const figures = useCompanyFigures(periodState.period);
  const needs = useNeedsYou(role);
  const projects = useProjects();
  const procurements = useProcurements();
  const pipeline = useSalesPipeline();
  const budgetReview = useFinanceBudgetReview();
  const orgCurrency = useOrgCurrency();
  const projectStatusLabel = useProjectStatusLabel();
  const procurementLabel = useProcurementStatusLabel();
  const displayProcurementStatus = (status: string) => status === 'Vendor Invoiced' ? t('dashboard:hub.company.supplierInvoiced', 'Supplier invoiced') : status === 'Vendor Quoted' ? t('dashboard:hub.company.supplierQuoted', 'Supplier quoted') : procurementLabel(status);
  const data = figures.dashboard;
  const finance = role === 'Finance';
  const periodFigure = (id: string) => figures.period.find((figure) => figure.id === id);
  const todayFigure = (id: string) => figures.today.find((figure) => figure.id === id);
  const deliveryNeeds = needsAttention(needs.areaItems, ['at-risk', 'budgets-over'], t);
  const billingNeeds = needsAttention(needs.areaItems, ['overdue-invoices', 'ready-to-bill'], t);
  const purchasingNeeds = needsAttention(needs.areaItems, ['procurement-approvals', 'supplier-invoices'], t);
  const order = finance ? ['billing', 'purchasing', 'delivery', 'sales'] : ['delivery', 'sales', 'billing', 'purchasing'];
  const refresh = () => {
    figures.todayRetry(); figures.periodRetry(); figures.dashboardRetry(); figures.pipelineRetry(); needs.refetch();
    void procurements.refetch(); void budgetReview.refetch(); void projects.refetch();
  };
  const help = (id: string) => {
    const reasons: Record<string, string> = {
      'contract-on-hand': t('dashboard:hub.company.help.contract', 'Sum of contract values for delivery work, in each project currency. Left after spending uses complete recorded actuals. Source: dashboard summary.'),
      'billed-margin': t('dashboard:hub.company.help.margin', 'Known margin is billed-work revenue less recorded spending. It is not cash received. The margin amount is available, while the percentage is unavailable until billed revenue is available company-wide.'),
      pipeline: t('dashboard:hub.company.help.pipeline', 'Weighted pipeline is project value multiplied by stage win probability across open opportunities. The forecast margin is shown when the source can compute it.'),
      'client-overdue': t('dashboard:hub.company.help.clientOverdue', 'Count of submitted or unpaid client invoices whose recorded due date has passed. Amounts include only known balances.'),
      'supplier-payables': t('dashboard:hub.company.help.supplierPayables', 'Sum of procurement records in the supplier-invoiced state awaiting payment.'),
      'still-to-invoice': t('dashboard:hub.company.help.unbilled', 'Remaining amount and count from open work orders that are not fully invoiced.'),
      invoiced: t('dashboard:hub.company.help.invoiced', 'Sum of invoices issued within the selected period, excluding tax. Source: management pack by currency.'),
      collected: t('dashboard:hub.company.help.collected', 'Sum of recorded incoming payments received within the selected period. Source: incoming payment records.'),
      won: t('dashboard:hub.company.help.won', 'Count and value of projects recorded as won within the selected period.'),
      'win-rate': t('dashboard:hub.company.help.winRate', 'Won projects divided by won plus lost projects in the selected period. The chart can switch between count and value.'),
    };
    return reasons[id] ?? t('dashboard:hub.company.help.period', 'Period result from the selected date range.');
  };
  const todayError = figures.todayError;
  const invoiceStatus = (data?.procurements_by_status ?? []).map((row) => ({ status: row.status as ProcurementWithRefs['status'], count: row.count }));
  const pipelineStages = pipeline.data?.stages ?? [];
  const commonTodayFigures = ['contract-on-hand', 'billed-margin', 'pipeline', 'client-overdue', 'supplier-payables', 'still-to-invoice'].map((id) => todayFigure(id)).filter((figure): figure is DashboardFigure => Boolean(figure));
  const periodMini = (id: string) => periodFigure(id) ?? { id, label: id, value: null };
  const hasEvidence = Boolean(data && ((data.projects_by_status ?? []).some((row) => row.count > 0) || (data.procurements_by_status ?? []).some((row) => row.count > 0)))
    || Boolean(procurements.data?.length || figures.pipeline?.projects?.length);

  const area = (id: string) => {
    switch (id) {
      case 'delivery': return <AreaPanel key={id} title={t('dashboard:hub.company.delivery', 'Delivery')} openHref="/projects" openLabel={t('dashboard:hub.company.openProjects', 'Open projects')} meta={t('dashboard:hub.company.positionToday', 'Position today · project currency')}>
        <AttentionList compact items={deliveryNeeds} />
        <section className="grid gap-2">
          <div className="flex items-center gap-2"><h3 className="text-sm font-semibold">{t('dashboard:hub.company.spendingVsContract', 'Spending vs contract')}</h3><Tooltip content={t('dashboard:hub.company.projectSpendHelp', 'Used is recorded spending divided by contract value. It is shown only when actuals are complete and currencies match.')}><button type="button" aria-label={t('dashboard:hub.company.aboutProjectSpend', 'About spending versus contract')} className="touch-target grid size-7 place-items-center rounded-full text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><Icon name="help" className="size-3.5" /></button></Tooltip></div>
          <ProjectSpendTable dashboard={data} projects={projects.data} pending={figures.dashboardPending || projects.isPending} error={figures.dashboardError || projects.isError} retry={() => { figures.dashboardRetry(); void projects.refetch(); }} />
        </section>
      </AreaPanel>;
      case 'sales': return <AreaPanel key={id} title={t('dashboard:hub.company.sales', 'Sales')} openHref="/sales" openLabel={t('dashboard:hub.company.openSales', 'Open sales')} meta={t('dashboard:hub.company.period', 'Selected period: {{period}}', { period: periodState.period.label })}>
        <FigureGroup heading={t('dashboard:hub.company.salesFigures', 'Sales results')} figures={[{ ...periodMini('won'), help: help('won') }]} isPending={figures.periodPending} isError={figures.periodError} onRetry={figures.periodRetry} hideHeading />
        <section className="grid gap-2">
          <div className="flex items-center gap-2"><h3 className="text-sm font-semibold">{t('dashboard:hub.company.pipelineByStage', 'Pipeline by stage')}</h3><Tooltip content={t('dashboard:hub.company.help.pipelineStages', 'Stage counts and gross values come from the sales pipeline. Gross is grouped by project currency. The source does not return forecast margin by stage.')}><button type="button" aria-label={t('dashboard:hub.company.aboutPipelineStages', 'About pipeline by stage')} className="touch-target grid size-7 place-items-center rounded-full text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><Icon name="help" className="size-3.5" /></button></Tooltip></div>
          <p className="text-xs text-muted-foreground">{t('dashboard:hub.company.pipelineForecast', 'Overall forecast margin: {{value}}', { value: data?.pipeline_projected_margin == null ? '—' : `${(data.pipeline_projected_margin * 100).toFixed(1)}%` })}</p>
          <PipelineStages stages={pipelineStages} projects={pipeline.data?.projects ?? []} pending={pipeline.isPending} error={pipeline.isError} retry={() => { void pipeline.refetch(); }} />
        </section>
        <WinRateCard currency={orgCurrency} range={figures.winRateRange} hidePeriodControl embedded />
      </AreaPanel>;
      case 'billing': return <AreaPanel key={id} title={t('dashboard:hub.company.billing', 'Billing and collections')} openHref="/sales-invoices" openLabel={t('dashboard:hub.company.openInvoices', 'Open invoices')} meta={t('dashboard:hub.company.taxAndPeriodBasis', 'Invoice amounts exclude tax; collected amounts are recorded receipts. Selected period: {{period}}', { period: periodState.period.label })}>
        <FigureGroup heading={t('dashboard:hub.company.billingFigures', 'Billing results')} figures={[{ ...periodMini('invoiced'), help: help('invoiced') }, { ...periodMini('collected'), help: help('collected') }]} isPending={figures.periodPending} isError={figures.periodError} onRetry={figures.periodRetry} hideHeading />
        <AttentionList compact items={billingNeeds} />
        {finance && <ClientAgingBlock />}
      </AreaPanel>;
      default: return <AreaPanel key={id} title={t('dashboard:hub.company.purchasing', 'Purchasing')} openHref="/procurement" openLabel={t('dashboard:hub.company.openProcurements', 'Open procurements')} meta={t('dashboard:hub.company.positionToday', 'Position today · procurement currency')}>
        <AttentionList compact items={purchasingNeeds} />
        <section className="grid gap-2">
          <div className="flex items-center gap-2"><h3 className="text-sm font-semibold">{t('dashboard:hub.company.purchasingByStage', 'Purchasing by stage')}</h3><Tooltip content={t('dashboard:hub.company.help.purchasesScope', 'Purchases made directly in the accounting system are not counted in this PMO procurement view.')}><button type="button" aria-label={t('dashboard:hub.company.purchasesScopeLabel', 'About purchasing by stage')} className="touch-target grid size-7 place-items-center rounded-full text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><Icon name="help" className="size-3.5" /></button></Tooltip></div>
          <p className="text-xs text-muted-foreground">{t('dashboard:hub.company.accountingPurchasesExcluded', 'Purchases made directly in the accounting system are not counted.')}</p>
          {figures.dashboardError ? <ListState variant="error" title={t('dashboard:hub.company.purchasesError', "Couldn't load purchasing stages")} onRetry={figures.dashboardRetry} /> : figures.dashboardPending ? <ListState variant="loading" rows={3} /> : invoiceStatus.length === 0 ? <ListState variant="empty" icon="cart" title={t('dashboard:hub.company.noPurchases', 'No procurements to show')} /> : <StatusBarChart data={invoiceStatus} toneFor={procurementStatusTone} label={t('dashboard:hub.company.purchasingByStage', 'Purchasing by stage')} noun={t('dashboard:hub.company.procurementPlural', 'procurements')} hrefFor={(status) => `/procurement?status=${encodeURIComponent(status)}`} labelFor={displayProcurementStatus} compactSegments />}
        </section>
      </AreaPanel>;
    }
  };

  const invoiceColumns: Column<ProcurementWithRefs>[] = [
    { key: 'title', header: t('dashboard:hub.company.procurement', 'Procurement'), cell: (row) => row.title, exportValue: (row) => row.title },
    { key: 'project', header: t('dashboard:hub.company.project', 'Project'), cell: (row) => row.project?.name ?? '—', exportValue: (row) => row.project?.name ?? '' },
    { key: 'supplier', header: t('dashboard:hub.company.supplier', 'Supplier'), cell: (row) => row.vendor?.name ?? '—', exportValue: (row) => row.vendor?.name ?? '' },
    { key: 'amount', header: t('dashboard:hub.company.amount', 'Amount'), cell: (row) => formatCurrency(row.total_value, row.currency), exportValue: (row) => row.total_value },
    { key: 'age', header: t('dashboard:hub.company.daysSinceInvoice', 'Days since invoiced'), cell: (row) => Math.max(0, Math.floor((Date.now() - new Date(row.vendor_invoiced_at ?? row.updated_at).getTime()) / 86400000)), exportValue: (row) => Math.max(0, Math.floor((Date.now() - new Date(row.vendor_invoiced_at ?? row.updated_at).getTime()) / 86400000)) },
    { key: 'due', header: t('dashboard:hub.company.dueState', 'Due state'), cell: () => '—', exportValue: () => '' },
    { key: 'status', header: t('dashboard:hub.company.status', 'Status'), cell: (row) => displayProcurementStatus(row.status), exportValue: (row) => displayProcurementStatus(row.status) },
  ];
  const activeStatuses = new Set<string>(ACTIVE_PROJECT_STATUSES);
  const budgetRows = (budgetReview.data ?? []).filter((row) => activeStatuses.has(row.status)).slice(0, 5);
  const budgetColumns: Column<BudgetReviewRow>[] = [
    { key: 'project', header: t('dashboard:hub.company.project', 'Project'), cell: (row) => projectDisplayName(row), exportValue: (row) => projectDisplayName(row) },
    { key: 'budget', header: t('dashboard:hub.company.budget', 'Budget'), cell: (row) => formatCurrency(row.budget, row.currency), exportValue: (row) => row.budget },
    { key: 'spent', header: t('dashboard:hub.company.spent', 'Spent'), cell: (row) => row.spent == null ? '—' : formatCurrency(row.spent, row.currency), exportValue: (row) => row.spent ?? '' },
    { key: 'used', header: t('dashboard:hub.company.percentUsed', '% used'), kind: 'percent', cell: (row) => row.actual_complete && row.spent !== null && row.budget > 0 && row.actual_currency === row.currency && row.budget_currency === row.currency ? row.spent / row.budget : '', exportValue: (row) => row.actual_complete && row.spent !== null && row.budget > 0 && row.actual_currency === row.currency && row.budget_currency === row.currency ? row.spent / row.budget : '' },
    { key: 'variance', header: t('dashboard:hub.company.variance', 'Variance'), cell: (row) => row.variance == null ? '—' : formatCurrency(row.variance, row.currency), exportValue: (row) => row.variance ?? '' },
    { key: 'status', header: t('dashboard:hub.company.status', 'Status'), cell: (row) => projectStatusLabel(row.status), exportValue: (row) => projectStatusLabel(row.status) },
    { key: 'review', header: t('dashboard:hub.company.review', 'Review'), cell: () => t('dashboard:hub.company.reviewBudget', 'Review budget'), exportValue: (row) => `/projects/${row.id}/budget` },
  ];
  if (!figures.todayPending && !figures.periodPending && !figures.pipelinePending && !procurements.isPending && !needs.isPending
    && !figures.dashboardError && !figures.periodError && !figures.pipelineError && !needs.isError && figures.isEmpty && !hasEvidence) {
    return <div className="space-y-4"><h1 className="text-2xl font-bold">{t('dashboard:hub.company.title', 'Dashboard')}</h1><ListState variant="empty" icon="grid" title={t('dashboard:hub.company.emptyTitle', 'No company activity yet')} sub={t('dashboard:hub.company.emptySub', 'Projects, sales, billing, and purchasing will appear here as records are added.')} /></div>;
  }

  return <div className="space-y-4" data-company-role={role}>
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h1 className="text-[24px] font-bold leading-tight tracking-[-0.02em]">{t('dashboard:hub.company.title', 'Dashboard')}</h1><p className="mt-0.5 max-w-[68ch] text-[13.5px] text-muted-foreground">{t('dashboard:hub.company.subtitle', 'Company position across delivery, sales, billing, and purchasing.')}</p></div>
      <div className="flex flex-wrap items-end gap-2"><PeriodPicker period={periodState.period} selectPeriod={periodState.selectPeriod} setCustomMonth={periodState.setCustomMonth} /><Button variant="outline" className="min-h-11 min-w-11 min-[1180px]:h-8" onClick={refresh} aria-label={t('dashboard:hub.company.refresh', 'Refresh dashboard')}><Icon name="refresh" /><span className="hidden sm:inline">{t('dashboard:hub.company.refresh', 'Refresh')}</span></Button></div>
    </header>
    {needs.isPending ? <ListState variant="loading" rows={1} /> : needs.isError ? <ListState variant="error" title={t('dashboard:hub.company.approvalsError', "Couldn't load approvals and attention items")} onRetry={needs.refetch} /> : <section aria-label={t('dashboard:hub.company.approvals', 'Approvals waiting for you')}><ApprovalStrip items={needs.items.filter((item) => item.id === 'approvals').map((item) => ({ id: item.id, tone: item.tone, icon: 'check', count: item.count, label: item.label, href: item.href }))} /></section>}
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">{t('dashboard:hub.company.positionToday', 'Position today · record currency')}</p>
      <KPIRow aria-label={t('dashboard:hub.company.keyFigures', 'Company figures')} className="grid-cols-2 min-[920px]:grid-cols-3">
      {figures.todayPending ? Array.from({ length: 6 }, (_, i) => <KPITile key={i} loading tone="blue" icon="grid" label="" value="" />) : todayError ? <div className="col-span-full"><ListState variant="error" title={t('dashboard:hub.company.figuresError', "Couldn't load company position figures")} onRetry={figures.todayRetry} /></div> : commonTodayFigures.map((figure) => <div key={figure.id} className="min-w-0"><KPITile icon={ICONS[figure.id] ?? 'grid'} tone={TONES[figure.id] ?? 'blue'} label={figure.label} value={figure.value ?? '—'} unavailableReason={figure.value == null ? figure.unavailableReason : undefined} help={help(figure.id)} to={figure.href} linkLabel={figure.href ? t('dashboard:hub.company.openFigure', 'Open related records for {{metric}}.', { metric: figure.label }) : undefined} loading={false} vs={figure.subline ? String(figure.subline) : undefined} />{figure.id === 'billed-margin' && canOpenAccountingMap && data && (data.on_hand_actual_coverage_total ?? 0) > (data.on_hand_actual_coverage_count ?? 0) && <Link className="-mt-2 mb-1 ml-4 inline-flex min-h-11 items-center text-xs font-medium text-primary-text underline-offset-4 hover:underline" to="/administration/accounting#budget-account-map">{t('dashboard:hub.company.reviewAccountingMappings', 'Review accounting mappings')}</Link>}</div>)}
      </KPIRow>
    </div>
    <HubGrid>{order.map(area)}</HubGrid>
    {finance && <section aria-label={t('dashboard:hub.company.financeReview', 'Finance review tables')} className="grid grid-cols-1 gap-4">
      <FinanceTableCard title={t('dashboard:hub.company.readyToPay', 'Ready to pay')} rows={(procurements.data ?? []).filter((row) => row.status === 'Vendor Invoiced')} columns={invoiceColumns} help={t('dashboard:hub.company.readyToPayHelp', 'Days since invoiced uses the recorded supplier invoice date; legacy rows use their last update. The procurement record has no supplier invoice due date, so due state is unknown.')}><div className="overflow-x-auto"><ReadyToPayTable rows={procurements.data ?? []} pending={procurements.isPending} error={procurements.isError} retry={() => void procurements.refetch()} /></div></FinanceTableCard>
      <FinanceTableCard title={t('dashboard:hub.company.budgetReview', 'Budget review')} rows={budgetRows} columns={budgetColumns} help={t('dashboard:hub.company.budgetReviewHelp', 'Percent used is recorded spending divided by the active budget when actuals are complete and currencies match. Variance is spending minus budget; positive means over budget.')}><div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"><p className="text-xs text-muted-foreground">{t('dashboard:hub.company.topBudgetsByVariance', 'Top 5 active budgets by variance')}</p><Link to="/projects" className="inline-flex min-h-11 items-center text-sm font-medium text-primary-text hover:underline">{t('dashboard:hub.company.viewAllBudgets', 'View all')}</Link></div><div className="overflow-x-auto"><BudgetReviewTable rows={budgetRows} pending={budgetReview.isPending} error={budgetReview.isError} retry={() => void budgetReview.refetch()} /></div></FinanceTableCard>
      <FinanceAccountingBlocks />
    </section>}
  </div>;
}
