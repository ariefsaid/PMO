import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, ListPage, ListState, SearchMini, StatusPill, Toolbar, useUrlFilters, isMostUrgentLateRow, type Column } from '@/src/components/ui';
import { AgeingStrip } from '@/src/components/finance/AgeingStrip';
import { FinanceAccessDenied } from '@/src/components/finance/FinanceAccessDenied';
import { useFinanceAccess } from '@/src/components/finance/useFinanceAccess';
import { useExport } from '@/src/components/export/useExport';
import { useProjects } from '@/src/hooks/useProjects';
import { useOrgCurrencyState } from '@/src/hooks/useOrgCurrency';
import type { FinancePosition } from '@/src/lib/finance/financePosition';
import { formatTableMoney } from '@/src/lib/format';
import { KPIRow, KPITile } from '@/src/components/ui/KPITile';
import { FigureHiddenLine, FigureScope } from '@/src/components/ui/FigureScope';
import { moneyTileProps } from '@/src/components/finance/moneyTile';
import { initials } from '@/src/lib/initials';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { usePayablesPagePosition } from '@/src/hooks/usePayablesPagePosition';

type PayableRow = FinancePosition['payables'][number];

/** Known unpaid balances by currency; unknown balances are counted separately, never as zero. */
function currencyTotals(rows: PayableRow[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((totals, row) => {
    if (row.amount === null) return totals;
    const currency = row.procurement.currency;
    totals[currency] = (totals[currency] ?? 0) + row.amount;
    return totals;
  }, {});
}

const PayablesPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const openProcurement = (procurementId: string) => navigate(`/procurement/${procurementId}`, {
    state: { recordContext: { origin: 'finance-payables' } },
  });
  const { canView } = useFinanceAccess();
  const payablesPosition = usePayablesPagePosition(canView);
  const isPending = payablesPosition.isPending;
  const isError = payablesPosition.isError;
  const agePending = payablesPosition.agePending;
  const ageError = payablesPosition.ageError;
  const ageingPending = payablesPosition.ageingPending;
  const ageingError = payablesPosition.ageingError;
  const projects = useProjects({ enabled: canView });
  const currencyState = useOrgCurrencyState();
  const orgCurrency = currencyState.isResolved ? currencyState.currency : null;
  const home = orgCurrency ?? 'IDR';
  const { exportXlsx, busy } = useExport();
  // R2: the search box is URL-owned (`?q=`) so Back/refresh (and a shared link) keep it.
  const { values, setFilter } = useUrlFilters(['q', 'overdue']);
  const search = values.q;
  const setSearch = (value: string) => setFilter('q', value);
  const overdueFilter = values.overdue === 'true';
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const projectManagers = useMemo(() => new Map((projects.data ?? []).map((project) => [project.id, project.pm?.full_name ?? ''])), [projects.data]);
  const query = search.trim().toLocaleLowerCase();
  const searchRows = useMemo(() => payablesPosition.payables.filter(({ procurement }) => {
    if (!query) return true;
    const manager = projectManagers.get(procurement.project_id ?? '') ?? '';
    return [procurement.vendor?.name, procurement.title, procurement.code, procurement.project?.name, procurement.project?.short_name, manager]
      .some((value) => value?.toLocaleLowerCase().includes(query));
  }), [payablesPosition.payables, projectManagers, query]);
  const lateRows = useMemo(
    () => searchRows
      .filter((row) => row.ageDays !== null && row.ageDays > 90)
      .sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0)),
    [searchRows],
  );
  const visibleRows = overdueFilter ? lateRows : searchRows;
  const tablePending = isPending || (overdueFilter && agePending);
  const tableError = isError || (overdueFilter && ageError);
  const overdueCountAvailable = !isPending && !isError && !agePending && !ageError;

  const columns = useMemo<Column<PayableRow>[]>(() => [
    {
      key: 'supplier',
      header: t('financeHub:hub.supplier', 'Supplier'),
      kind: 'primary',
      size: 160,
      rowHeader: true,
      cell: (row) => <span className="truncate font-semibold" title={row.procurement.vendor?.name ?? ''}>{row.procurement.vendor?.name ?? t('financeHub:hub.unknownSupplier', 'Supplier not recorded')}</span>,
      exportValue: (row) => row.procurement.vendor?.name ?? '',
    },
    {
      key: 'procurement',
      header: t('financeHub:hub.fix.payables.procurement', 'Procurement'),
      kind: 'text',
      size: 210,
      cell: (row) => <div className="min-w-0"><div className="min-w-0 whitespace-normal break-words font-medium" title={row.procurement.title}>{row.procurement.title}</div><div className="font-mono text-control text-muted-foreground">{row.procurement.code ?? row.procurement.id.slice(0, 8)}</div></div>,
      exportValue: (row) => `${row.procurement.title} · ${row.procurement.code ?? row.procurement.id.slice(0, 8)}`,
    },
    {
      key: 'project',
      header: t('financeHub:hub.project', 'Project'),
      kind: 'text',
      size: 210,
      cell: (row) => {
        const manager = projectManagers.get(row.procurement.project_id ?? '') ?? '';
        return <div className="flex min-w-0 items-center gap-2"><span className="min-w-0 whitespace-normal break-words text-muted-foreground">{row.procurement.project ? projectDisplayName(row.procurement.project) : '—'}</span>{manager && <span role="img" aria-label={manager} title={manager} className="grid size-[22px] shrink-0 place-items-center rounded-full bg-secondary text-support font-semibold text-secondary-foreground">{initials(manager, { fallback: '' })}</span>}</div>;
      },
      exportValue: (row) => row.procurement.project ? projectDisplayName(row.procurement.project) : '',
    },
    {
      key: 'age',
      header: t('financeHub:hub.invoiceAge', 'Invoice age'),
      kind: 'status',
      size: 130,
      cell: (row) => agePending
        ? <span aria-label={t('ui.listState.loading', 'Loading…')} className="text-muted-foreground">…</span>
        : ageError
          ? <span title={t('financeHub:hub.positionError', "Couldn't load balance ageings")} className="text-muted-foreground">—</span>
        : row.ageDays === null ? null : row.ageDays > 90
        ? <StatusPill variant="overdue" data-testid="payables-late-age" className={isMostUrgentLateRow(lateRows, row) ? 'font-semibold' : undefined}>{t('financeHub:hub.daysSinceInvoice', '{{count}} days', { count: row.ageDays })}</StatusPill>
        : <StatusPill variant={row.ageDays <= 30 ? 'neutral' : 'warn'}>{t('financeHub:hub.daysSinceInvoice', '{{count}} days', { count: row.ageDays })}</StatusPill>,
      exportValue: (row) => agePending || ageError || row.ageDays === null ? '' : `${row.ageDays} days`,
    },
    {
      key: 'amount',
      header: t('financeHub:hub.amount', 'Amount'),
      kind: 'money',
      align: 'num',
      size: 140,
      // Unknown is not zero and not a dash: the figure is left out and the table note says why, once.
      cell: (row) => row.amount === null ? null : formatTableMoney(row.amount / 100, row.procurement.currency),
      exportValue: (row) => (row.amount === null ? '' : row.amount / 100),
    },
  ], [ageError, agePending, lateRows, projectManagers, t]);

  const totalValues = useMemo(() => currencyTotals(visibleRows), [visibleRows]);
  const totals = (isPending || isError ? [] : Object.entries(totalValues)).map(([currency, amount]) => ({
    key: `total-${currency}`,
    label: t('financeHub:hub.totalCurrency', 'Total · {{currency}}', { currency }),
    values: { amount: formatTableMoney(amount / 100, currency) ?? '' },
  }));
  const oldest = payablesPosition.payables.find((row) => row.ageDays !== null);

  if (!canView) return <FinanceAccessDenied />;

  const knownSupplierIds = new Set(payablesPosition.payables.flatMap(({ procurement }) => procurement.vendor_id ? [procurement.vendor_id] : []));
  const supplierCount = knownSupplierIds.size;
  const unknownSupplierInvoices = payablesPosition.payables.filter(({ procurement }) => !procurement.vendor_id).length;
  const supplierCaption = unknownSupplierInvoices > 0
    ? [
      supplierCount > 0 ? t('financeHub:hub.fix.payables.supplierCount', { defaultValue_one: '{{count}} supplier', defaultValue_other: '{{count}} suppliers', count: supplierCount }) : null,
      t('financeHub:hub.fix.payables.unknownSupplierInvoices', { defaultValue_one: '{{count}} invoice, supplier not recorded', defaultValue_other: '{{count}} invoices, supplier not recorded', count: unknownSupplierInvoices }),
    ].filter(Boolean).join(' · ')
    : t('financeHub:hub.fix.payables.supplierCount', { defaultValue_one: '{{count}} supplier', defaultValue_other: '{{count}} suppliers', count: supplierCount });
  const noKnownTotal = Object.keys(payablesPosition.payablesTotals).length === 0;
  const toPay = noKnownTotal && payablesPosition.payables.length > 0 ? null : moneyTileProps(payablesPosition.payables.length === 0 ? { [home]: 0 } : payablesPosition.payablesTotals, home);

  return (
    <FigureScope>
    <ListPage
      title={t('financeHub:hub.payablesTitle', 'Payables')}
      help={<p>{t('financeHub:hub.payablesHelp', 'Invoice age is counted from the supplier invoice date.')}</p>}
      count={isPending || isError || (overdueFilter && (agePending || ageError)) ? undefined : visibleRows.length}
      total={isPending || isError ? undefined : payablesPosition.payables.length}
    >
      <div className="mb-3"><FigureHiddenLine /></div>
      <KPIRow aria-label={t('financeHub:hub.payablesFigures', 'Payables figures')} className="mb-5 grid-cols-2">
        <KPITile
          icon="grid" tone="blue" label={t('financeHub:hub.toPaySuppliers', 'To pay suppliers')}
          caption={isPending || isError ? undefined : supplierCaption}
          value={toPay?.value ?? null} exactValue={toPay?.exactValue} loading={isPending} error={isError}
          unavailableReason={toPay || isPending || isError ? undefined : t('financeHub:hub.fix.payables.unknownCount', { defaultValue: payablesPosition.payablesUnknownCount === 1 ? '{{count}} balance unknown' : '{{count}} balances unknown', count: payablesPosition.payablesUnknownCount })}
          help={t('financeHub:hub.payablesHint', 'Unpaid supplier invoice balances (invoice amount less payments made), grouped by currency. Unknown balances are counted, not added.')}
        />
        {(agePending || ageError || oldest) && <KPITile
          icon="grid" tone="amber" label={t('financeHub:hub.oldestInvoiceAge', 'Oldest invoice age')}
          value={agePending || ageError || oldest?.ageDays === null || !oldest ? null : t('financeHub:hub.daysSinceInvoice', '{{count}} days', { count: oldest.ageDays })} loading={agePending} error={ageError}
        />}
      </KPIRow>
      {ageingPending && <section aria-label={t('finance:area.payablesAgeingBasis', 'Invoice age, by days')} className="mb-5 min-w-0">
        <h2 className="mb-2 text-[14px] font-semibold">{t('financeHub:hub.invoiceAge', 'Invoice age')}</h2>
        <ListState variant="loading" shape="chart" rows={1} className="p-0" loadingLabel={t('ui.listState.loading', 'Loading…')} />
      </section>}
      {isError && <ListState
        variant="error"
        title={t('financeHub:hub.payablesLoadError', "Couldn't load supplier invoices")}
        onRetry={payablesPosition.retry}
        className="mb-5"
      />}
      {ageingError && !isError && !overdueFilter && <ListState
        variant="error"
        title={t('financeHub:hub.positionError', "Couldn't load balance ageings")}
        onRetry={payablesPosition.retryAge}
        className="mb-5"
      />}
      {!ageingPending && !ageingError && <AgeingStrip kind="payables" payablesStatusColors heading={t('financeHub:hub.invoiceAge', 'Invoice age')} ariaLabel={t('finance:area.payablesAgeingBasis', 'Invoice age, by days')} values={payablesPosition.payablesAgeing} unknownCounts={payablesPosition.payablesUnknownAgeing} />}
      <div className="min-w-0" data-testid="finance-payables-table-card">
      <Toolbar data-testid="finance-payables-table-toolbar" className="gap-2 sm:gap-3">
        <SearchMini aria-label={t('financeHub:hub.searchPayables', 'Search payables')} placeholder={t('financeHub:hub.searchPayables', 'Search payables')} value={search} onChange={(event) => setSearch(event.target.value)} searchSurface="finance-payables" module="finance" resultCount={visibleRows.length} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* The overdue filter is the outlined toggle Receivables uses for the same job, with its count
              in the label: the red pill read as a status label, not as the control that filters the list. */}
          {(overdueFilter || (overdueCountAvailable && lateRows.length > 0)) && <Button
            variant="outline"
            size="sm"
            data-testid="payables-overdue-toggle"
            aria-pressed={overdueFilter}
            className="aria-pressed:border-primary/40 aria-pressed:bg-primary/10 aria-pressed:text-primary"
            onClick={() => setFilter('overdue', overdueFilter ? '' : 'true')}
          >{t('uxs05.overdueOnly', 'Overdue only')}{overdueCountAvailable ? ` · ${lateRows.length}` : null}</Button>}
          <Button variant="outline" loading={busy} disabled={isPending || isError || agePending || ageError} onClick={() => void exportXlsx(visibleRows, columns, 'Payables')}>{t('financeHub:hub.export', 'Export')}</Button>
          {selectedKeys.size > 0 && <Button variant="outline" loading={busy} disabled={isPending || isError || agePending || ageError} onClick={() => void exportXlsx(payablesPosition.payables.filter((row) => selectedKeys.has(row.procurement.id)), columns, 'Payables')}>{t('financeHub:hub.exportSelected', 'Export selected')}</Button>}
        </div>
      </Toolbar>
      <DataTable
        rows={visibleRows}
        columns={columns}
        rowKey={(row) => row.procurement.id}
        rowLabel={(row) => t('financeHub:hub.openSupplierInvoice', 'Open supplier invoice for {{supplier}}', { supplier: row.procurement.vendor?.name ?? row.procurement.title })}
        onActivate={(row) => openProcurement(row.procurement.id)}
        selection={{ selectedIds: selectedKeys, onChange: setSelectedKeys }}
        rowMenu={(row) => [
          { label: t('financeHub:hub.openProcurement', 'Open procurement'), onClick: () => openProcurement(row.procurement.id) },
          ...(row.procurement.vendor_id ? [{ label: t('financeHub:hub.openSupplier', 'Open supplier'), onClick: () => navigate(`/companies/${row.procurement.vendor_id}`) }] : []),
        ]}
        totals={totals}
        state={tablePending ? 'loading' : tableError ? 'error' : visibleRows.length === 0 ? 'empty' : undefined}
        emptyTitle={overdueFilter ? t('financeHub:hub.noOverduePayablesMatch', 'No supplier invoices over 90 days match the current filters.') : search ? t('financeHub:hub.noPayablesMatch', 'No payables match this search.') : t('financeHub:hub.noPayables', 'No supplier invoices waiting to be paid.')}
        errorTitle={overdueFilter && ageError && !isError ? t('financeHub:hub.positionError', "Couldn't load balance ageings") : t('financeHub:hub.payablesLoadError', "Couldn't load supplier invoices")}
        onRetry={overdueFilter && ageError && !isError ? payablesPosition.retryAge : payablesPosition.retry}
        accessibleName={t('financeHub:hub.payablesTable', 'Supplier invoices waiting to be paid')}
        tableId="finance-payables-table"
        className="rounded-t-none border-t-0"
      />
      {!isPending && !isError && payablesPosition.payablesUnknownCount > 0 && <p className="mt-2 text-control text-muted-foreground">{t('financeHub:hub.fix.payables.unknownNote', { defaultValue: payablesPosition.payablesUnknownCount === 1 ? '{{count}} invoice has no amount and is left out of the total' : '{{count}} invoices have no amount and are left out of the total', count: payablesPosition.payablesUnknownCount })}</p>}
      </div>
    </ListPage>
    </FigureScope>
  );
};

export default PayablesPage;
