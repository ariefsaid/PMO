import React from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardHead } from '@/src/components/ui/Card';
import { DataTable, type Column } from '@/src/components/ui/DataTable';
import { ListState } from '@/src/components/ui/ListState';
import { ProgressBar } from '@/src/components/ui/ProgressBar';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { statusLabel, statusTone, toneVariant } from '@/src/lib/status/statusMap';
import { ExportButton } from '@/src/components/export/ExportButton';
import { useActualsSnapshot, useApAgingSnapshot, useArAgingSnapshot } from '@/src/hooks/useErpSnapshots';
import { useCompanies } from '@/src/hooks/useCompanies';
import { useCompanyCollections } from '@/src/hooks/useCompanyCollections';
import { useProjects } from '@/src/hooks/useProjects';
import { useFinancePosition } from '@/src/hooks/useFinancePosition';
import { usePayablesPosition } from '@/src/lib/finance/payablesPosition';
import { AccountingSnapshotsSection } from '@/src/components/dashboard/AccountingSnapshotsSection';
import { AgeingStrip } from '@/src/components/finance/AgeingStrip';
import { formatTableMoney } from '@/src/lib/format';
import { budgetSpendKnown } from './financeData';
import { useFigureReport } from '@/src/components/ui/useFigureScope';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import type { BudgetReviewRow } from '@/src/lib/db/dashboard';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';

import { calendarAgeDays, supplierInvoiceDate } from '@/src/lib/finance/financePosition';

/** Supplier invoices ready to pay: procurement · project · supplier · unpaid · invoice age · status. Blank columns drop out by themselves. */
export function ReadyToPayCard({ rows, pending, error, retry, unpaidOf, today }: { rows: ProcurementWithRefs[]; pending: boolean; error: boolean; retry: () => void; unpaidOf: (row: ProcurementWithRefs) => number | null; today: string | null }) {
  const { t } = useTranslation('dashboard');
  // Invoice age is the Payables page's: days since the supplier's invoice date, on the organisation's day (unknown stays blank).
  const invoiceAgeDays = (row: ProcurementWithRefs) => calendarAgeDays(supplierInvoiceDate(row), today);
  const navigate = useNavigate();
  const ready = rows.filter((row) => row.status === 'Vendor Invoiced');
  const supplierInvoiced = t('dashboard:hub.company.supplierInvoiced', 'Supplier invoiced');
  // Said once above the table: how many unpaid amounts are not recorded (the cell stays blank, never 0).
  const unpaidUnknown = pending || error ? 0 : ready.filter((row) => unpaidOf(row) === null).length;
  useFigureReport([], [{ label: t('dashboard:hub.company.readyToPay', 'Ready to pay'), text: `${t('dashboard:hub.company.readyToPayHelp', 'Invoice age counts calendar days from the supplier invoice date. Invoices without a date have no age.')} ${t('dashboard:hub.company.readyToPayDueUnknown', 'The procurement record has no supplier invoice due date, so due state is unknown.')}` }]);
  const columns: Column<ProcurementWithRefs>[] = [
    { key: 'procurement', header: t('dashboard:hub.company.procurement', 'Procurement'), rowHeader: true, cell: (row) => <span className="font-medium">{row.title}</span>, exportValue: (row) => row.title },
    { key: 'project', header: t('dashboard:hub.company.project', 'Project'), cell: (row) => row.project?.name ?? null, exportValue: (row) => row.project?.name ?? '' },
    { key: 'supplier', header: t('dashboard:hub.company.supplier', 'Supplier'), cell: (row) => row.vendor?.name ?? null, exportValue: (row) => row.vendor?.name ?? '' },
    { key: 'amount', header: t('dashboard:hub.company.unpaid', 'Unpaid'), kind: 'money', align: 'num', cell: (row) => { const unpaid = unpaidOf(row); return unpaid === null ? null : formatTableMoney(unpaid, row.currency); }, exportValue: (row) => unpaidOf(row) ?? '' },
    { key: 'age', header: t('home.invoiceAge', 'Invoice age'), align: 'num', cell: (row) => { const days = invoiceAgeDays(row); return days === null ? null : t('home.days', { count: days, defaultValue_one: '{{count}} day', defaultValue_other: '{{count}} days' }); }, exportValue: (row) => invoiceAgeDays(row) ?? '' },
    { key: 'status', header: t('dashboard:hub.company.status', 'Status'), cell: () => <StatusPill wrap={false} variant="warn">{supplierInvoiced}</StatusPill>, exportValue: () => supplierInvoiced },
  ];
  return (
    <Card data-testid="ready-to-pay">
      <CardHead level={2} actions={<ExportButton rows={ready} columns={columns} entity={t('dashboard:hub.company.readyToPay', 'Ready to pay')} label={t('dashboard:hub.company.export', 'Export')} />}>{t('dashboard:hub.company.readyToPay', 'Ready to pay')}</CardHead>
      {unpaidUnknown > 0 && <p className="px-[var(--panel-inset)] pb-2 text-control text-muted-foreground">{t('dashboard:hub.company.unpaidUnknownNote', { count: unpaidUnknown, defaultValue_one: '{{count}} supplier invoice has no recorded amount yet', defaultValue_other: '{{count}} supplier invoices have no recorded amount yet' })}</p>}
      <div className="overflow-x-auto [--table-cell-inset:var(--panel-inset)]">
        <DataTable rows={ready} columns={columns} rowKey={(row) => row.id} onActivate={(row) => navigate(`/procurement/${row.id}`)} rowLabel={(row) => t('dashboard:hub.company.openProcurementNamed', 'Open {{name}}', { name: row.title })} state={pending ? 'loading' : error ? 'error' : ready.length === 0 ? 'empty' : undefined} onRetry={retry} emptyTitle={t('dashboard:hub.company.nothingReadyToPay', 'No supplier invoices are awaiting payment')} errorTitle={t('dashboard:hub.company.readyToPayError', "Couldn't load ready-to-pay records")} tableId="dashboard-company-ready-to-pay" embedded />
      </div>
    </Card>
  );
}

const usedPercent = (row: BudgetReviewRow) => budgetSpendKnown(row) && row.budget > 0 && row.budget_currency === row.currency ? Math.round(row.spent! / row.budget * 100) : null;

/** The active budgets, largest overrun first. Blank columns (spending nobody has recorded) drop out by themselves. */
export function BudgetReviewCard({ rows, pending, error, retry }: { rows: BudgetReviewRow[]; pending: boolean; error: boolean; retry: () => void }) {
  const { t } = useTranslation('dashboard');
  const { t: ts } = useTranslation('status');
  const navigate = useNavigate();
  const incomplete = rows.filter((row) => !budgetSpendKnown(row)).length;
  // #1739: a PMO-basis org's figure is the ordered..paid purchase totals (committed + spent); only a ledger org's is "Spent".
  const spentHeader = rows.some((row) => row.ledger_owned === false) ? t('dashboard:hub.company.committedSpent', 'Committed + spent') : t('dashboard:hub.company.spent', 'Spent');
  const columns: Column<BudgetReviewRow>[] = [
    { key: 'project', header: t('dashboard:hub.company.project', 'Project'), rowHeader: true, cell: (row) => <span className="font-medium">{projectDisplayName(row)}</span>, exportValue: (row) => projectDisplayName(row) },
    { key: 'review', header: t('home.colReview', 'Review'), cell: (row) => !budgetSpendKnown(row)
      ? <span className="text-muted-foreground">{t('home.reviewSpendUnknown', 'Spending not recorded')}</span>
      : row.variance !== null && row.variance > 0
        ? <span className="font-semibold text-destructive-text">{t('home.reviewOverBudget', 'Over budget')}</span>
        : <span className="text-muted-foreground">{t('home.reviewWithin', 'Within budget')}</span>,
      exportValue: (row) => !budgetSpendKnown(row) ? 'Spending not recorded' : row.variance !== null && row.variance > 0 ? 'Over budget' : 'Within budget' },
    { key: 'budget', header: t('dashboard:hub.company.budget', 'Budget'), kind: 'money', align: 'num', cell: (row) => formatTableMoney(row.budget, row.currency), exportValue: (row) => row.budget },
    { key: 'spent', header: spentHeader, kind: 'money', align: 'num', cell: (row) => budgetSpendKnown(row) ? formatTableMoney(row.spent!, row.currency) : null, exportValue: (row) => row.spent ?? '' },
    { key: 'used', header: t('dashboard:hub.company.percentUsed', '% used'), kind: 'percent', cell: (row) => { const pct = usedPercent(row); return pct === null ? null : <div className="flex min-w-24 items-center gap-2"><ProgressBar value={pct} widthless className="min-w-10 flex-1" aria-label={t('dashboard:hub.company.usedAria', '{{percent}}% of contract used', { percent: pct })} /><span>{pct}%</span></div>; }, exportValue: (row) => usedPercent(row) ?? '' },
    { key: 'variance', header: t('dashboard:hub.company.variance', 'Variance'), kind: 'money', align: 'num', cell: (row) => row.variance === null ? null : formatTableMoney(row.variance, row.currency), exportValue: (row) => row.variance ?? '' },
    { key: 'status', header: t('dashboard:hub.company.projectStatus', 'Project status'), cell: (row) => <StatusPill wrap={false} variant={toneVariant(statusTone('project', row.status) === 'exception' ? 'exception' : 'neutral')}>{statusLabel('project', row.status, ts)}</StatusPill>, exportValue: (row) => statusLabel('project', row.status, ts) },
  ];
  // No row has spending to review: the card is not drawn, and the page's one hidden line says so.
  const noFigures = !pending && !error && rows.length > 0 && !rows.some(budgetSpendKnown);
  useFigureReport(noFigures ? [{ label: t('dashboard:hub.company.budgetReview', 'Budget review'), reason: t('home.reasonBudgetSpend', 'project spending is not recorded') }] : [],
    [{ label: t('dashboard:hub.company.budgetReview', 'Budget review'), text: t('dashboard:hub.company.budgetReviewHelp', 'Percent used is recorded spending divided by the active budget when actuals are complete and currencies match. Variance is spending minus budget; positive means over budget.') }]);
  if (!pending && !error && (rows.length === 0 || noFigures)) return null;
  return (
    <Card data-testid="budget-review">
      <CardHead level={2} actions={<span className="flex items-center gap-x-4"><Link to="/projects" className="inline-flex items-center text-control font-medium text-primary-text hover:underline pointer-coarse:min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{t('dashboard:hub.company.viewAllBudgets', 'View all')}</Link><ExportButton rows={rows} columns={columns} entity={t('dashboard:hub.company.budgetReview', 'Budget review')} label={t('dashboard:hub.company.export', 'Export')} /></span>}>{t('dashboard:hub.company.budgetReview', 'Budget review')}</CardHead>
      {/* What the rows were chosen by, and how many of them lack recorded spending. */}
      {!pending && !error && <p className="px-[var(--panel-inset)] pb-2 text-control text-muted-foreground">{t('dashboard:hub.company.topBudgetsByVariance', 'Top 5 active budgets by variance')}{incomplete > 0 && ` · ${t('dashboard:hub.company.budgetSpendIncomplete', { count: incomplete, defaultValue_one: '{{count}} has incomplete spending', defaultValue_other: '{{count}} have incomplete spending' })}`}</p>}
      <div className="overflow-x-auto [--table-cell-inset:var(--panel-inset)]">
        <DataTable rows={rows} columns={columns} rowKey={(row) => row.id} onActivate={(row) => navigate(`/projects/${row.id}/budget`)} rowLabel={(row) => t('dashboard:hub.company.openBudgetFor', 'Open budget for {{name}}', { name: projectDisplayName(row) })} rowMenu={(row) => [
          { label: t('dashboard:hub.company.openProject', 'Open project'), onClick: () => navigate(`/projects/${row.id}`) },
          { label: t('dashboard:hub.company.openBudget', 'Open budget'), onClick: () => navigate(`/projects/${row.id}/budget`) },
        ]} state={pending ? 'loading' : error ? 'error' : undefined} onRetry={retry} errorTitle={t('dashboard:hub.company.budgetReviewError', "Couldn't load budget review")} tableId="dashboard-company-budget-review" embedded />
      </div>
    </Card>
  );
}

/** PMO-computed ageing (the finance hub's source), shown when the accounting system has no ageing synced (L12). */
function PmoAgeing({ kind, values, unknownCounts, noDueDateCounts, showSource = true }: { kind: 'receivables' | 'payables'; values: React.ComponentProps<typeof AgeingStrip>['values']; unknownCounts?: React.ComponentProps<typeof AgeingStrip>['unknownCounts']; noDueDateCounts?: React.ComponentProps<typeof AgeingStrip>['noDueDateCounts']; showSource?: boolean }) {
  const { t } = useTranslation('dashboard');
  return <div className="grid gap-1">
    <AgeingStrip kind={kind} values={values} unknownCounts={unknownCounts} noDueDateCounts={noDueDateCounts} />
    {/* Where the ageing comes from, said once (under the client ageing when both stand in). */}
    {showSource && <p className="text-control text-muted-foreground">{t('dashboard:hub.company.pmoAgeingSource', 'From invoices recorded in PMO; the accounting system has no ageing synced yet.')}</p>}
  </div>;
}

/** True once the accounting snapshot has loaded with no rows, so the PMO ageing may stand in for it. */
const snapshotEmpty = (query: { data?: unknown[]; isPending: boolean; isError: boolean }) => !query.isPending && !query.isError && (query.data ?? []).length === 0;

function ClientAgingBlock() {
  const arAging = useArAgingSnapshot();
  const finance = useFinancePosition(true, { withRoutes: true });
  const { data: clientCompanies } = useCompanies('Client');
  const clientCompanyIds = React.useMemo(() => (clientCompanies ?? []).map((company) => company.id), [clientCompanies]);
  const { customerLinks } = useCompanyCollections(clientCompanyIds);
  const pmo = finance.position.receivablesAgeing;
  if (snapshotEmpty(arAging) && finance.isPending) return <ListState variant="loading" shape="cards" rows={2} />;
  if (snapshotEmpty(arAging) && !finance.isError && Object.keys(pmo).length > 0) return <PmoAgeing kind="receivables" values={pmo} noDueDateCounts={finance.position.receivablesNoDueDateCounts} />;
  return <AccountingSnapshotsSection showActuals={false} showApAging={false} showArAging embedded actuals={[]} apAging={[]} arAging={arAging.data ?? []} arAgingPending={arAging.isPending} arAgingError={arAging.isError} onRetryArAging={() => void arAging.refetch()} customerLinks={customerLinks} />;
}

function PayablesAndActuals() {
  const actuals = useActualsSnapshot();
  const apAging = useApAgingSnapshot();
  const finance = useFinancePosition(true, { withRoutes: true });
  const projects = useProjects();
  const projectNames = React.useMemo(() => new Map((projects.data ?? []).map((project) => [project.id, projectDisplayName(project)])), [projects.data]);
  // L12(b): the same payables ageing as the finance hub — linked accounting documents read, unknown balances counted by age.
  const payables = usePayablesPosition(finance.position, true);
  const pmo = payables.payablesAgeing;
  const pmoStandsIn = snapshotEmpty(apAging) && !finance.isPending && !finance.isError && (Object.keys(pmo).length > 0 || Object.keys(payables.payablesUnknownAgeing).length > 0);
  const arAging = useArAgingSnapshot();
  const receivablesStandIn = snapshotEmpty(arAging) && !finance.isPending && !finance.isError && Object.keys(finance.position.receivablesAgeing).length > 0;
  return <>
    <AccountingSnapshotsSection showActuals actualsCollapsed showApAging={!pmoStandsIn} showArAging={false} actualProjectNames={projectNames} actuals={actuals.data ?? []} actualsPending={actuals.isPending} actualsError={actuals.isError} onRetryActuals={() => void actuals.refetch()} apAging={apAging.data ?? []} apAgingPending={apAging.isPending || (snapshotEmpty(apAging) && finance.isPending)} apAgingError={apAging.isError} onRetryApAging={() => void apAging.refetch()} arAging={[]} />
    {pmoStandsIn && <Card><div className="p-4"><PmoAgeing kind="payables" values={pmo} unknownCounts={payables.payablesUnknownAgeing} showSource={!receivablesStandIn} /></div></Card>}
  </>;
}

/** Ageing and accounting snapshots for the finance role: its analysis, kept behind the "Analysis" heading. */
export function FinanceAnalysis() {
  return <div className="grid gap-[var(--space-panel-gap)]"><ClientAgingBlock /><PayablesAndActuals /></div>;
}
