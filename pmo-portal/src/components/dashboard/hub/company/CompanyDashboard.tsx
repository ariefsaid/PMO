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
import { AgeingStrip } from '@/src/components/finance/AgeingStrip';
import { useFinancePosition } from '@/src/hooks/useFinancePosition';
import { usePayablesPosition } from '@/pages/finance/payablesPosition';
import { StatusBarChart } from '@/src/components/dashboard/StatusBarChart';
import { WinRateCard } from '@/src/components/dashboard/WinRateCard';
import { formatCurrency } from '@/src/lib/format';
import { supplierUnpaid } from '@/pages/procurement/blocks/procurementMoney';
import { stageForStatus, PROCUREMENT_STAGES, type ProcurementStage } from '@/pages/procurement/blocks/stage';
import { chartTheme } from '@/src/components/ui/chartTheme';
import { orderByCurrency } from '../../restructure/currencyOrder';
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

/**
 * L12(a): a supplier invoice's unpaid amount, read the way Payables and the procurement record read it — through the
 * accounting-system documents linked to the procurement (`usePayablesPosition`), falling back to the PMO-recorded
 * figure. `null` = unknown (never 0).
 */
function useSupplierUnpaid(enabled: boolean): (row: ProcurementWithRefs) => number | null {
  const finance = useFinancePosition(enabled);
  const payables = usePayablesPosition(finance.position, enabled);
  const byId = React.useMemo(() => new Map(payables.payables.map((p) => [p.procurement.id, p.amount])), [payables.payables]);
  return React.useCallback((row: ProcurementWithRefs) => {
    if (byId.has(row.id)) { const amount = byId.get(row.id); return amount == null ? null : amount / 100; }
    const unpaid = supplierUnpaid(row);
    return unpaid.unknown ? null : unpaid.amount;
  }, [byId]);
}

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
  const incomplete = rows.filter(({ percent }) => percent === null).length;
  const state = pending ? 'loading' : error ? 'error' : rows.length === 0 ? 'empty' : undefined;
  if (state) return <ListState variant={state} rows={3} title={state === 'empty' ? t('dashboard:hub.company.noProjects', 'No delivery projects to compare yet') : state === 'error' ? t('dashboard:hub.company.projectsError', "Couldn't load delivery projects") : undefined} onRetry={retry} />;
  return <div className="grid gap-2">
    <p className="text-xs text-muted-foreground">{t('dashboard:hub.company.topContractProjectsAttentionOrder', 'Largest 5 projects by contract, most attention first')}</p>
    {/* C4: a project whose spending is not known has no spending line; the reason is said once, here. */}
    {incomplete > 0 && <p className="text-xs text-muted-foreground">{t('dashboard:hub.company.spendIncomplete', { count: incomplete, defaultValue: '{{count}} projects have incomplete spending', defaultValue_one: '{{count}} project has incomplete spending' })}</p>}
    <ul className="divide-y divide-border" aria-label={t('dashboard:hub.company.spendingVsContract', 'Spending vs contract')}>
      {rows.map(({ row, percent }) => {
        const name = projectDisplayName(row);
        // C4: an unknown manager or contract is left out of the line rather than shown as "unavailable".
        const manager = owners.get(row.id) ?? null;
        const contract = row.contract_value == null ? null : money(row.contract_value, row.currency);
        const facts = [manager, contract].filter(Boolean).join(' · ');
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
              {facts && <p className="truncate text-xs text-muted-foreground">{facts}</p>}
            </div>
            <StatusPill variant={statusVariant(row.status)}>{statusLabel(row.status)}</StatusPill>
            <MenuButton ariaLabel={t('dashboard:hub.company.rowActionsFor', 'Row actions for {{name}}', { name })} items={menu} />
          </div>
          {percent != null && <Tooltip block content={t('dashboard:hub.company.spentOfContract', 'Spent {{spent}} of {{contract}} contract', { spent, contract })}><div className="flex w-full items-center gap-2"><ProgressBar value={percent} widthless className="min-w-0 flex-1 [&>span:first-child]:flex-1" aria-label={t('dashboard:hub.company.usedNamedAria', '{{name}}: {{percent}}% of contract used', { name, percent })} /><span className="w-10 text-right text-xs tabular">{percent}%</span></div></Tooltip>}
        </li>;
      })}
    </ul>
    {(projects?.length ?? 0) > 0 && <Link to="/projects" className="inline-flex min-h-11 items-center text-sm font-medium text-primary-text hover:underline">{t('dashboard:hub.company.viewAllProjects', 'View all {{count}} projects', { count: projects!.length })}</Link>}
  </div>;
}

interface StageRow { status: string; count: number; gross: string | null }

function PipelineStages({ stages, projects, pending, error, retry }: { stages: PipelineStage[]; projects: PipelineProject[]; pending: boolean; error: boolean; retry: () => void }) {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const statusLabel = useProjectStatusLabel();
  const orgCurrency = useOrgCurrency();
  const rows: StageRow[] = stages.map((stage) => {
    const totals = new Map<string, number>();
    projects.filter((project) => project.status === stage.status).forEach((project) => totals.set(project.currency, (totals.get(project.currency) ?? 0) + project.contract_value));
    const ordered = orderByCurrency([...totals].map(([currency, amount]) => ({ currency, amount })), orgCurrency);
    return { status: stage.status, count: stage.count, gross: ordered.map(({ currency, amount }) => formatCurrency(amount, currency)).join(' · ') || null };
  });
  const grossUnknown = t('dashboard:hub.company.stageGrossUnknown', 'The pipeline source did not provide comparable project values for this stage.');
  const columns: Column<StageRow>[] = [
    { key: 'stage', header: t('dashboard:hub.company.stage', 'Stage'), rowHeader: true, cell: (row) => <span className="font-medium">{statusLabel(row.status)}</span>, exportValue: (row) => statusLabel(row.status) },
    { key: 'count', header: t('dashboard:hub.company.count', 'Count'), kind: 'number', align: 'num', cell: (row) => row.count, exportValue: (row) => row.count },
    { key: 'gross', header: t('dashboard:hub.company.gross', 'Gross'), kind: 'money', align: 'num', cell: (row) => row.gross ?? <span title={grossUnknown}>—<span className="sr-only"> {grossUnknown}</span></span>, exportValue: (row) => row.gross ?? '' },
  ];
  const openStage = (row: StageRow) => navigate(`/sales?status=${encodeURIComponent(row.status)}`);
  // L2: on a phone each stage is ONE line ("Leads · 1 · $1.8M"), not a stacked Count / Gross pair.
  const stageLine = (row: StageRow) => <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm">
    <span className="font-medium">{statusLabel(row.status)}</span>
    <span className="font-normal text-muted-foreground" aria-hidden="true">·</span>
    <span className="font-normal tabular">{row.count}</span>
    {row.gross && <><span className="font-normal text-muted-foreground" aria-hidden="true">·</span><span className="font-normal tabular">{row.gross}</span></>}
  </span>;
  return <DataTable rows={rows} columns={columns} rowKey={(row) => row.status} onActivate={openStage} rowLabel={(row) => t('dashboard:hub.company.openStage', 'Open {{stage}} opportunities', { stage: statusLabel(row.status) })} accessibleName={t('dashboard:hub.company.pipelineByStage', 'Pipeline by stage')} mobileCardTitle={stageLine} mobileCardDetails={() => null} state={pending ? 'loading' : error ? 'error' : rows.length === 0 ? 'empty' : undefined} onRetry={retry} emptyTitle={t('dashboard:hub.company.noPipeline', 'No open pipeline stages')} errorTitle={t('dashboard:hub.company.pipelineError', "Couldn't load pipeline stages")} tableId="dashboard-company-pipeline-stages" embedded />;
}

function ReadyToPayTable({ rows, pending, error, retry, unpaidOf }: { rows: ProcurementWithRefs[]; pending: boolean; error: boolean; retry: () => void; unpaidOf: (row: ProcurementWithRefs) => number | null }) {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const statusLabel = useProcurementStatusLabel();
  const displayStatus = (status: string) => status === 'Vendor Invoiced' ? t('dashboard:hub.company.supplierInvoiced', 'Supplier invoiced') : status === 'Vendor Quoted' ? t('dashboard:hub.company.supplierQuoted', 'Supplier quoted') : statusLabel(status);
  const ready = rows.filter((row) => row.status === 'Vendor Invoiced');
  const columns: Column<ProcurementWithRefs>[] = [
    { key: 'procurement', header: t('dashboard:hub.company.procurement', 'Procurement'), rowHeader: true, cell: (row) => <span className="font-medium">{row.title}</span>, exportValue: (row) => row.title },
    { key: 'project', header: t('dashboard:hub.company.project', 'Project'), cell: (row) => row.project?.name ?? <span className="sr-only">{t('dashboard:hub.company.projectUnknown', 'Project is not linked to this procurement.')}</span>, exportValue: (row) => row.project?.name ?? '' },
    { key: 'supplier', header: t('dashboard:hub.company.supplier', 'Supplier'), cell: (row) => row.vendor?.name ?? <span className="sr-only">{t('dashboard:hub.company.supplierUnknown', 'Supplier is not recorded on this procurement.')}</span>, exportValue: (row) => row.vendor?.name ?? '' },
    // L12(a): the unpaid balance is the procurement record's own (supplier invoices less payments), never the order value.
    { key: 'amount', header: t('dashboard:hub.company.unpaid', 'Unpaid'), kind: 'money', align: 'num', cell: (row) => { const unpaid = unpaidOf(row); return unpaid === null ? <span className="sr-only">{t('dashboard:hub.company.unpaidUnknown', 'No supplier invoice amount recorded')}</span> : formatCurrency(unpaid, row.currency); }, exportValue: (row) => unpaidOf(row) ?? '' },
    { key: 'age', header: t('dashboard:hub.company.daysSinceInvoice', 'Days since invoiced'), align: 'num', cell: (row) => { const stamp = row.vendor_invoiced_at ?? row.updated_at; const days = Math.max(0, Math.floor((Date.now() - new Date(stamp).getTime()) / 86400000)); return <span title={t('dashboard:hub.company.invoiceAgeHelp', 'Uses the recorded supplier invoice date; legacy rows use their last update.')}>{days}</span>; }, exportValue: (row) => Math.max(0, Math.floor((Date.now() - new Date(row.vendor_invoiced_at ?? row.updated_at).getTime()) / 86400000)) },
    { key: 'status', header: t('dashboard:hub.company.status', 'Status'), cell: (row) => <StatusPill variant="warn">{displayStatus(row.status)}</StatusPill>, exportValue: (row) => displayStatus(row.status) },
  ];
  return <DataTable rows={ready} columns={columns} rowKey={(row) => row.id} onActivate={(row) => navigate(`/procurement/${row.id}`)} rowLabel={(row) => t('dashboard:hub.company.openProcurementNamed', 'Open {{name}}', { name: row.title })} rowMenu={(row) => [{ label: t('dashboard:hub.company.openProcurement', 'Open procurement'), onClick: () => navigate(`/procurement/${row.id}`) }]} state={pending ? 'loading' : error ? 'error' : ready.length === 0 ? 'empty' : undefined} onRetry={retry} emptyTitle={t('dashboard:hub.company.nothingReadyToPay', 'No supplier invoices are awaiting payment')} errorTitle={t('dashboard:hub.company.readyToPayError', "Couldn't load ready-to-pay records")} tableId="dashboard-company-ready-to-pay" embedded />;
}

/** Spending is shown only when it is complete and in the budget's currency (C4: otherwise the cell is left out). */
const budgetSpendKnown = (row: BudgetReviewRow) => row.spent !== null && row.actual_complete && row.actual_currency === row.currency;

function BudgetReviewTable({ rows, pending, error, retry }: { rows: BudgetReviewRow[]; pending: boolean; error: boolean; retry: () => void }) {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const statusLabel = useProjectStatusLabel();
  const columns: Column<BudgetReviewRow>[] = [
    { key: 'project', header: t('dashboard:hub.company.project', 'Project'), rowHeader: true, cell: (row) => <span className="font-medium">{projectDisplayName(row)}</span>, exportValue: (row) => projectDisplayName(row) },
    { key: 'budget', header: t('dashboard:hub.company.budget', 'Budget'), kind: 'money', align: 'num', cell: (row) => formatCurrency(row.budget, row.currency), exportValue: (row) => row.budget },
    { key: 'spent', header: t('dashboard:hub.company.spent', 'Spent'), kind: 'money', align: 'num', cell: (row) => budgetSpendKnown(row) ? formatCurrency(row.spent!, row.currency) : <span className="sr-only">{t('dashboard:hub.company.spentUnknown', 'Recorded spending is incomplete or uses a different currency.')}</span>, exportValue: (row) => row.spent ?? '' },
    { key: 'used', header: t('dashboard:hub.company.percentUsed', '% used'), kind: 'percent', cell: (row) => { const pct = row.actual_complete && row.spent !== null && row.budget > 0 && row.actual_currency === row.currency && row.budget_currency === row.currency ? Math.round(row.spent / row.budget * 100) : null; return pct === null ? <span className="sr-only">{t('dashboard:hub.company.budgetUsedUnknown', 'Budget or recorded spending cannot be compared.')}</span> : <div className="flex min-w-24 items-center gap-2"><ProgressBar value={pct} widthless className="min-w-10 flex-1" aria-label={t('dashboard:hub.company.usedAria', '{{percent}}% of contract used', { percent: pct })} /><span>{pct}%</span></div>; }, exportValue: (row) => row.spent !== null && row.budget > 0 ? row.spent / row.budget : '' },
    { key: 'variance', header: t('dashboard:hub.company.variance', 'Variance'), kind: 'money', align: 'num', cell: (row) => row.variance === null ? <span className="sr-only">{t('dashboard:hub.company.varianceUnknown', 'Recorded spending or budget currency is incomplete.')}</span> : formatCurrency(row.variance, row.currency), exportValue: (row) => row.variance ?? '' },
    { key: 'status', header: t('dashboard:hub.company.projectStatus', 'Project status'), cell: (row) => <StatusPill variant={statusVariant(row.status)}>{statusLabel(row.status)}</StatusPill>, exportValue: (row) => statusLabel(row.status) },
    { key: 'review', header: t('dashboard:hub.company.review', 'Review'), cell: (row) => <Link to={`/projects/${row.id}/budget`} className="inline-flex min-h-11 items-center text-primary-text hover:underline">{t('dashboard:hub.company.reviewBudget', 'Review budget')}</Link>, exportValue: () => '' },
  ];
  return <DataTable rows={rows} columns={columns} rowKey={(row) => row.id} onActivate={(row) => navigate(`/projects/${row.id}/budget`)} rowLabel={(row) => t('dashboard:hub.company.openBudgetFor', 'Open budget for {{name}}', { name: projectDisplayName(row) })} rowMenu={(row) => [
    { label: t('dashboard:hub.company.openProject', 'Open project'), onClick: () => navigate(`/projects/${row.id}`) },
    { label: t('dashboard:hub.company.openBudget', 'Open budget'), onClick: () => navigate(`/projects/${row.id}/budget`) },
  ]} state={pending ? 'loading' : error ? 'error' : rows.length === 0 ? 'empty' : undefined} onRetry={retry} emptyTitle={t('dashboard:hub.company.noBudgetReviews', 'No project budgets to review')} errorTitle={t('dashboard:hub.company.budgetReviewError', "Couldn't load budget review")} tableId="dashboard-company-budget-review" embedded />;
}

function FinanceTableCard<Row>({ title, rows, columns, help, children }: { title: string; rows: Row[]; columns: Column<Row>[]; help: string; children: React.ReactNode }) {
  const { t } = useTranslation('dashboard');
  return <Card><CardHead actions={<div className="flex items-center gap-2"><Tooltip content={help}><button type="button" aria-label={t('dashboard:hub.company.aboutMetric', 'About {{metric}}', { metric: title })} className="touch-target grid size-11 place-items-center rounded-full text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><Icon name="help" /></button></Tooltip><ExportButton rows={rows} columns={columns} entity={title} label={t('dashboard:hub.company.export', 'Export')} /></div>}>{title}</CardHead>{children}</Card>;
}

/** PMO-computed ageing (the finance hub's source), shown when the accounting system has no ageing synced (L12). */
function PmoAgeing({ kind, values, unknownCounts, showSource = true }: { kind: 'receivables' | 'payables'; values: React.ComponentProps<typeof AgeingStrip>['values']; unknownCounts?: React.ComponentProps<typeof AgeingStrip>['unknownCounts']; showSource?: boolean }) {
  const { t } = useTranslation('dashboard');
  return <div className="grid gap-1">
    <AgeingStrip kind={kind} values={values} unknownCounts={unknownCounts} />
    {showSource && <p className="-mt-3 text-xs text-muted-foreground">{t('dashboard:hub.company.pmoAgeingSource', 'From invoices recorded in PMO; the accounting system has no ageing synced yet.')}</p>}
  </div>;
}

/** True once the accounting snapshot has loaded with no rows, so the PMO ageing may stand in for it. */
const snapshotEmpty = (query: { data?: unknown[]; isPending: boolean; isError: boolean }) => !query.isPending && !query.isError && (query.data ?? []).length === 0;

function ClientAgingBlock() {
  const arAging = useArAgingSnapshot();
  const finance = useFinancePosition();
  const pmo = finance.position.receivablesAgeing;
  if (snapshotEmpty(arAging) && finance.isPending) return <ListState variant="loading" rows={2} />;
  if (snapshotEmpty(arAging) && !finance.isError && Object.keys(pmo).length > 0) return <PmoAgeing kind="receivables" values={pmo} />;
  return <AccountingSnapshotsSection showActuals={false} showApAging={false} showArAging embedded actuals={[]} apAging={[]} arAging={arAging.data ?? []} arAgingPending={arAging.isPending} arAgingError={arAging.isError} onRetryArAging={() => void arAging.refetch()} />;
}

function FinanceAccountingBlocks() {
  const actuals = useActualsSnapshot();
  const apAging = useApAgingSnapshot();
  const arAging = useArAgingSnapshot();
  const finance = useFinancePosition();
  const projects = useProjects();
  const projectNames = React.useMemo(() => new Map((projects.data ?? []).map((project) => [project.id, projectDisplayName(project)])), [projects.data]);
  // L12(b): the same payables ageing as the finance hub — linked accounting documents read, unknown balances counted by age.
  const payables = usePayablesPosition(finance.position, true);
  const pmo = payables.payablesAgeing;
  const pmoStandsIn = snapshotEmpty(apAging) && !finance.isPending && !finance.isError && (Object.keys(pmo).length > 0 || Object.keys(payables.payablesUnknownAgeing).length > 0);
  const receivablesStandIn = snapshotEmpty(arAging) && !finance.isPending && !finance.isError && Object.keys(finance.position.receivablesAgeing).length > 0;
  return <>
    <AccountingSnapshotsSection showActuals actualsCollapsed showApAging={!pmoStandsIn} showArAging={false} actualProjectNames={projectNames} actuals={actuals.data ?? []} actualsPending={actuals.isPending} actualsError={actuals.isError} onRetryActuals={() => void actuals.refetch()} apAging={apAging.data ?? []} apAgingPending={apAging.isPending || (snapshotEmpty(apAging) && finance.isPending)} apAgingError={apAging.isError} onRetryApAging={() => void apAging.refetch()} arAging={[]} />
    {/* L6: the "from PMO invoices" note is said once — under the client ageing when that stands in too. */}
    {pmoStandsIn && <Card><div className="p-4"><PmoAgeing kind="payables" values={pmo} unknownCounts={payables.payablesUnknownAgeing} showSource={!receivablesStandIn} /></div></Card>}
  </>;
}

export function CompanyDashboard({ role }: { role: Extract<Role, 'Executive' | 'Admin' | 'Finance'> }) {
  const { t } = useTranslation('dashboard');
  const { realRole } = useEffectiveRole();
  const canOpenAccountingMap = can('edit', 'budgetLine', { realRole });
  const periodState = usePeriod();
  const figures = useCompanyFigures(periodState.period);
  const needs = useNeedsYou(role);
  const projects = useProjects();
  // Shared-details select: the supplier invoice and payment rows behind each unpaid balance (same cache as the figures).
  const procurements = useProcurements({ withSharedDetails: true });
  const pipeline = useSalesPipeline();
  const budgetReview = useFinanceBudgetReview();
  const orgCurrency = useOrgCurrency();
  const projectStatusLabel = useProjectStatusLabel();
  const procurementLabel = useProcurementStatusLabel();
  const displayProcurementStatus = (status: string) => status === 'Vendor Invoiced' ? t('dashboard:hub.company.supplierInvoiced', 'Supplier invoiced') : status === 'Vendor Quoted' ? t('dashboard:hub.company.supplierQuoted', 'Supplier quoted') : procurementLabel(status);
  const data = figures.dashboard;
  const finance = role === 'Finance';
  // Ready to pay is a Finance table; only Finance reads the linked accounting documents behind it.
  const unpaidOf = useSupplierUnpaid(finance);
  const periodFigure = (id: string) => figures.period.find((figure) => figure.id === id);
  const todayFigure = (id: string) => figures.today.find((figure) => figure.id === id);
  // L6: overdue invoices, supplier invoices and work still to invoice are owned by their tiles above
  // (count, amount and link); the panels list only attention items no tile carries.
  const deliveryNeeds = needsAttention(needs.areaItems, ['at-risk', 'risk-unchecked', 'budgets-over'], t);
  const purchasingNeeds = needsAttention(needs.areaItems, ['procurement-approvals'], t);
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
  // L12(g): purchasing is grouped by the four stages every procurement screen uses — Request · Order · Receive · Pay.
  const stageCounts = PROCUREMENT_STAGES.map((stage) => ({
    status: stage,
    count: (data?.procurements_by_status ?? []).filter((row) => stageForStatus(row.status) === stage).reduce((sum, row) => sum + row.count, 0),
  }));
  const stageName = (stage: ProcurementStage) => ({
    Request: t('dashboard:hub.company.stageRequest', 'Request'),
    Order: t('dashboard:hub.company.stageOrder', 'Order'),
    Receive: t('dashboard:hub.company.stageReceive', 'Receive'),
    Pay: t('dashboard:hub.company.stagePay', 'Pay'),
  })[stage];
  const pipelineStages = pipeline.data?.stages ?? [];
  const commonTodayFigures = ['contract-on-hand', 'billed-margin', 'pipeline', 'client-overdue', 'supplier-payables', 'still-to-invoice'].map((id) => todayFigure(id)).filter((figure): figure is DashboardFigure => Boolean(figure));
  const periodMini = (id: string) => periodFigure(id) ?? { id, label: id, value: null };
  const hasEvidence = Boolean(data && ((data.projects_by_status ?? []).some((row) => row.count > 0) || (data.procurements_by_status ?? []).some((row) => row.count > 0)))
    || Boolean(procurements.data?.length || figures.pipeline?.projects?.length);

  const area = (id: string) => {
    switch (id) {
      case 'delivery': return <AreaPanel key={id} title={t('dashboard:hub.company.delivery', 'Delivery')} openHref="/projects" openLabel={t('dashboard:hub.company.openProjects', 'Open projects')}>
        <AttentionList compact items={deliveryNeeds} />
        <section className="grid gap-2">
          <div className="flex items-center gap-2"><h3 className="text-sm font-semibold">{t('dashboard:hub.company.spendingVsContract', 'Spending vs contract')}</h3><Tooltip content={t('dashboard:hub.company.projectSpendHelp', 'Used is recorded spending divided by contract value. It is shown only when actuals are complete and currencies match.')}><button type="button" aria-label={t('dashboard:hub.company.aboutProjectSpend', 'About spending versus contract')} className="touch-target grid size-7 place-items-center rounded-full text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><Icon name="help" className="size-3.5" /></button></Tooltip></div>
          <ProjectSpendTable dashboard={data} projects={projects.data} pending={figures.dashboardPending || projects.isPending} error={figures.dashboardError || projects.isError} retry={() => { figures.dashboardRetry(); void projects.refetch(); }} />
        </section>
      </AreaPanel>;
      case 'sales': return <AreaPanel key={id} title={t('dashboard:hub.company.sales', 'Sales')} openHref="/sales" openLabel={t('dashboard:hub.company.openSales', 'Open sales')}>
        <FigureGroup heading={t('dashboard:hub.company.salesFigures', 'Sales results')} figures={[{ ...periodMini('won'), help: help('won') }]} isPending={figures.periodPending} isError={figures.periodError} onRetry={figures.periodRetry} hideHeading />
        <section className="grid gap-2">
          <div className="flex items-center gap-2"><h3 className="text-sm font-semibold">{t('dashboard:hub.company.pipelineByStage', 'Pipeline by stage')}</h3><Tooltip content={t('dashboard:hub.company.help.pipelineStages', 'Stage counts and gross values come from the sales pipeline. Gross is grouped by project currency. The source does not return forecast margin by stage.')}><button type="button" aria-label={t('dashboard:hub.company.aboutPipelineStages', 'About pipeline by stage')} className="touch-target grid size-7 place-items-center rounded-full text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><Icon name="help" className="size-3.5" /></button></Tooltip></div>
          <PipelineStages stages={pipelineStages} projects={pipeline.data?.projects ?? []} pending={pipeline.isPending} error={pipeline.isError} retry={() => { void pipeline.refetch(); }} />
        </section>
        <WinRateCard currency={orgCurrency} range={figures.winRateRange} hidePeriodControl embedded />
      </AreaPanel>;
      case 'billing': return <AreaPanel key={id} title={t('dashboard:hub.company.billing', 'Billing and collections')} openHref="/sales-invoices" openLabel={t('dashboard:hub.company.openInvoices', 'Open invoices')}>
        <FigureGroup heading={t('dashboard:hub.company.billingFigures', 'Billing results')} figures={[{ ...periodMini('invoiced'), help: help('invoiced') }, { ...periodMini('collected'), help: help('collected') }]} isPending={figures.periodPending} isError={figures.periodError} onRetry={figures.periodRetry} hideHeading />
        {finance && <ClientAgingBlock />}
      </AreaPanel>;
      default: return <AreaPanel key={id} title={t('dashboard:hub.company.purchasing', 'Purchasing')} openHref="/procurement" openLabel={t('dashboard:hub.company.openProcurements', 'Open procurements')}>
        <AttentionList compact items={purchasingNeeds} />
        <section className="grid gap-2">
          <div className="flex items-center gap-2"><h3 className="text-sm font-semibold">{t('dashboard:hub.company.purchasingByStage', 'Purchasing by stage')}</h3><Tooltip content={t('dashboard:hub.company.help.purchasesScope', 'Purchases made directly in the accounting system are not counted in this PMO procurement view.')}><button type="button" aria-label={t('dashboard:hub.company.purchasesScopeLabel', 'About purchasing by stage')} className="touch-target grid size-7 place-items-center rounded-full text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><Icon name="help" className="size-3.5" /></button></Tooltip></div>
          <p className="text-xs text-muted-foreground">{t('dashboard:hub.company.accountingPurchasesExcluded', 'Purchases made directly in the accounting system are not counted.')}</p>
          {figures.dashboardError ? <ListState variant="error" title={t('dashboard:hub.company.purchasesError', "Couldn't load purchasing stages")} onRetry={figures.dashboardRetry} /> : figures.dashboardPending ? <ListState variant="loading" rows={3} /> : stageCounts.every((row) => row.count === 0) ? <ListState variant="empty" icon="cart" title={t('dashboard:hub.company.noPurchases', 'No procurements to show')} /> : <StatusBarChart data={stageCounts} toneFor={() => chartTheme.series.neutral} label={t('dashboard:hub.company.purchasingByStage', 'Purchasing by stage')} noun={t('dashboard:hub.company.procurementPlural', 'procurements')} hrefFor={(stage) => `/procurement?stage=${stage.toLowerCase()}`} labelFor={stageName} compactSegments />}
        </section>
      </AreaPanel>;
    }
  };

  const invoiceColumns: Column<ProcurementWithRefs>[] = [
    { key: 'title', header: t('dashboard:hub.company.procurement', 'Procurement'), cell: (row) => row.title, exportValue: (row) => row.title },
    { key: 'project', header: t('dashboard:hub.company.project', 'Project'), cell: (row) => row.project?.name ?? '—', exportValue: (row) => row.project?.name ?? '' },
    { key: 'supplier', header: t('dashboard:hub.company.supplier', 'Supplier'), cell: (row) => row.vendor?.name ?? '—', exportValue: (row) => row.vendor?.name ?? '' },
    { key: 'amount', header: t('dashboard:hub.company.unpaid', 'Unpaid'), cell: (row) => { const unpaid = unpaidOf(row); return unpaid === null ? '' : formatCurrency(unpaid, row.currency); }, exportValue: (row) => unpaidOf(row) ?? '' },
    { key: 'age', header: t('dashboard:hub.company.daysSinceInvoice', 'Days since invoiced'), cell: (row) => Math.max(0, Math.floor((Date.now() - new Date(row.vendor_invoiced_at ?? row.updated_at).getTime()) / 86400000)), exportValue: (row) => Math.max(0, Math.floor((Date.now() - new Date(row.vendor_invoiced_at ?? row.updated_at).getTime()) / 86400000)) },
    { key: 'status', header: t('dashboard:hub.company.status', 'Status'), cell: (row) => displayProcurementStatus(row.status), exportValue: (row) => displayProcurementStatus(row.status) },
  ];
  const activeStatuses = new Set<string>(ACTIVE_PROJECT_STATUSES);
  const budgetRows = (budgetReview.data ?? []).filter((row) => activeStatuses.has(row.status)).slice(0, 5);
  const budgetIncomplete = budgetRows.filter((row) => !budgetSpendKnown(row)).length;
  const readyToPayRows = (procurements.data ?? []).filter((row) => row.status === 'Vendor Invoiced');
  const unpaidUnknown = readyToPayRows.filter((row) => unpaidOf(row) === null).length;
  const budgetColumns: Column<BudgetReviewRow>[] = [
    { key: 'project', header: t('dashboard:hub.company.project', 'Project'), cell: (row) => projectDisplayName(row), exportValue: (row) => projectDisplayName(row) },
    { key: 'budget', header: t('dashboard:hub.company.budget', 'Budget'), cell: (row) => formatCurrency(row.budget, row.currency), exportValue: (row) => row.budget },
    { key: 'spent', header: t('dashboard:hub.company.spent', 'Spent'), cell: (row) => budgetSpendKnown(row) ? formatCurrency(row.spent!, row.currency) : '', exportValue: (row) => budgetSpendKnown(row) ? row.spent! : '' },
    { key: 'used', header: t('dashboard:hub.company.percentUsed', '% used'), kind: 'percent', cell: (row) => row.actual_complete && row.spent !== null && row.budget > 0 && row.actual_currency === row.currency && row.budget_currency === row.currency ? row.spent / row.budget : '', exportValue: (row) => row.actual_complete && row.spent !== null && row.budget > 0 && row.actual_currency === row.currency && row.budget_currency === row.currency ? row.spent / row.budget : '' },
    { key: 'variance', header: t('dashboard:hub.company.variance', 'Variance'), cell: (row) => row.variance == null ? '' : formatCurrency(row.variance, row.currency), exportValue: (row) => row.variance ?? '' },
    { key: 'status', header: t('dashboard:hub.company.projectStatus', 'Project status'), cell: (row) => projectStatusLabel(row.status), exportValue: (row) => projectStatusLabel(row.status) },
    { key: 'review', header: t('dashboard:hub.company.review', 'Review'), cell: () => t('dashboard:hub.company.reviewBudget', 'Review budget'), exportValue: (row) => `/projects/${row.id}/budget` },
  ];
  if (!figures.todayPending && !figures.periodPending && !figures.pipelinePending && !procurements.isPending && !needs.isPending
    && !figures.dashboardError && !figures.periodError && !figures.pipelineError && !needs.isError && figures.isEmpty && !hasEvidence) {
    return <div className="space-y-4"><h1 className="text-2xl font-bold">{t('dashboard:hub.company.title', 'Dashboard')}</h1><ListState variant="empty" icon="grid" title={t('dashboard:hub.company.emptyTitle', 'No company activity yet')} sub={t('dashboard:hub.company.emptySub', 'Projects, sales, billing, and purchasing will appear here as records are added.')} /></div>;
  }

  return <div className="space-y-4" data-company-role={role}>
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h1 className="text-[24px] font-bold leading-tight tracking-[-0.02em]">{t('dashboard:hub.company.title', 'Dashboard')}</h1><p className="mt-0.5 max-w-[68ch] text-[13.5px] text-muted-foreground">{t('dashboard:hub.company.basis', 'Position today in each record currency; sales and billing results cover {{period}}.', { period: periodState.period.label })}</p></div>
      <div className="flex flex-wrap items-end gap-2"><PeriodPicker period={periodState.period} selectPeriod={periodState.selectPeriod} setCustomMonth={periodState.setCustomMonth} /><Button variant="outline" className="min-h-11 min-w-11 min-[1180px]:h-8" onClick={refresh} aria-label={t('dashboard:hub.company.refresh', 'Refresh dashboard')}><Icon name="refresh" /><span className="hidden sm:inline">{t('dashboard:hub.company.refresh', 'Refresh')}</span></Button></div>
    </header>
    {needs.isPending ? <ListState variant="loading" rows={1} /> : needs.isError ? <ListState variant="error" title={t('dashboard:hub.company.approvalsError', "Couldn't load approvals and attention items")} onRetry={needs.refetch} /> : <section aria-label={t('dashboard:hub.company.approvals', 'Approvals waiting for you')}><ApprovalStrip items={needs.items.filter((item) => item.id === 'approvals').map((item) => ({ id: item.id, tone: item.tone, icon: 'check', count: item.count, label: item.label, href: item.href }))} /></section>}
    <KPIRow aria-label={t('dashboard:hub.company.keyFigures', 'Company figures')} className="grid-cols-2 min-[920px]:grid-cols-3">
      {figures.todayPending ? Array.from({ length: 6 }, (_, i) => <KPITile key={i} loading tone="blue" icon="grid" label="" value="" />) : todayError ? <div className="col-span-full"><ListState variant="error" title={t('dashboard:hub.company.figuresError', "Couldn't load company position figures")} onRetry={figures.todayRetry} /></div> : commonTodayFigures.map((figure) => <div key={figure.id} className="min-w-0"><KPITile icon={ICONS[figure.id] ?? 'grid'} tone={TONES[figure.id] ?? 'blue'} label={figure.label} value={figure.value ?? '—'} exactValue={figure.exactValue} unavailableReason={figure.value == null ? figure.unavailableReason : undefined} help={help(figure.id)} to={figure.href} linkLabel={figure.href ? t('dashboard:hub.company.openFigure', 'Open related records for {{metric}}.', { metric: figure.label }) : undefined} loading={false} vs={figure.subline && figure.id !== 'billed-margin' ? String(figure.subline) : undefined} />{figure.id === 'billed-margin' && canOpenAccountingMap && data && (data.on_hand_actual_coverage_total ?? 0) > (data.on_hand_actual_coverage_count ?? 0) && <Link className="-mt-2 mb-1 ml-4 inline-flex min-h-11 items-center text-xs font-medium text-primary-text underline-offset-4 hover:underline" to="/administration/accounting#budget-account-map">{t('dashboard:hub.company.reviewAccountingMappings', 'Review accounting mappings')}</Link>}</div>)}
      </KPIRow>
    <HubGrid>{order.map(area)}</HubGrid>
    {finance && <section aria-label={t('dashboard:hub.company.financeReview', 'Finance review tables')} className="grid grid-cols-1 gap-4">
      <FinanceTableCard title={t('dashboard:hub.company.readyToPay', 'Ready to pay')} rows={readyToPayRows} columns={invoiceColumns} help={t('dashboard:hub.company.readyToPayHelp', 'Days since invoiced uses the recorded supplier invoice date; legacy rows use their last update. The procurement record has no supplier invoice due date, so due state is unknown.')}>{unpaidUnknown > 0 && <p className="px-4 pt-2 text-xs text-muted-foreground">{t('dashboard:hub.company.unpaidUnknownNote', { count: unpaidUnknown, defaultValue: '{{count}} supplier invoices have no recorded amount yet', defaultValue_one: '{{count}} supplier invoice has no recorded amount yet' })}</p>}<div className="overflow-x-auto"><ReadyToPayTable rows={procurements.data ?? []} pending={procurements.isPending} error={procurements.isError} retry={() => void procurements.refetch()} unpaidOf={unpaidOf} /></div></FinanceTableCard>
      <FinanceTableCard title={t('dashboard:hub.company.budgetReview', 'Budget review')} rows={budgetRows} columns={budgetColumns} help={t('dashboard:hub.company.budgetReviewHelp', 'Percent used is recorded spending divided by the active budget when actuals are complete and currencies match. Variance is spending minus budget; positive means over budget.')}><div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"><p className="text-xs text-muted-foreground">{t('dashboard:hub.company.topBudgetsByVariance', 'Top 5 active budgets by variance')}{budgetIncomplete > 0 && ` · ${t('dashboard:hub.company.budgetSpendIncomplete', { count: budgetIncomplete, defaultValue: '{{count}} have incomplete spending', defaultValue_one: '{{count}} has incomplete spending' })}`}</p><Link to="/projects" className="inline-flex min-h-11 items-center text-sm font-medium text-primary-text hover:underline">{t('dashboard:hub.company.viewAllBudgets', 'View all')}</Link></div><div className="overflow-x-auto"><BudgetReviewTable rows={budgetRows} pending={budgetReview.isPending} error={budgetReview.isError} retry={() => void budgetReview.refetch()} /></div></FinanceTableCard>
      <FinanceAccountingBlocks />
    </section>}
  </div>;
}
