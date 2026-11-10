import React from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardHead } from '@/src/components/ui/Card';
import { DataTable, type Column } from '@/src/components/ui/DataTable';
import { ListState } from '@/src/components/ui/ListState';
import { ProgressBar } from '@/src/components/ui/ProgressBar';
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
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import type { BudgetReviewRow } from '@/src/lib/db/dashboard';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';

const invoiceAgeDays = (row: ProcurementWithRefs) => Math.max(0, Math.floor((Date.now() - new Date(row.vendor_invoiced_at ?? row.updated_at).getTime()) / 86400000));

/** Supplier invoices ready to pay: supplier · procurement · unpaid · invoice age. Blank columns drop out by themselves. */
export function ReadyToPayCard({ rows, pending, error, retry, unpaidOf }: { rows: ProcurementWithRefs[]; pending: boolean; error: boolean; retry: () => void; unpaidOf: (row: ProcurementWithRefs) => number | null }) {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const ready = rows.filter((row) => row.status === 'Vendor Invoiced');
  const columns: Column<ProcurementWithRefs>[] = [
    { key: 'procurement', header: t('dashboard:hub.company.procurement', 'Procurement'), rowHeader: true, cell: (row) => <span className="font-medium">{row.title}</span>, exportValue: (row) => row.title },
    { key: 'supplier', header: t('dashboard:hub.company.supplier', 'Supplier'), cell: (row) => row.vendor?.name ?? null, exportValue: (row) => row.vendor?.name ?? '' },
    { key: 'amount', header: t('dashboard:hub.company.unpaid', 'Unpaid'), kind: 'money', align: 'num', cell: (row) => { const unpaid = unpaidOf(row); return unpaid === null ? null : formatTableMoney(unpaid, row.currency); }, exportValue: (row) => unpaidOf(row) ?? '' },
    { key: 'age', header: t('home.invoiceAge', 'Invoice age'), align: 'num', cell: (row) => t('home.days', { count: invoiceAgeDays(row), defaultValue_one: '{{count}} day', defaultValue_other: '{{count}} days' }), exportValue: (row) => invoiceAgeDays(row) },
  ];
  return (
    <Card>
      <CardHead level={2} actions={<ExportButton rows={ready} columns={columns} entity={t('dashboard:hub.company.readyToPay', 'Ready to pay')} label={t('dashboard:hub.company.export', 'Export')} />}>{t('dashboard:hub.company.readyToPay', 'Ready to pay')}</CardHead>
      <div className="overflow-x-auto">
        <DataTable rows={ready} columns={columns} rowKey={(row) => row.id} onActivate={(row) => navigate(`/procurement/${row.id}`)} rowLabel={(row) => t('dashboard:hub.company.openProcurementNamed', 'Open {{name}}', { name: row.title })} state={pending ? 'loading' : error ? 'error' : ready.length === 0 ? 'empty' : undefined} onRetry={retry} emptyTitle={t('dashboard:hub.company.nothingReadyToPay', 'No supplier invoices are awaiting payment')} errorTitle={t('dashboard:hub.company.readyToPayError', "Couldn't load ready-to-pay records")} tableId="dashboard-company-ready-to-pay" embedded />
      </div>
    </Card>
  );
}

const usedPercent = (row: BudgetReviewRow) => budgetSpendKnown(row) && row.budget > 0 && row.budget_currency === row.currency ? Math.round(row.spent! / row.budget * 100) : null;

/** The active budgets, largest overrun first. Blank columns (spending nobody has recorded) drop out by themselves. */
export function BudgetReviewCard({ rows, pending, error, retry }: { rows: BudgetReviewRow[]; pending: boolean; error: boolean; retry: () => void }) {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
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
  ];
  if (!pending && !error && rows.length === 0) return null;
  return (
    <Card>
      <CardHead level={2} actions={<ExportButton rows={rows} columns={columns} entity={t('dashboard:hub.company.budgetReview', 'Budget review')} label={t('dashboard:hub.company.export', 'Export')} />}>{t('dashboard:hub.company.budgetReview', 'Budget review')}</CardHead>
      <div className="overflow-x-auto">
        <DataTable rows={rows} columns={columns} rowKey={(row) => row.id} onActivate={(row) => navigate(`/projects/${row.id}/budget`)} rowLabel={(row) => t('dashboard:hub.company.openBudgetFor', 'Open budget for {{name}}', { name: projectDisplayName(row) })} rowMenu={(row) => [
          { label: t('dashboard:hub.company.openProject', 'Open project'), onClick: () => navigate(`/projects/${row.id}`) },
          { label: t('dashboard:hub.company.openBudget', 'Open budget'), onClick: () => navigate(`/projects/${row.id}/budget`) },
        ]} state={pending ? 'loading' : error ? 'error' : undefined} onRetry={retry} errorTitle={t('dashboard:hub.company.budgetReviewError', "Couldn't load budget review")} tableId="dashboard-company-budget-review" embedded />
      </div>
    </Card>
  );
}

/** PMO-computed ageing (the finance hub's source), shown when the accounting system has no ageing synced (L12). */
function PmoAgeing({ kind, values, unknownCounts }: { kind: 'receivables' | 'payables'; values: React.ComponentProps<typeof AgeingStrip>['values']; unknownCounts?: React.ComponentProps<typeof AgeingStrip>['unknownCounts'] }) {
  return <AgeingStrip kind={kind} values={values} unknownCounts={unknownCounts} />;
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
  if (snapshotEmpty(arAging) && !finance.isError && Object.keys(pmo).length > 0) return <PmoAgeing kind="receivables" values={pmo} />;
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
  return <>
    <AccountingSnapshotsSection showActuals actualsCollapsed showApAging={!pmoStandsIn} showArAging={false} actualProjectNames={projectNames} actuals={actuals.data ?? []} actualsPending={actuals.isPending} actualsError={actuals.isError} onRetryActuals={() => void actuals.refetch()} apAging={apAging.data ?? []} apAgingPending={apAging.isPending || (snapshotEmpty(apAging) && finance.isPending)} apAgingError={apAging.isError} onRetryApAging={() => void apAging.refetch()} arAging={[]} />
    {pmoStandsIn && <Card><div className="p-4"><PmoAgeing kind="payables" values={pmo} unknownCounts={payables.payablesUnknownAgeing} /></div></Card>}
  </>;
}

/** Ageing and accounting snapshots for the finance role: its analysis, kept behind the "Analysis" heading. */
export function FinanceAnalysis() {
  return <div className="grid gap-[var(--space-panel-gap)]"><ClientAgingBlock /><PayablesAndActuals /></div>;
}
