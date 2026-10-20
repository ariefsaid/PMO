import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useOrgCurrencyState } from '@/src/hooks/useOrgCurrency';
import {
  ListPage,
  ListState,
  DataTable,
  StatusPill,
  Card,
  KPITile,
  Button,
  Icon,
  type Column,
} from '@/src/components/ui';
import { useNavigate } from 'react-router';
import { usePermission } from '@/src/auth/usePermission';
import { useRevenuePerProject } from '@/src/hooks/useRevenue';
import { formatCurrencyAuto } from '@/src/lib/format';
import { sumPerCurrency } from '@/src/lib/sumPerCurrency';
import type { RevenueByProjectRow } from '@/src/lib/db/revenue';

const RevenueByProject: React.FC = () => {
  // #831: revenue is net of tax and grouped per (project, currency) — each figure is labelled with its
  // OWN currency and never converted or added across currencies. The org default only denominates the
  // empty-org zero.
  const { currency: orgCurrency, isResolved: currencyResolved, isError: currencyError } = useOrgCurrencyState();
  const { t } = useTranslation();
  const may = usePermission();
  const navigate = useNavigate();
  const { data, isPending, isError } = useRevenuePerProject();
  const all = useMemo(() => data ?? [], [data]);

  // Calculate totals (must be before any early return for hooks rules)
  const revenueTotals = useMemo(() => sumPerCurrency(all, (row) => row.total_amount), [all]);
  const openARTotals = useMemo(() => sumPerCurrency(all, (row) => row.open_ar), [all]);
  const money = (totals: Array<{ currency: string; amount: number }>) =>
    totals.length === 0
      ? formatCurrencyAuto(0, orgCurrency)
      : totals.map((x) => formatCurrencyAuto(x.amount, x.currency)).join(' · ');

  const canView = may('view', 'salesInvoice');
  const canCreateInvoice = may('create', 'salesInvoice');

  const currencyPending = !currencyResolved && !currencyError;
  const state: 'loading' | 'empty' | 'error' | undefined = isError || currencyError
    ? 'error'
    : isPending || currencyPending
      ? 'loading'
      : all.length === 0
        ? 'empty'
        : undefined;

  if (!canView) {
    return (
      <div className="flex h-[calc(100vh-var(--header-h))] items-center justify-center px-4">
        <div className="text-center">
          <h2 className="text-heading font-semibold">{t('financeCopy.youDonTHaveAccessToRevenueByProject', "You don't have access to Revenue by Project")}</h2>
          <p className="mt-2 text-muted-foreground">
            {t('financeCopy.theRevenuePerProjectViewIsAvailableToFinanceProjectManagersAndExecutives', "The revenue per project view is available to Finance, Project Managers, and Executives.")}</p>
          <Button variant="outline" onClick={() => navigate('/')} className="mt-4">
            <Icon name="back" className="size-4 mr-2" />
            {t('financeCopy.backToDashboard', "Back to dashboard")}</Button>
        </div>
      </div>
    );
  }

  const columns: Column<RevenueByProjectRow>[] = [
    {
      key: 'project_name',
      header: t('financeCopy.project', "Project"),
      kind: 'primary',
      size: 300,
      primaryTitle: (row) => row.project_name ?? t('financeCopy.unassigned', "Unassigned"),
      // FIN-S6: the whole row opens the project (or the unassigned list); the name is the keyboard doorway.
      cell: (row) => row.project_name ? (
        <button
          type="button"
          aria-label={`Open ${row.project_name} (${row.currency})`}
          className="w-fit text-left font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onClick={(event) => {
            event.stopPropagation();
            navigate(`/projects/${row.project_id}`);
          }}
        >
          {row.project_name}
        </button>
      ) : (
        <button
          type="button"
          aria-label={`Open Unassigned (${row.currency})`}
          className="w-fit focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onClick={(event) => {
            event.stopPropagation();
            navigate('/sales-invoices?attribution=unassigned');
          }}
        >
          <StatusPill variant="neutral">{t('financeCopy.unassigned', "Unassigned")}</StatusPill>
        </button>
      ),
      exportValue: (row) => row.project_name ?? 'Unassigned',
    },
    {
      // #831: the export must name each row's currency, or a USD and an IDR row sum together in a spreadsheet.
      // The on-screen amounts already carry their own currency, so this column is export-only (FIN-S6).
      key: 'currency',
      header: t('financeCopy.currency', 'Currency'),
      exportOnly: true,
      cell: (row) => row.currency,
      exportValue: (row) => row.currency,
    },
    {
      key: 'total_amount',
      header: `${t('financeCopy.totalRevenue', 'Total Revenue')} (${t('uxs37.billedWorkTaxBasis', 'net of tax')})`,
      kind: 'money',
      align: 'num',
      size: 200,
      cell: (row) => formatCurrencyAuto(row.total_amount, row.currency),
      exportValue: (row) => row.total_amount,
    },
    {
      key: 'open_ar',
      header: `${t('financeCopy.openAR', 'Open AR')} (${t('uxs37.openReceivablesTaxBasis', 'gross, tax included')})`,
      kind: 'money',
      align: 'num',
      size: 200,
      cell: (row) => formatCurrencyAuto(row.open_ar, row.currency),
      exportValue: (row) => row.open_ar,
    },
    {
      key: 'invoice_count',
      header: t('financeCopy.invoices', "Invoices"),
      kind: 'number',
      align: 'num',
      size: 96,
      cell: (row) => row.invoice_count,
      exportValue: (row) => row.invoice_count,
    },
  ];

  // T10: one total row per currency in the table's <tfoot> — currencies are never added together (#831).
  const totalRows = revenueTotals.map(({ currency, amount }) => ({
    key: currency,
    label: `${t('financeCopy.total', 'Total')} · ${currency}`,
    values: {
      total_amount: formatCurrencyAuto(amount, currency),
      open_ar: formatCurrencyAuto(openARTotals.find((x) => x.currency === currency)?.amount ?? 0, currency),
      invoice_count: all.filter((r) => r.currency === currency).reduce((sum, r) => sum + r.invoice_count, 0),
    } as Record<string, React.ReactNode>,
  }));

  return (
    <ListPage
      title={t('financeCopy.revenueByProject', "Revenue by Project")}
      description={t(
        'revenueByProject.subtitle',
        "Project revenue, with a separate Unassigned group for invoices not linked to a project.",
      )}
      primaryAction={canCreateInvoice ? (
        <Button variant="primary" onClick={() => navigate('/sales-invoices?create=1')}>
          <Icon name="plus" />
          {t('financeCopy.newInvoice', 'New Invoice')}</Button>
      ) : undefined}
    >
      {/* KPI Summary — honest states only (BLOCK 2 / the AccountingSnapshotsSection rule): while the
          rollup is loading the tiles are skeletons, and on a failed query they show "—", NEVER a
          fabricated $0 that reads as a real figure for an org that may bill millions. */}
      <div className="grid gap-4 sm:grid-cols-2 mb-6">
        <KPITile
          label={`${t('financeCopy.totalRevenue', 'Total Revenue')} (${t('uxs37.billedWorkTaxBasis', 'net of tax')})`}
          value={money(revenueTotals)}
          icon="dollar"
          tone="blue"
          loading={isPending || currencyPending}
          error={isError || currencyError}
        />
        <KPITile
          label={`${t('financeCopy.openAR', 'Open AR')} (${t('uxs37.openReceivablesTaxBasis', 'gross, tax included')})`}
          value={money(openARTotals)}
          icon="dollar"
          tone="amber"
          loading={isPending || currencyPending}
          error={isError || currencyError}
        />
      </div>

      {/* Body */}
      {state === 'loading' && (
        <div className="rounded-lg border border-border bg-card">
          <ListState variant="loading" rows={6} />
        </div>
      )}

      {state === 'error' && (
        <ListState
          variant="error"
          title={currencyError
            ? t('revenueByProject.currencyErrorTitle', "Couldn't load organization currency")
            : "Couldn't load revenue data"}
          sub={currencyError
            ? t('revenueByProject.currencyErrorSub', 'Try again to view revenue.')
            : 'The request failed. Check your connection and try again.'}
        />
      )}

      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="table"
          title={t('financeCopy.noRevenueDataYet', "No revenue data yet")}
          sub={canCreateInvoice
            ? t('financeCopy.createSalesInvoicesToSeeRevenuePerProject', 'No invoice revenue has been recorded yet. New Invoice starts billing; revenue appears here after invoices are recorded.')
            : t('uxs26.revenueEmptyProjectManager', 'No invoice revenue has been recorded yet. Finance manages invoice creation. Browse projects to review project work.')}
        />
      )}

      {state === undefined && (
        <Card className="overflow-hidden">
          <DataTable
            rows={all}
            columns={columns}
            rowKey={(row) => `${row.project_id ?? 'unassigned'}|${row.currency}`}
            onActivate={(row) => {
              if (row.project_id) navigate(`/projects/${row.project_id}`);
              else navigate('/sales-invoices?attribution=unassigned');
            }}
            state={all.length === 0 ? 'empty' : undefined}
            emptyTitle={t('financeCopy.noRevenueData', "No revenue data")}
            emptySub={t('financeCopy.invoicesWithAmountsWillAppearHere', "Invoices with amounts will appear here.")}
            tableId="revenuebyproject-table"
            accessibleName={t('financeCopy.revenueByProject', "Revenue by Project")}
            totals={totalRows}
          />
        </Card>
      )}
    </ListPage>
  );
};

export default RevenueByProject;
