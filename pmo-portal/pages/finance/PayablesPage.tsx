import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { AccessDenied, Button, DataTable, ListPage, SearchMini, StatusPill, Tooltip, type Column } from '@/src/components/ui';
import { AgeingStrip } from '@/src/components/finance/AgeingStrip';
import { useExport } from '@/src/components/export/useExport';
import { useFinancePosition } from '@/src/hooks/useFinancePosition';
import { useProjects } from '@/src/hooks/useProjects';
import type { FinancePosition } from '@/src/lib/finance/financePosition';
import { formatCurrencyCents, formatDateOnly } from '@/src/lib/format';
import { projectDisplayName } from '@/src/lib/projectDisplayName';

type PayableRow = FinancePosition['payables'][number];

function initials(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
}

function currencyTotals(rows: PayableRow[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((totals, row) => {
    const currency = row.procurement.currency;
    totals[currency] = (totals[currency] ?? 0) + row.amount;
    return totals;
  }, {});
}

const PayablesPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const may = usePermission();
  const canView = may('view', 'finance');
  const finance = useFinancePosition(canView);
  const projects = useProjects({ enabled: canView });
  const { exportXlsx, busy } = useExport();
  const [search, setSearch] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const projectManagers = useMemo(() => new Map((projects.data ?? []).map((project) => [project.id, project.pm?.full_name ?? ''])), [projects.data]);
  const query = search.trim().toLocaleLowerCase();
  const filteredRows = useMemo(() => finance.position.payables.filter(({ procurement }) => {
    if (!query) return true;
    const manager = projectManagers.get(procurement.project_id ?? '') ?? '';
    return [procurement.vendor?.name, procurement.title, procurement.code, procurement.project?.name, procurement.project?.short_name, manager]
      .some((value) => value?.toLocaleLowerCase().includes(query));
  }), [finance.position.payables, projectManagers, query]);

  const columns = useMemo<Column<PayableRow>[]>(() => [
    {
      key: 'supplier',
      header: t('financeHub:hub.supplier', 'Supplier'),
      kind: 'primary',
      rowHeader: true,
      cell: (row) => <span className="truncate font-semibold" title={row.procurement.vendor?.name ?? ''}>{row.procurement.vendor?.name ?? t('financeHub:hub.unknownSupplier', 'Unknown supplier')}</span>,
      exportValue: (row) => row.procurement.vendor?.name ?? '',
    },
    {
      key: 'procurement',
      header: t('financeHub:hub.procurementTitleCode', 'Procurement title + code'),
      kind: 'text',
      cell: (row) => <div className="min-w-0"><div className="truncate font-medium" title={row.procurement.title}>{row.procurement.title}</div><div className="font-mono text-[11px] text-muted-foreground">{row.procurement.code ?? row.procurement.id.slice(0, 8)}</div></div>,
      exportValue: (row) => `${row.procurement.title} · ${row.procurement.code ?? row.procurement.id.slice(0, 8)}`,
    },
    {
      key: 'project',
      header: t('financeHub:hub.project', 'Project'),
      kind: 'text',
      cell: (row) => {
        const manager = projectManagers.get(row.procurement.project_id ?? '') ?? '';
        return <div className="flex min-w-0 items-center gap-2"><span className="truncate text-muted-foreground">{row.procurement.project ? projectDisplayName(row.procurement.project) : '—'}</span>{manager && <span role="img" aria-label={manager} title={manager} className="grid size-[22px] shrink-0 place-items-center rounded-full bg-[hsl(var(--avatar-2))] text-[9px] font-semibold text-white">{initials(manager)}</span>}</div>;
      },
      exportValue: (row) => row.procurement.project ? projectDisplayName(row.procurement.project) : '',
    },
    {
      key: 'recorded',
      header: t('financeHub:hub.invoiceRecorded', 'Invoice recorded'),
      kind: 'date',
      cell: (row) => formatDateOnly(row.procurement.vendor_invoiced_at ?? row.procurement.updated_at),
      exportValue: (row) => (row.procurement.vendor_invoiced_at ?? row.procurement.updated_at)?.slice(0, 10) ?? '',
    },
    {
      key: 'waiting',
      header: t('financeHub:hub.waiting', 'Waiting'),
      kind: 'status',
      cell: (row) => <StatusPill variant={row.ageDays <= 30 ? 'neutral' : row.ageDays <= 60 ? 'warn' : 'lost'}>{t('financeHub:hub.daysWaiting', '{{count}} days', { count: row.ageDays })}</StatusPill>,
      exportValue: (row) => `${row.ageDays} days`,
    },
    {
      key: 'amount',
      header: t('financeHub:hub.amount', 'Amount'),
      kind: 'money',
      align: 'num',
      cell: (row) => formatCurrencyCents(row.amount / 100, row.procurement.currency),
      exportValue: (row) => row.amount / 100,
    },
  ], [projectManagers, t]);

  const totalValues = useMemo(() => currencyTotals(filteredRows), [filteredRows]);
  const totals = Object.entries(totalValues).map(([currency, amount]) => ({
    key: `total-${currency}`,
    label: t('financeHub:hub.totalCurrency', 'Total · {{currency}}', { currency }),
    values: { amount: formatCurrencyCents(amount / 100, currency) },
  }));
  const oldest = finance.position.payables[0];

  if (!canView) {
    return <AccessDenied title={t('financeHub:hub.noAccessTitle', 'Finance')} sub={t('financeHub:hub.noAccessDescription', 'Finance is available to Finance, Executive and Admin roles.')} onBack={() => navigate('/')} />;
  }

  return (
    <ListPage
      title={t('financeHub:hub.payablesTitle', 'Payables')}
      description={t('financeHub:hub.payablesDescription', 'Supplier invoices waiting to be paid.')}
      count={finance.position.payables.length}
      search={<SearchMini aria-label={t('financeHub:hub.searchPayables', 'Search payables')} placeholder={t('financeHub:hub.searchPayables', 'Search payables')} value={search} onChange={(event) => setSearch(event.target.value)} searchSurface="finance-payables" module="finance" resultCount={filteredRows.length} />}
      exportAction={<div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" loading={busy} onClick={() => void exportXlsx(filteredRows, columns, 'Payables')}>{t('financeHub:hub.export', 'Export')}</Button>{selectedKeys.size > 0 && <Button variant="outline" size="sm" loading={busy} onClick={() => void exportXlsx(finance.position.payables.filter((row) => selectedKeys.has(row.procurement.id)), columns, 'Payables')}>{t('financeHub:hub.exportSelected', 'Export selected')}</Button>}</div>}
    >
      <section aria-label={t('financeHub:hub.payablesFigures', 'Payables figures')} className="mb-5 grid gap-4 rounded-lg border border-border bg-card px-4 py-3 sm:grid-cols-2">
        <div>
          <div className="text-xs text-muted-foreground">{t('financeHub:hub.toPaySuppliers', 'To pay suppliers')}</div>
          <div className="flex flex-wrap items-center gap-1.5 text-lg font-semibold tabular">{Object.entries(finance.position.payablesTotals).map(([currency, cents]) => <span key={currency}>{formatCurrencyCents(cents / 100, currency)}</span>)}</div>
          <Tooltip content={t('financeHub:hub.payablesHint', 'Sum of recorded supplier invoices waiting for payment, grouped by currency.')}><button type="button" aria-label={t('financeHub:hub.figureHelp', 'How this figure is calculated')} className="min-h-6 text-xs text-muted-foreground underline underline-offset-2">{t('financeHub:hub.calculation', 'How it is calculated')}</button></Tooltip>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{t('financeHub:hub.oldestWaiting', 'Oldest waiting')}</div>
          <div className="flex items-center gap-1.5 text-lg font-semibold tabular">{oldest ? t('financeHub:hub.daysWaiting', '{{count}} days', { count: oldest.ageDays }) : '—'}{oldest && <Tooltip content={t('financeHub:hub.oldestPayableHint', 'Calendar days since the supplier invoice was recorded, using the oldest payable invoice.')}><button type="button" aria-label={t('financeHub:hub.figureHelp', 'How this figure is calculated')} className="min-h-6 text-xs text-muted-foreground underline underline-offset-2">{t('financeHub:hub.calculation', 'How it is calculated')}</button></Tooltip>}</div>
        </div>
      </section>
      <AgeingStrip kind="payables" values={finance.position.payablesAgeing} />
      <DataTable
        rows={filteredRows}
        columns={columns}
        rowKey={(row) => row.procurement.id}
        rowLabel={(row) => t('financeHub:hub.openSupplierInvoice', 'Open supplier invoice for {{supplier}}', { supplier: row.procurement.vendor?.name ?? row.procurement.title })}
        onActivate={(row) => navigate(`/procurement/${row.procurement.id}`)}
        selectable
        selectedKeys={selectedKeys}
        onSelectionChange={setSelectedKeys}
        rowMenu={(row) => [
          { label: t('financeHub:hub.openProcurement', 'Open procurement'), onClick: () => navigate(`/procurement/${row.procurement.id}`) },
          ...(row.procurement.vendor_id ? [{ label: t('financeHub:hub.openSupplier', 'Open supplier'), onClick: () => navigate(`/companies/${row.procurement.vendor_id}`) }] : []),
        ]}
        totals={totals}
        state={finance.isPending ? 'loading' : finance.isError ? 'error' : filteredRows.length === 0 ? 'empty' : undefined}
        emptyTitle={search ? t('financeHub:hub.noPayablesMatch', 'No payables match this search.') : t('financeHub:hub.noPayables', 'No supplier invoices waiting to be paid.')}
        errorTitle={t('financeHub:hub.payablesLoadError', "Couldn't load supplier invoices")}
        onRetry={finance.retry}
        accessibleName={t('financeHub:hub.payablesTable', 'Supplier invoices waiting to be paid')}
        tableId="finance-payables-table"
      />
    </ListPage>
  );
};

export default PayablesPage;
