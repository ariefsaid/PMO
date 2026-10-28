import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { AccessDenied, Button, DataTable, ListPage, SearchMini, StatusPill, Toolbar, Tooltip, type Column } from '@/src/components/ui';
import { AgeingStrip } from '@/src/components/finance/AgeingStrip';
import { useExport } from '@/src/components/export/useExport';
import { useFinancePosition } from '@/src/hooks/useFinancePosition';
import { useProjects } from '@/src/hooks/useProjects';
import { useOrgCurrencyState } from '@/src/hooks/useOrgCurrency';
import type { FinancePosition } from '@/src/lib/finance/financePosition';
import { formatCurrency, formatDateOnly } from '@/src/lib/format';
import { formatCurrencyWithCode } from '@/src/lib/finance/format';
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
  const currencyState = useOrgCurrencyState();
  const orgCurrency = currencyState.isResolved ? currencyState.currency : null;
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
      size: 160,
      rowHeader: true,
      cell: (row) => <span className="truncate font-semibold" title={row.procurement.vendor?.name ?? ''}>{row.procurement.vendor?.name ?? t('financeHub:hub.unknownSupplier', 'Unknown supplier')}</span>,
      exportValue: (row) => row.procurement.vendor?.name ?? '',
    },
    {
      key: 'procurement',
      header: t('financeHub:hub.fix.payables.procurement', 'Procurement'),
      kind: 'text',
      size: 210,
      cell: (row) => <div className="min-w-0"><div className="truncate font-medium" title={row.procurement.title}>{row.procurement.title}</div><div className="font-mono text-[11px] text-muted-foreground">{row.procurement.code ?? row.procurement.id.slice(0, 8)}</div></div>,
      exportValue: (row) => `${row.procurement.title} · ${row.procurement.code ?? row.procurement.id.slice(0, 8)}`,
    },
    {
      key: 'project',
      header: t('financeHub:hub.project', 'Project'),
      kind: 'text',
      size: 210,
      cell: (row) => {
        const manager = projectManagers.get(row.procurement.project_id ?? '') ?? '';
        return <div className="flex min-w-0 items-center gap-2"><span className="min-w-0 whitespace-normal break-words text-muted-foreground">{row.procurement.project ? projectDisplayName(row.procurement.project) : '—'}</span>{manager && <span role="img" aria-label={manager} title={manager} className="grid size-[22px] shrink-0 place-items-center rounded-full bg-[hsl(var(--avatar-2))] text-[9px] font-semibold text-white">{initials(manager)}</span>}</div>;
      },
      exportValue: (row) => row.procurement.project ? projectDisplayName(row.procurement.project) : '',
    },
    {
      key: 'recorded',
      header: t('financeHub:hub.invoiceRecorded', 'Invoice recorded'),
      kind: 'date',
      size: 130,
      cell: (row) => {
        const recordedAt = row.procurement.vendor_invoiced_at ?? row.procurement.updated_at;
        return <Tooltip content={row.procurement.vendor_invoiced_at ? t('financeHub:hub.fix.payables.vendorInvoiceDateHint', 'Supplier invoice date used to measure waiting time.') : t('financeHub:hub.fix.payables.updatedDateHint', 'Invoice date is missing; waiting time is measured from the last updated date.')}><span tabIndex={0} className="whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{formatDateOnly(recordedAt?.slice(0, 10))}</span></Tooltip>;
      },
      exportValue: (row) => (row.procurement.vendor_invoiced_at ?? row.procurement.updated_at)?.slice(0, 10) ?? '',
    },
    {
      key: 'waiting',
      header: t('financeHub:hub.waiting', 'Waiting'),
      kind: 'status',
      size: 105,
      cell: (row) => <StatusPill variant={row.ageDays <= 30 ? 'neutral' : row.ageDays <= 60 ? 'warn' : 'lost'}>{t('financeHub:hub.daysWaiting', '{{count}} days', { count: row.ageDays })}</StatusPill>,
      exportValue: (row) => `${row.ageDays} days`,
    },
    {
      key: 'amount',
      header: t('financeHub:hub.amount', 'Amount'),
      kind: 'money',
      align: 'num',
      size: 140,
      cell: (row) => formatCurrency(row.amount / 100, row.procurement.currency),
      exportValue: (row) => row.amount / 100,
    },
  ], [projectManagers, t]);

  const totalValues = useMemo(() => currencyTotals(filteredRows), [filteredRows]);
  const totals = Object.entries(totalValues).map(([currency, amount]) => ({
    key: `total-${currency}`,
    label: t('financeHub:hub.totalCurrency', 'Total · {{currency}}', { currency }),
    values: { amount: formatCurrency(amount / 100, currency) },
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
    >
      <section aria-label={t('financeHub:hub.payablesFigures', 'Payables figures')} className="mb-5 grid gap-3 sm:grid-cols-2">
        <article className="min-w-0 rounded-lg border border-border bg-card p-4">
          <div className="text-sm font-medium text-muted-foreground">{t('financeHub:hub.toPaySuppliers', 'To pay suppliers')}</div>
          {finance.isPending ? <div role="status" className="mt-2 h-7 w-36 animate-pulse rounded bg-muted" /> : (() => {
            const totals = Object.entries(finance.position.payablesTotals).sort(([left], [right]) => left === orgCurrency ? -1 : right === orgCurrency ? 1 : left.localeCompare(right));
            const [lead, ...others] = totals;
            return <>
              <div className="mt-1 text-[20px] font-bold tabular">{lead ? formatCurrency(lead[1] / 100, lead[0]) : t('financeHub:hub.fix.area.noBalance', 'No balance')}</div>
              {others.map(([currency, cents]) => <div key={currency} className="text-xs text-muted-foreground">{t('financeHub:hub.fix.currency.other', { defaultValue: '+ {{amount}} in other currencies', amount: formatCurrencyWithCode(cents / 100, currency) })}</div>)}
              {(() => {
                const count = new Set(finance.position.payables.map(({ procurement }) => procurement.vendor_id ?? procurement.id)).size;
                return <div className="mt-1 text-sm text-muted-foreground">{t('financeHub:hub.fix.payables.supplierCount', { defaultValue: count === 1 ? '{{count}} supplier' : '{{count}} suppliers', count })}</div>;
              })()}
            </>;
          })()}
          <Tooltip content={t('financeHub:hub.payablesHint', 'Sum of recorded supplier invoices waiting for payment, grouped by currency.')}><button type="button" aria-label={t('financeHub:hub.figureHelp', 'How this figure is calculated')} className="mt-1 inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">?</button></Tooltip>
        </article>
        <article className="min-w-0 rounded-lg border border-border bg-card p-4">
          <div className="text-sm font-medium text-muted-foreground">{t('financeHub:hub.oldestWaiting', 'Oldest waiting')}</div>
          {finance.isPending ? <div role="status" className="mt-2 h-7 w-24 animate-pulse rounded bg-muted" /> : <>
            <div className="mt-1 text-[20px] font-bold tabular">{oldest ? t('financeHub:hub.daysWaiting', '{{count}} days', { count: oldest.ageDays }) : '—'}</div>
            <div className="mt-1 text-sm text-muted-foreground">{t('financeHub:hub.fix.payables.oldestMeaning', 'Calendar days since the supplier invoice was recorded')}</div>
          </>}
          <Tooltip content={t('financeHub:hub.oldestPayableHint', 'Calendar days since the supplier invoice was recorded, using the oldest payable invoice.')}><button type="button" aria-label={t('financeHub:hub.figureHelp', 'How this figure is calculated')} className="mt-1 inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">?</button></Tooltip>
        </article>
      </section>
      {!finance.isPending && !finance.isError && <AgeingStrip kind="payables" values={finance.position.payablesAgeing} />}
      <div className="min-w-0" data-testid="finance-payables-table-card">
      <Toolbar data-testid="finance-payables-table-toolbar" className="gap-2 sm:gap-3">
        <SearchMini aria-label={t('financeHub:hub.searchPayables', 'Search payables')} placeholder={t('financeHub:hub.searchPayables', 'Search payables')} value={search} onChange={(event) => setSearch(event.target.value)} searchSurface="finance-payables" module="finance" resultCount={filteredRows.length} />
        <div className="ml-auto flex flex-wrap gap-2"><Button variant="outline" size="sm" loading={busy} onClick={() => void exportXlsx(filteredRows, columns, 'Payables')}>{t('financeHub:hub.export', 'Export')}</Button>{selectedKeys.size > 0 && <Button variant="outline" size="sm" loading={busy} onClick={() => void exportXlsx(finance.position.payables.filter((row) => selectedKeys.has(row.procurement.id)), columns, 'Payables')}>{t('financeHub:hub.exportSelected', 'Export selected')}</Button>}</div>
      </Toolbar>
      <DataTable
        rows={filteredRows}
        columns={columns}
        rowKey={(row) => row.procurement.id}
        rowLabel={(row) => t('financeHub:hub.openSupplierInvoice', 'Open supplier invoice for {{supplier}}', { supplier: row.procurement.vendor?.name ?? row.procurement.title })}
        onActivate={(row) => navigate(`/procurement/${row.procurement.id}`)}
        selection={{
          selectedIds: selectedKeys,
          onChange: setSelectedKeys,
          rowLabel: (row) => t('finance:table.selectRow', 'Select {{name}}', { name: row.procurement.vendor?.name ?? row.procurement.title }),
        }}
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
        className="rounded-t-none border-t-0"
      />
      </div>
    </ListPage>
  );
};

export default PayablesPage;
