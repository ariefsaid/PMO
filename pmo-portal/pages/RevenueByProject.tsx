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
import { formatCurrencyAuto, formatCurrencyCents, formatNumber } from '@/src/lib/format';
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
  const totalInvoices = useMemo(
    () => all.reduce((sum, row) => sum + row.invoice_count, 0),
    [all]
  );

  const canView = may('view', 'project');

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
      cell: (row) => (
        <div className="flex flex-col gap-0.5">
          {row.project_name ? (
            <>
              <span className="font-semibold">{row.project_name}</span>
              <span className="text-xs text-muted-foreground font-mono">
                {t('financeCopy.invoiceCount', '{{count}} invoices', { count: row.invoice_count })}
              </span>
            </>
          ) : (
            <StatusPill variant="neutral">{t('financeCopy.unassigned', "Unassigned")}</StatusPill>
          )}
        </div>
      ),
      exportValue: (row) => row.project_name ?? 'Unassigned',
    },
    {
      // #831: the export must name each row's currency, or a USD and an IDR row sum together in a spreadsheet.
      key: 'currency',
      header: t('financeCopy.currency', 'Currency'),
      cell: (row) => <span className="font-mono text-[13px]">{row.currency}</span>,
      exportValue: (row) => row.currency,
    },
    {
      key: 'total_amount',
      header: t('financeCopy.totalRevenue', "Total Revenue"),
      align: 'num',
      cell: (row) => (
        <span className="tabular text-right font-mono text-[13px]">
          {formatCurrencyCents(row.total_amount, row.currency)}
        </span>
      ),
      exportValue: (row) => row.total_amount,
    },
    {
      key: 'open_ar',
      header: t('financeCopy.openAR', "Open AR"),
      align: 'num',
      cell: (row) => (
        <span className="tabular text-right font-mono text-[13px]">
          {formatCurrencyCents(row.open_ar, row.currency)}
        </span>
      ),
      exportValue: (row) => row.open_ar,
    },
    {
      key: 'invoice_count',
      header: t('financeCopy.invoices', "Invoices"),
      align: 'num',
      cell: (row) => (
        <span className="tabular text-right font-mono text-[13px]">
          {row.invoice_count}
        </span>
      ),
      exportValue: (row) => row.invoice_count,
    },
  ];

  return (
    <ListPage
      title={t('financeCopy.revenueByProject', "Revenue by Project")}
      description={t(
        'revenueByProject.subtitle',
        'Project revenue, with a separate Unassigned group for invoices not linked to a project.',
      )}
      primaryAction={
        <Button variant="outline" onClick={() => navigate('/projects')}>
          <Icon name="pipe" className="size-4 mr-2" />
          {t('financeCopy.browseProjects', "Browse Projects")}</Button>
      }
    >
      {/* KPI Summary — honest states only (BLOCK 2 / the AccountingSnapshotsSection rule): while the
          rollup is loading the tiles are skeletons, and on a failed query they show "—", NEVER a
          fabricated $0 that reads as a real figure for an org that may bill millions. */}
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4 mb-6">
        <KPITile
          label={t('financeCopy.totalRevenue', "Total Revenue")}
          value={money(revenueTotals)}
          icon="dollar"
          tone="blue"
          loading={isPending || currencyPending}
          error={isError || currencyError}
        />
        <KPITile
          label={t('financeCopy.openAR', "Open AR")}
          value={money(openARTotals)}
          icon="dollar"
          tone="amber"
          loading={isPending || currencyPending}
          error={isError || currencyError}
        />
        <KPITile
          label={t('financeCopy.totalInvoices', "Total Invoices")}
          value={formatNumber(totalInvoices)}
          icon="file"
          tone="violet"
          loading={isPending}
          error={isError}
        />
        <KPITile
          label={t('financeCopy.projects', "Projects")}
          value={formatNumber(new Set(all.map((r) => r.project_id).filter(Boolean)).size)}
          icon="pipe"
          tone="green"
          loading={isPending}
          error={isError}
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
          sub={t('financeCopy.createSalesInvoicesToSeeRevenuePerProject', "Create sales invoices to see revenue per project.")}
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
            }}
            rowLabel={(row) => `Open ${row.project_name ?? 'Unassigned'} (${row.currency})`}
            state={all.length === 0 ? 'empty' : undefined}
            emptyTitle={t('financeCopy.noRevenueData', "No revenue data")}
            emptySub={t('financeCopy.invoicesWithAmountsWillAppearHere', "Invoices with amounts will appear here.")}
          />
        </Card>
      )}
    </ListPage>
  );
};

export default RevenueByProject;
