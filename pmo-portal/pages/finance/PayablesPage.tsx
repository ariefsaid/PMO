import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, ListPage, SearchMini, StatusPill, Toolbar, type Column } from '@/src/components/ui';
import { AgeingStrip } from '@/src/components/finance/AgeingStrip';
import { FinanceAccessDenied } from '@/src/components/finance/FinanceAccessDenied';
import { useFinanceAccess } from '@/src/components/finance/useFinanceAccess';
import { useExport } from '@/src/components/export/useExport';
import { useFinancePosition } from '@/src/hooks/useFinancePosition';
import { useProjects } from '@/src/hooks/useProjects';
import { useOrgCurrencyState } from '@/src/hooks/useOrgCurrency';
import type { FinancePosition } from '@/src/lib/finance/financePosition';
import { formatTableMoney } from '@/src/lib/format';
import { KPIRow, KPITile } from '@/src/components/ui/KPITile';
import { FigureHiddenLine, FigureScope } from '@/src/components/ui/FigureScope';
import { moneyTileProps } from '@/src/components/finance/moneyTile';
import { initials } from '@/src/lib/initials';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { usePayablesPosition } from '@/src/lib/finance/payablesPosition';

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
  const finance = useFinancePosition(canView);
  // L12: supplier invoices kept in the accounting system count here exactly as on the procurement record.
  const payablesPosition = usePayablesPosition(finance.position, canView);
  const isPending = finance.isPending || payablesPosition.isPending;
  const projects = useProjects({ enabled: canView });
  const currencyState = useOrgCurrencyState();
  const orgCurrency = currencyState.isResolved ? currencyState.currency : null;
  const home = orgCurrency ?? 'IDR';
  const { exportXlsx, busy } = useExport();
  const [search, setSearch] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const projectManagers = useMemo(() => new Map((projects.data ?? []).map((project) => [project.id, project.pm?.full_name ?? ''])), [projects.data]);
  const query = search.trim().toLocaleLowerCase();
  const filteredRows = useMemo(() => payablesPosition.payables.filter(({ procurement }) => {
    if (!query) return true;
    const manager = projectManagers.get(procurement.project_id ?? '') ?? '';
    return [procurement.vendor?.name, procurement.title, procurement.code, procurement.project?.name, procurement.project?.short_name, manager]
      .some((value) => value?.toLocaleLowerCase().includes(query));
  }), [payablesPosition.payables, projectManagers, query]);

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
      cell: (row) => row.ageDays === null ? null : <StatusPill variant={row.ageDays <= 30 ? 'neutral' : row.ageDays <= 90 ? 'warn' : 'lost'}>{t('financeHub:hub.daysSinceInvoice', '{{count}} days', { count: row.ageDays })}</StatusPill>,
      exportValue: (row) => row.ageDays === null ? '' : `${row.ageDays} days`,
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
  ], [projectManagers, t]);

  const totalValues = useMemo(() => currencyTotals(filteredRows), [filteredRows]);
  const totals = Object.entries(totalValues).map(([currency, amount]) => ({
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
  const toPay = noKnownTotal && payablesPosition.payables.length > 0 ? null : moneyTileProps(payablesPosition.payablesTotals, home);

  return (
    <FigureScope>
    <ListPage
      title={t('financeHub:hub.payablesTitle', 'Payables')}
      help={<p>{t('financeHub:hub.payablesHelp', 'Invoice age is counted from the supplier invoice date.')}</p>}
      count={filteredRows.length}
      total={payablesPosition.payables.length}
    >
      <div className="mb-3"><FigureHiddenLine /></div>
      <KPIRow aria-label={t('financeHub:hub.payablesFigures', 'Payables figures')} className="mb-5 grid-cols-2">
        <KPITile
          icon="grid" tone="blue" label={t('financeHub:hub.toPaySuppliers', 'To pay suppliers')}
          caption={supplierCaption}
          value={toPay?.value ?? null} exactValue={toPay?.exactValue} loading={isPending}
          unavailableReason={toPay || isPending ? undefined : t('financeHub:hub.fix.payables.unknownCount', { defaultValue: payablesPosition.payablesUnknownCount === 1 ? '{{count}} balance unknown' : '{{count}} balances unknown', count: payablesPosition.payablesUnknownCount })}
          help={t('financeHub:hub.payablesHint', 'Unpaid supplier invoice balances (invoice amount less payments made), grouped by currency. Unknown balances are counted, not added.')}
        />
        {(isPending || oldest) && <KPITile
          icon="grid" tone="amber" label={t('financeHub:hub.oldestInvoiceAge', 'Oldest invoice age')}
          value={oldest?.ageDays === null || !oldest ? null : t('financeHub:hub.daysSinceInvoice', '{{count}} days', { count: oldest.ageDays })} loading={isPending}
        />}
      </KPIRow>
      {!isPending && !finance.isError && <AgeingStrip kind="payables" values={payablesPosition.payablesAgeing} unknownCounts={payablesPosition.payablesUnknownAgeing} />}
      <div className="min-w-0" data-testid="finance-payables-table-card">
      <Toolbar data-testid="finance-payables-table-toolbar" className="gap-2 sm:gap-3">
        <SearchMini aria-label={t('financeHub:hub.searchPayables', 'Search payables')} placeholder={t('financeHub:hub.searchPayables', 'Search payables')} value={search} onChange={(event) => setSearch(event.target.value)} searchSurface="finance-payables" module="finance" resultCount={filteredRows.length} />
        <div className="ml-auto flex flex-wrap gap-2"><Button variant="outline" loading={busy} onClick={() => void exportXlsx(filteredRows, columns, 'Payables')}>{t('financeHub:hub.export', 'Export')}</Button>{selectedKeys.size > 0 && <Button variant="outline" loading={busy} onClick={() => void exportXlsx(payablesPosition.payables.filter((row) => selectedKeys.has(row.procurement.id)), columns, 'Payables')}>{t('financeHub:hub.exportSelected', 'Export selected')}</Button>}</div>
      </Toolbar>
      <DataTable
        rows={filteredRows}
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
        state={isPending ? 'loading' : finance.isError ? 'error' : filteredRows.length === 0 ? 'empty' : undefined}
        emptyTitle={search ? t('financeHub:hub.noPayablesMatch', 'No payables match this search.') : t('financeHub:hub.noPayables', 'No supplier invoices waiting to be paid.')}
        errorTitle={t('financeHub:hub.payablesLoadError', "Couldn't load supplier invoices")}
        onRetry={finance.retry}
        accessibleName={t('financeHub:hub.payablesTable', 'Supplier invoices waiting to be paid')}
        tableId="finance-payables-table"
        className="rounded-t-none border-t-0"
      />
      {!isPending && !finance.isError && payablesPosition.payablesUnknownCount > 0 && <p className="mt-2 text-control text-muted-foreground">{t('financeHub:hub.fix.payables.unknownNote', { defaultValue: payablesPosition.payablesUnknownCount === 1 ? '{{count}} invoice has no amount and is left out of the total' : '{{count}} invoices have no amount and are left out of the total', count: payablesPosition.payablesUnknownCount })}</p>}
      </div>
    </ListPage>
    </FigureScope>
  );
};

export default PayablesPage;
