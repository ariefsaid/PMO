import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useOrgCurrencyState } from '@/src/hooks/useOrgCurrency';
import {
  ListState,
  DataTable,
  StatusPill,
  Card,
  Button,
  Icon,
  SearchMini,
  type Column,
} from '@/src/components/ui';
import { useNavigate, useSearchParams } from 'react-router';
import { usePermission } from '@/src/auth/usePermission';
import { useRevenuePerProject } from '@/src/hooks/useRevenue';
import { formatCurrencyAuto } from '@/src/lib/format';
import { sumPerCurrency } from '@/src/lib/sumPerCurrency';
import type { RevenueByProjectRow } from '@/src/lib/db/revenue';
import { ExportButton } from '@/src/components/export';

type ProjectSort = 'project-name-asc' | 'project-name-desc';

const RevenueByProject: React.FC = () => {
  // #831: revenue is net of tax and grouped per (project, currency) — each figure is labelled with its
  // OWN currency and never converted or added across currencies. The org default only denominates the
  // empty-org zero.
  const { isResolved: currencyResolved, isError: currencyError, refetch: refetchCurrency } = useOrgCurrencyState();
  const { t } = useTranslation();
  const may = usePermission();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data, isPending, isError, refetch } = useRevenuePerProject();
  const all = useMemo(() => data ?? [], [data]);

  const requestedSort = params.get('sort');
  const projectSort: ProjectSort = requestedSort === 'project-name-desc' ? 'project-name-desc' : 'project-name-asc';
  const search = params.get('q') ?? '';
  const selectedProject = params.get('project') ?? '';
  const selectedCurrency = params.get('currency') ?? '';
  const updateParam = (key: string, value: string) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  };
  useEffect(() => {
    if (requestedSort === null || requestedSort === 'project-name-asc' || requestedSort === 'project-name-desc') return;
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set('sort', 'project-name-asc');
      return next;
    }, { replace: true });
  }, [requestedSort, setParams]);
  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return all
      .filter((row) => !selectedProject || (selectedProject === 'unassigned' ? !row.project_id : row.project_id === selectedProject))
      .filter((row) => !selectedCurrency || row.currency === selectedCurrency)
      .filter((row) => !query || `${row.project_name ?? ''} ${row.project_short_name ?? ''} ${row.currency}`.toLocaleLowerCase().includes(query))
      .slice()
      .sort((left, right) => {
        const leftName = left.project_short_name?.trim() || left.project_name || 'Unassigned';
        const rightName = right.project_short_name?.trim() || right.project_name || 'Unassigned';
        const leftUnassigned = !left.project_id;
        const rightUnassigned = !right.project_id;
        if (leftUnassigned !== rightUnassigned) return leftUnassigned ? 1 : -1;
        const byName = leftName.localeCompare(rightName) * (projectSort === 'project-name-asc' ? 1 : -1);
        return byName || left.currency.localeCompare(right.currency);
      });
  }, [all, projectSort, search, selectedCurrency, selectedProject]);
  const revenueTotals = useMemo(() => sumPerCurrency(visibleRows, (row) => row.total_amount), [visibleRows]);
  const openARTotals = useMemo(() => sumPerCurrency(visibleRows, (row) => row.open_ar), [visibleRows]);

  const canView = may('view', 'salesInvoice');
  const canCreateInvoice = may('create', 'salesInvoice');
  const projectOptions = [...new Map(all.filter((row) => row.project_id).map((row) => [row.project_id!, {
    value: row.project_id!, label: row.project_short_name?.trim() || row.project_name || row.project_id!,
  }])).values()].sort((a, b) => a.label.localeCompare(b.label));
  const currencyOptions = [...new Set(all.map((row) => row.currency))].sort();

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
          <Button variant="outline" onClick={() => navigate('/')} className="mt-4 min-h-11">
            <Icon name="back" className="size-4 mr-2" />
            {t('financeCopy.backToDashboard', "Back to dashboard")}</Button>
        </div>
      </div>
    );
  }

  // Screen shows the short name; exports and the contractual title stay `project_name` (AC-003 #1325).
  const shown = (row: RevenueByProjectRow) => row.project_name ? row.project_short_name?.trim() || row.project_name : null;

  const columns: Column<RevenueByProjectRow>[] = [
    {
      key: 'project_name',
      header: t('financeCopy.project', "Project"),
      kind: 'primary',
      size: 300,
      primaryTitle: (row) => shown(row) ?? t('financeCopy.unassigned', "Unassigned"),
      // FIN-S6: the whole row opens the project (or the unassigned list); the name is the keyboard doorway.
      cell: (row) => shown(row) ? (
        <button
          type="button"
          aria-label={t('moneyIn:uxs42.openProject', 'Open {{project}} ({{currency}})', { project: shown(row), currency: row.currency })}
          title={row.project_name !== shown(row) ? row.project_name ?? undefined : undefined}
          className="min-h-11 w-fit text-left font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onClick={(event) => {
            event.stopPropagation();
            navigate(`/projects/${row.project_id}`);
          }}
        >
          {shown(row)}
        </button>
      ) : (
        <button
          type="button"
          aria-label={t('moneyIn:uxs42.openUnassigned', 'Open Unassigned ({{currency}})', { currency: row.currency })}
          className="min-h-11 w-fit focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
      invoice_count: visibleRows.filter((r) => r.currency === currency).reduce((sum, r) => sum + r.invoice_count, 0),
    } as Record<string, React.ReactNode>,
  }));

  const toolbar = (
    <div role="group" aria-label={t('moneyIn:uxs42.billingFilters', 'Billing filters')} className="mb-4 min-w-0 space-y-3">
      <SearchMini
        placeholder={t('moneyIn:uxs42.searchProjects', 'Search projects')}
        aria-label={t('moneyIn:uxs42.searchProjects', 'Search projects')}
        value={search}
        onChange={(event) => updateParam('q', event.target.value)}
        searchSurface="project-revenue-billing"
        module="revenueByProject"
        resultCount={visibleRows.length}
        containerClassName="w-full min-w-0 min-h-11"
      />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="billing-project-filter">{t('moneyIn:uxs42.filterByProject', 'Filter by project')}</label>
        <select id="billing-project-filter" aria-label={t('moneyIn:uxs42.filterByProject', 'Filter by project')} value={selectedProject}
          onChange={(event) => updateParam('project', event.target.value)}
          className="min-h-11 min-w-0 max-w-full rounded-md border border-border bg-card px-3 text-sm text-foreground">
          <option value="">{t('moneyIn:uxs42.allProjects', 'All projects')}</option>
          <option value="unassigned">{t('financeCopy.unassigned', 'Unassigned')}</option>
          {selectedProject && selectedProject !== 'unassigned' && !projectOptions.some((option) => option.value === selectedProject) &&
            <option value={selectedProject}>{t('moneyIn:uxs42.projectUnavailable', 'Project unavailable')}</option>}
          {projectOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <label className="sr-only" htmlFor="billing-currency-filter">{t('moneyIn:uxs42.filterByCurrency', 'Filter by currency')}</label>
        <select id="billing-currency-filter" aria-label={t('moneyIn:uxs42.filterByCurrency', 'Filter by currency')} value={selectedCurrency}
          onChange={(event) => updateParam('currency', event.target.value)}
          className="min-h-11 min-w-0 max-w-full rounded-md border border-border bg-card px-3 text-sm text-foreground">
          <option value="">{t('moneyIn:uxs42.allCurrencies', 'All currencies')}</option>
          {selectedCurrency && !currencyOptions.includes(selectedCurrency) && <option value={selectedCurrency}>{selectedCurrency}</option>}
          {currencyOptions.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
        </select>
        <label className="sr-only" htmlFor="billing-sort">{t('moneyIn:uxs42.sortProjects', 'Sort projects')}</label>
        <select id="billing-sort" aria-label={t('moneyIn:uxs42.sortProjects', 'Sort projects')} value={projectSort}
          onChange={(event) => updateParam('sort', event.target.value)}
          className="min-h-11 min-w-0 max-w-full rounded-md border border-border bg-card px-3 text-sm text-foreground">
          <option value="project-name-asc">{t('moneyIn:uxs42.projectNameAscending', 'Project name A–Z')}</option>
          <option value="project-name-desc">{t('moneyIn:uxs42.projectNameDescending', 'Project name Z–A')}</option>
        </select>
        <ExportButton rows={visibleRows} columns={columns} entity={t('moneyIn:uxs42.billingTotals', 'Billing totals')}
          label={t('moneyIn:uxs42.exportBillingTotals', 'Export billing totals')} className="min-h-11" />
        {visibleRows.length === 0 && <span className="text-xs text-muted-foreground">{t('moneyIn:uxs42.noRowsToExport', 'No rows to export')}</span>}
      </div>
    </div>
  );

  const content = (
    <>
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
            : t('moneyIn:uxs42.billingErrorTitle', "Couldn't load billing totals")}
          sub={currencyError
            ? t('revenueByProject.currencyErrorSub', 'Try again to view revenue.')
            : t('moneyIn:uxs42.billingErrorSub', 'The request failed. Check your connection and try again.')}
          onRetry={() => { void (currencyError ? refetchCurrency() : refetch()); }}
          retryLabel={t('ui.listState.retry', 'Retry')}
        />
      )}

      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="table"
          title={t('financeCopy.noRevenueDataYet', "No revenue data yet")}
          sub={canCreateInvoice
            ? t('moneyIn:uxs42.billingEmptyFinance', 'Project billing will appear here after invoices are recorded.')
            : t('moneyIn:uxs42.billingEmptyReader', 'Project billing has not been recorded yet. Open your projects to see project work.')}
          action={{
            label: canCreateInvoice ? t('moneyIn:uxs42.openInvoices', 'Open invoices') : t('moneyIn:uxs42.openProjects', 'Open projects'),
            onClick: () => navigate(canCreateInvoice ? '/sales-invoices' : '/projects'),
          }}
        />
      )}

      {state === undefined && (
        <Card className="overflow-hidden">
          <DataTable
            rows={visibleRows}
            columns={columns}
            rowKey={(row) => `${row.project_id ?? 'unassigned'}|${row.currency}`}
            onActivate={(row) => {
              if (row.project_id) navigate(`/projects/${row.project_id}`);
              else navigate('/sales-invoices?attribution=unassigned');
            }}
            state={visibleRows.length === 0 ? 'empty' : undefined}
            emptyTitle={t('moneyIn:uxs42.noProjectMatches', 'No projects match these filters')}
            emptySub={t('moneyIn:uxs42.clearBillingFilters', 'Clear search and filters to see all billing totals.')}
            emptyAction={{
              label: t('moneyIn:financeCopy.clearFilters', 'Clear filters'),
              onClick: () => setParams((current) => {
                const next = new URLSearchParams(current);
                for (const key of ['q', 'project', 'currency', 'sort']) next.delete(key);
                return next;
              }, { replace: true }),
            }}
            tableId="revenuebyproject-table"
            accessibleName={t('financeCopy.revenueByProject', "Revenue by Project")}
            totals={totalRows}
          />
        </Card>
      )}
    </>
  );

  return <section className="min-w-0">{toolbar}{content}</section>;
};

export default RevenueByProject;
