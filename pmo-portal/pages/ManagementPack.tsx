import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import {
  Button, Card, DataTable, Icon, ListState, SearchMini, StatusPill, TextField, type Column,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useManagementPack } from '@/src/hooks/useManagementPack';
import { useProjectsDelivery } from '@/src/hooks/useProjectsDelivery';
import { useExport } from '@/src/components/export/useExport';
import { RecordProgressModal } from '@/src/components/reports/RecordProgressModal';
import { fromCents, type PackCurrencyTotals, type PackMonth, type PackRow, type PackTotalsMonth } from '@/src/lib/reports/managementPack';
import {
  buildManagementPackExport, managementPackFileStem, type ManagementPackExportLabels,
} from '@/src/lib/reports/managementPackExport';
import { monthInputToIso } from '@/src/lib/reports/months';
import { formatCurrencyAuto, formatUtcMonthYear } from '@/src/lib/format';
import { PROGRESS_RECORDABLE_PROJECT_STATUSES } from '@/src/lib/dashboardConstants';

type Measure = 'recognisedToDate' | 'invoicedToDate' | 'unbilled' | 'backlog';
type TotalsMeasure = 'planned' | 'recognised' | 'invoiced' | 'unbilled' | 'backlog';
type TotalsRow = PackTotalsMonth & { currency: string };

const KPI_MEASURES: Measure[] = ['recognisedToDate', 'invoicedToDate', 'unbilled', 'backlog'];
const TOTALS_MEASURES: TotalsMeasure[] = ['planned', 'recognised', 'invoiced', 'unbilled', 'backlog'];
const monthLabel = (iso: string) => formatUtcMonthYear(new Date(`${iso}T00:00:00Z`));
// OD-MONEY-FMT: the exact amount in its currency, zero fraction suppressed, non-zero fraction kept.
const money = (cents: number | null, currency: string) =>
  cents === null ? '—' : formatCurrencyAuto(fromCents(cents), currency);

function totalsForRows(rows: PackRow[], months: string[]): PackCurrencyTotals[] {
  const byCurrency = new Map<string, PackTotalsMonth[]>();
  for (const row of rows) {
    const series = byCurrency.get(row.currency) ?? months.map((month) => ({
      month, planned: 0, recognised: 0, invoiced: 0, recognisedToDate: 0, invoicedToDate: 0, unbilled: 0, backlog: 0 as number | null,
    }));
    row.months.forEach((month, index) => {
      const total = series[index];
      total.planned += month.planned ?? 0;
      total.recognised += month.recognised;
      total.invoiced += month.invoiced;
      total.recognisedToDate += month.recognisedToDate;
      total.invoicedToDate += month.invoicedToDate;
      total.unbilled += month.unbilled;
      if (row.kind === 'contract' && month.backlog === null) total.backlog = null;
      else if (total.backlog !== null) total.backlog += month.backlog ?? 0;
    });
    byCurrency.set(row.currency, series);
  }
  return [...byCurrency.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, series]) => ({ currency, months: series }));
}

const ManagementPack: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const { t } = useTranslation();
  const may = usePermission();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const canView = may('view', 'managementPack');
  const label: Record<Measure | TotalsMeasure, string> = {
    planned: t('managementPack.col.planned', 'Planned'),
    recognised: t('managementPack.col.recognised', 'Recognised'),
    invoiced: t('managementPack.col.invoiced', 'Invoiced'),
    unbilled: t('managementPack.col.unbilled', 'Unbilled'),
    recognisedToDate: t('managementPack.col.recognisedToDate', 'Recognised to date'),
    invoicedToDate: t('managementPack.col.invoicedToDate', 'Invoiced to date'),
    backlog: t('managementPack.col.backlog', 'Backlog'),
  };
  const range = { from: monthInputToIso(params.get('from') ?? ''), to: monthInputToIso(params.get('to') ?? '') };
  const { data: pack, isPending, isError, error, refetch } = useManagementPack(range);
  const { exportTable, busy } = useExport();
  const [progressFor, setProgressFor] = useState<PackRow | null>(null);
  const projectIds = useMemo(
    () => (pack?.rows ?? []).filter((r) => r.kind === 'contract' && r.projectId).map((r) => r.projectId as string),
    [pack],
  );
  const { data: delivery } = useProjectsDelivery(projectIds);

  const last = pack ? pack.months.length - 1 : -1;
  const at = (row: PackRow): PackMonth | null => (last >= 0 ? row.months[last] : null);
  const state: 'loading' | 'error' | 'empty' | undefined = isError
    ? 'error'
    : isPending
      ? 'loading'
      : pack && pack.rows.length === 0
        ? 'empty'
        : undefined;
  const invalidRange = (error as { code?: string } | null)?.code === '22023';
  const search = params.get('q') ?? '';
  const selectedProject = params.get('project') ?? '';
  const selectedCurrency = params.get('currency') ?? '';
  const requestedSort = params.get('sort');
  const projectSort: 'project-name-asc' | 'project-name-desc' = requestedSort === 'project-name-desc' ? 'project-name-desc' : 'project-name-asc';
  const historyOpen = params.get('history') === '1';

  useEffect(() => {
    if (!canView) return;
    const invalidSort = requestedSort !== null && requestedSort !== 'project-name-asc' && requestedSort !== 'project-name-desc';
    const invalidHistory = params.get('history') !== null && params.get('history') !== '0' && params.get('history') !== '1';
    const missingHistory = params.get('history') === null;
    if (!invalidSort && !invalidHistory && !missingHistory) return;
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (invalidSort) next.set('sort', 'project-name-asc');
      if (invalidHistory || missingHistory) next.set('history', '0');
      return next;
    }, { replace: true });
  }, [canView, params, requestedSort, setParams]);

  const updateParam = (key: string, value: string) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  };
  const projectOptions = [...new Map((pack?.rows ?? []).filter((row) => row.projectId).map((row) => [row.projectId!, {
    value: row.projectId!, label: row.projectName ?? row.projectId!,
  }])).values()].sort((left, right) => left.label.localeCompare(right.label));
  const currencyOptions = [...new Set((pack?.rows ?? []).map((row) => row.currency))].sort();
  const visiblePackRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (pack?.rows ?? [])
      .filter((row) => !selectedProject || (selectedProject === 'unassigned' ? row.kind === 'unassigned' : row.projectId === selectedProject))
      .filter((row) => !selectedCurrency || row.currency === selectedCurrency)
      .filter((row) => !query || `${row.projectName ?? ''} ${row.clientName ?? ''} ${row.projectNumber ?? ''} ${row.currency}`.toLocaleLowerCase().includes(query))
      .slice()
      .sort((left, right) => {
        const leftName = left.projectName ?? t('managementPack.unassigned', 'Unassigned');
        const rightName = right.projectName ?? t('managementPack.unassigned', 'Unassigned');
        if (left.kind === 'unassigned' && right.kind !== 'unassigned') return 1;
        if (right.kind === 'unassigned' && left.kind !== 'unassigned') return -1;
        return leftName.localeCompare(rightName) * (projectSort === 'project-name-asc' ? 1 : -1)
          || left.currency.localeCompare(right.currency)
          || left.kind.localeCompare(right.kind);
      });
  }, [pack, projectSort, search, selectedCurrency, selectedProject, t]);
  const visiblePack = useMemo(() => pack ? {
    ...pack,
    rows: visiblePackRows,
    totals: totalsForRows(visiblePackRows, pack.months),
  } : null, [pack, visiblePackRows]);

  if (!canView) {
    return (
      <div className="flex h-[calc(100vh-var(--header-h))] items-center justify-center px-4">
        <div className="text-center">
          <h2 className="text-heading font-semibold">
            {t('managementPack.noAccessTitle', "You don't have access to the management pack")}
          </h2>
          <p className="mt-2 text-muted-foreground">
            {t('managementPack.noAccessSub', 'The management pack is available to Finance, Project Managers, Executives and Admins.')}
          </p>
          <Button variant="outline" onClick={() => navigate('/')} className="mt-4 min-h-11">
            <Icon name="back" className="size-4 mr-2" />
            {t('financeCopy.backToDashboard', 'Back to dashboard')}
          </Button>
        </div>
      </div>
    );
  }

  const setMonth = (key: 'from' | 'to', value: string) => {
    const next = new URLSearchParams(params);
    if (monthInputToIso(value)) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const exportLabels: ManagementPackExportLabels = {
    month: t('managementPack.col.month', 'Month'),
    projectNumber: t('managementPack.col.projectNumber', 'Project number'),
    project: t('managementPack.col.project', 'Project'),
    client: t('managementPack.col.client', 'Client'),
    currency: t('managementPack.col.currency', 'Currency'),
    taxBasis: t('managementPack.col.taxBasis', 'Tax basis'),
    planned: label.planned,
    recognised: label.recognised,
    invoiced: label.invoiced,
    recognisedToDate: label.recognisedToDate,
    invoicedToDate: label.invoicedToDate,
    unbilled: label.unbilled,
    backlog: label.backlog,
    basis: t('managementPack.col.basis', 'Basis'),
    taxBasisValue: t('tax.basis.exclusive', 'excl. PPN'),
    unassigned: t('managementPack.unassigned', 'Unassigned'),
    total: t('managementPack.total', 'Total'),
    basisInvoiced: t('managementPack.basis.invoiced', 'Invoiced'),
    basisProgress: t('managementPack.basis.progressShort', 'Progress'),
  };
  // One Export (long-format CSV, one row per project × month with its currency and tax basis).
  const onExport = () => {
    if (visiblePack?.rows.length) void exportTable(buildManagementPackExport(visiblePack, exportLabels), managementPackFileStem(visiblePack), 'csv');
  };

  const canRecord = (row: PackRow) =>
    row.kind === 'contract' &&
    PROGRESS_RECORDABLE_PROJECT_STATUSES.has(row.projectStatus ?? '') &&
    !!row.projectId &&
    may('edit', 'projectProgress', { currentUserId: currentUser?.id ?? null, record: { project_manager_id: row.projectManagerId } });

  const measureCell = (key: Measure) => (row: PackRow) => {
    const m = at(row);
    const value = m ? m[key] : null;
    return (
      <span data-testid={`pack-cell-${key}`} className="tabular text-right text-[13px]">
        {key === 'backlog' && row.kind === 'contract' && value === null ? (
          <span title={t('uxs34.backlogReason', 'A foreign-currency invoice needs reconciliation before this balance can be known.')}>{t('uxs34.backlogUnavailable', 'Unavailable')}</span>
        ) : money(value, row.currency)}
        {key === 'unbilled' && value !== null && value < 0 && (
          <span className="ml-1 text-xs text-muted-foreground">{t('managementPack.billedAhead', 'billed ahead')}</span>
        )}
      </span>
    );
  };

  const backlogUnavailable = (
    <span title={t('uxs34.backlogReason', 'A foreign-currency invoice needs reconciliation before this balance can be known.')}>{t('uxs34.backlogUnavailable', 'Unavailable')}</span>
  );

  const columns: Column<PackRow>[] = [
    {
      key: 'project',
      header: t('managementPack.col.project', 'Project'),
      kind: 'primary',
      size: 260,
      primaryTitle: (row) => row.kind === 'unassigned' ? t('managementPack.unassigned', 'Unassigned') : row.projectName ?? '',
      cell: (row) =>
        row.kind === 'unassigned' ? (
          <StatusPill variant="neutral">{t('managementPack.unassigned', 'Unassigned')}</StatusPill>
        ) : (
          row.projectName
        ),
      secondaryCell: (row) =>
        row.kind === 'unassigned'
          ? undefined
          : row.kind === 'otherCurrency'
            ? t('managementPack.otherCurrency', 'Invoiced in {{currency}}, not the contract currency', { currency: row.currency })
            : row.projectNumber
              ? <span className="font-mono">{row.projectNumber}</span>
              : undefined,
    },
    {
      key: 'contract',
      header: t('managementPack.col.contract', 'Contract'),
      kind: 'money',
      align: 'num',
      size: 140,
      cell: (row) => (
        <span data-testid="pack-cell-contract" className="tabular text-right text-[13px]">
          {money(row.contractNet, row.currency)}
        </span>
      ),
    },
    ...KPI_MEASURES.map((k): Column<PackRow> => ({ key: k, header: label[k], kind: 'money', align: 'num', size: 140, cell: measureCell(k) })),
    {
      key: 'basis',
      header: t('managementPack.col.basis', 'Basis'),
      kind: 'meta',
      size: 110,
      cell: (row) =>
        row.latestProgress
          ? t('managementPack.basis.progress', '{{pct}}% complete', { pct: row.latestProgress.pctComplete })
          : t('managementPack.basis.invoiced', 'Invoiced'),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('managementPack.actions', 'Actions')}</span>,
      kind: 'actions',
      size: 150,
      cell: (row) =>
        canRecord(row) ? (
          <Button variant="outline" className="min-h-11" onClick={() => setProgressFor(row)}>
            {t('managementPack.recordProgress', 'Record progress')}
          </Button>
        ) : null,
    },
  ];

  // T10: one total row per currency (never summed across currencies) — cumulative figures at the as-at
  // month from the pack's own per-currency totals; the contract total adds only rows that carry a contract.
  const projectTotals = (visiblePack?.totals ?? []).map((tot) => {
    const m = tot.months[tot.months.length - 1];
    const contracts = (visiblePack?.rows ?? []).filter((r) => r.currency === tot.currency && r.contractNet !== null);
    const contractTotal = contracts.reduce((sum, r) => sum + (r.contractNet ?? 0), 0);
    return {
      key: tot.currency,
      label: `${t('managementPack.total', 'Total')} · ${tot.currency}`,
      values: {
        contract: contracts.length > 0 ? money(contractTotal, tot.currency) : null,
        recognisedToDate: money(m.recognisedToDate, tot.currency),
        invoicedToDate: money(m.invoicedToDate, tot.currency),
        unbilled: money(m.unbilled, tot.currency),
        backlog: m.backlog === null ? backlogUnavailable : money(m.backlog, tot.currency),
      } as Record<string, React.ReactNode>,
    };
  });

  const totalsRows: TotalsRow[] = (visiblePack?.totals ?? []).flatMap((tot) =>
    tot.months.map((m) => ({ ...m, currency: tot.currency })),
  ).sort((left, right) => left.month.localeCompare(right.month) || left.currency.localeCompare(right.currency));
  const totalsColumns: Column<TotalsRow>[] = [
    { key: 'month', header: t('managementPack.col.month', 'Month'), kind: 'date', size: 120, cell: (r) => monthLabel(r.month) },
    {
      key: 'currency',
      header: t('managementPack.col.currency', 'Currency'),
      kind: 'text',
      size: 100,
      cell: (r) => r.currency,
    },
    ...TOTALS_MEASURES.map((k): Column<TotalsRow> => ({
      key: k,
      header: label[k],
      kind: 'money',
      align: 'num',
      size: 140,
      cell: (r) => (
        <span className="tabular text-right text-[13px]">
          {k === 'backlog' && r.backlog === null
            ? <span title={t('uxs34.backlogReason', 'A foreign-currency invoice needs reconciliation before this balance can be known.')}>{t('uxs34.backlogUnavailable', 'Unavailable')}</span>
            : money(r[k], r.currency)}
        </span>
      ),
    })),
  ];

  const exportAction = (
    <Button variant="outline" disabled={!visiblePack?.rows.length || busy} onClick={onExport} className="min-h-11">
      <Icon name="export" className="size-4 mr-2" />
      {t('moneyIn:uxs42.exportMonthlyData', 'Export monthly data')}
    </Button>
  );
  const periodControls = (
    <div className="mb-4 flex min-w-0 flex-wrap items-end gap-3">
        <TextField
          id="pack-from"
          type="month"
          label={t('managementPack.from', 'From')}
          value={params.get('from') ?? pack?.from.slice(0, 7) ?? ''}
          onChange={(v) => setMonth('from', v)}
          className="min-h-11"
        />
        <TextField
          id="pack-as-at"
          type="month"
          label={t('managementPack.asAt', 'As at')}
          value={params.get('to') ?? pack?.to.slice(0, 7) ?? ''}
          onChange={(v) => setMonth('to', v)}
          className="min-h-11"
        />
      </div>
  );
  const filters = (
    <div role="group" aria-label={t('moneyIn:uxs42.earnedFilters', 'Earned revenue filters')} className="mb-3 min-w-0 space-y-3">
      <SearchMini
        placeholder={t('moneyIn:uxs42.searchProjects', 'Search projects')}
        aria-label={t('moneyIn:uxs42.searchProjects', 'Search projects')}
        value={search}
        onChange={(event) => updateParam('q', event.target.value)}
        searchSurface="project-revenue-earned"
        module="managementPack"
        resultCount={visiblePackRows.length}
        containerClassName="w-full min-w-0 min-h-11"
      />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="earned-project-filter">{t('moneyIn:uxs42.filterByProject', 'Filter by project')}</label>
        <select id="earned-project-filter" aria-label={t('moneyIn:uxs42.filterByProject', 'Filter by project')} value={selectedProject}
          onChange={(event) => updateParam('project', event.target.value)}
          className="min-h-11 min-w-0 max-w-full rounded-md border border-border bg-card px-3 text-sm text-foreground">
          <option value="">{t('moneyIn:uxs42.allProjects', 'All projects')}</option>
          <option value="unassigned">{t('managementPack.unassigned', 'Unassigned')}</option>
          {selectedProject && selectedProject !== 'unassigned' && !projectOptions.some((option) => option.value === selectedProject) &&
            <option value={selectedProject}>{t('moneyIn:uxs42.projectUnavailable', 'Project unavailable')}</option>}
          {projectOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <label className="sr-only" htmlFor="earned-currency-filter">{t('moneyIn:uxs42.filterByCurrency', 'Filter by currency')}</label>
        <select id="earned-currency-filter" aria-label={t('moneyIn:uxs42.filterByCurrency', 'Filter by currency')} value={selectedCurrency}
          onChange={(event) => updateParam('currency', event.target.value)}
          className="min-h-11 min-w-0 max-w-full rounded-md border border-border bg-card px-3 text-sm text-foreground">
          <option value="">{t('moneyIn:uxs42.allCurrencies', 'All currencies')}</option>
          {selectedCurrency && !currencyOptions.includes(selectedCurrency) && <option value={selectedCurrency}>{selectedCurrency}</option>}
          {currencyOptions.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
        </select>
        <label className="sr-only" htmlFor="earned-sort">{t('moneyIn:uxs42.sortProjects', 'Sort projects')}</label>
        <select id="earned-sort" aria-label={t('moneyIn:uxs42.sortProjects', 'Sort projects')} value={projectSort}
          onChange={(event) => updateParam('sort', event.target.value)}
          className="min-h-11 min-w-0 max-w-full rounded-md border border-border bg-card px-3 text-sm text-foreground">
          <option value="project-name-asc">{t('moneyIn:uxs42.projectNameAscending', 'Project name A–Z')}</option>
          <option value="project-name-desc">{t('moneyIn:uxs42.projectNameDescending', 'Project name Z–A')}</option>
        </select>
        {embedded && exportAction}
        {embedded && visiblePackRows.length === 0 && (
          <span className="text-xs text-muted-foreground">{t('moneyIn:uxs42.noRowsToExport', 'No rows to export')}</span>
        )}
      </div>
    </div>
  );
  const content = (
    <>
      {pack && state === undefined && (
        <p className="mb-3 text-sm text-muted-foreground">
          {t('uxs34.cumulativeScope', 'Cumulative amounts · since project start through {{month}}', { month: monthLabel(pack.to) })}
        </p>
      )}
      {state === 'loading' && (
        <div className="rounded-lg border border-border bg-card"><ListState variant="loading" rows={6} /></div>
      )}
      {state === 'error' && (
        <ListState
          variant="error"
          title={t('managementPack.errorTitle', "Couldn't load the management pack")}
          sub={invalidRange
            ? t('managementPack.invalidRange', 'Choose a start month on or before the as-at month, at most 24 months apart.')
            : t('managementPack.errorSub', 'The request failed. Check your connection and try again.')}
          onRetry={!invalidRange ? () => { void refetch(); } : undefined}
          retryLabel={t('managementPack.retry', 'Retry')}
        />
      )}
      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="table"
          title={t('managementPack.emptyTitle', 'No projects to report')}
          sub={t('moneyIn:uxs42.earnedEmpty', 'Eligible projects and their earned or billed evidence appear here.')}
          action={{ label: t('moneyIn:uxs42.openProjects', 'Open projects'), onClick: () => navigate('/projects') }}
        />
      )}

      {pack && state === undefined && (
        <>
          <h2 className="mb-2 text-[15px] font-semibold">
            {t('managementPack.projectsAsAt', 'Projects as at {{month}}', { month: monthLabel(pack.to) })}
          </h2>
          <Card className="overflow-hidden mb-6">
            <DataTable
              rows={visiblePackRows}
              columns={columns}
              rowKey={(row) => row.key}
              tableId="managementpack-1-table"
              accessibleName={t('managementPack.col.project', 'Project')}
              totals={projectTotals}
              state={visiblePackRows.length === 0 ? 'empty' : undefined}
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
            />
          </Card>
          <details className="mb-6 rounded-md border border-border px-3" open={historyOpen}
            onToggle={(event) => updateParam('history', event.currentTarget.open ? '1' : '0')}>
            <summary className="min-h-11 cursor-pointer py-3 font-medium">{t('moneyIn:uxs42.monthlyHistory', 'Monthly history')}</summary>
            <Card className="mb-3 overflow-hidden">
              <DataTable rows={totalsRows} columns={totalsColumns} rowKey={(r) => `${r.currency}|${r.month}`} tableId="managementpack-2-table" accessibleName={t('moneyIn:uxs42.monthlyHistory', 'Monthly history')} />
            </Card>
          </details>
          {pack.undatedInvoiceCount > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {t('managementPack.undated', '{{count}} invoices have no date and are not counted', { count: pack.undatedInvoiceCount })}
            </p>
          )}
        </>
      )}

      {progressFor && progressFor.projectId && visiblePack && (
        <RecordProgressModal
          open
          onClose={() => setProgressFor(null)}
          projectId={progressFor.projectId}
          projectName={progressFor.projectName ?? ''}
          defaultMonth={visiblePack.to}
          deliveryPct={delivery?.[progressFor.projectId] ?? null}
        />
      )}
    </>
  );

  return <section className="min-w-0">{periodControls}{filters}{content}</section>;
};

export default ManagementPack;
