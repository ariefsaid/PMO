import React from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { DataTable, type Column } from '@/src/components/ui';
import type { FinancePosition } from '@/src/lib/finance/financePosition';
import { formatCurrencyCents, formatDateOnly } from '@/src/lib/format';
import { projectDisplayName } from '@/src/lib/projectDisplayName';

export interface PayablesListProps {
  position: FinancePosition;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  withLayout: (path: string) => string;
}

export const PayablesList: React.FC<PayablesListProps> = ({ position, isPending, isError, onRetry, withLayout }) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const columns: Column<FinancePosition['payables'][number]>[] = [
    {
      key: 'supplier',
      header: t('finance:area.supplier', 'Supplier'),
      cell: (row) => <span className="truncate" title={row.procurement.vendor?.name ?? ''}>{row.procurement.vendor?.name ?? '—'}</span>,
    },
    {
      key: 'procurement',
      header: t('finance:area.procurement', 'Procurement'),
      cell: (row) => (
        <div className="min-w-0">
          <div className="truncate font-medium" title={row.procurement.title}>{row.procurement.title}</div>
          <div className="font-mono text-xs text-muted-foreground">{row.procurement.code ?? row.procurement.id.slice(0, 8)}</div>
        </div>
      ),
    },
    {
      key: 'project',
      header: t('finance:area.project', 'Project'),
      cell: (row) => <span className="text-muted-foreground">{row.procurement.project ? projectDisplayName(row.procurement.project) : '—'}</span>,
    },
    {
      key: 'invoiced',
      header: t('finance:area.invoiced', 'Invoiced'),
      cell: (row) => {
        const invoiceDate = row.procurement.vendor_invoiced_at ?? row.procurement.updated_at;
        return <span className="text-muted-foreground">{formatDateOnly(invoiceDate)} · {t('finance:area.daysAgo', '{{count}} days ago', { count: row.ageDays })}</span>;
      },
    },
    {
      key: 'amount',
      header: t('finance:area.amount', 'Amount'),
      align: 'num',
      cell: (row) => <span>{formatCurrencyCents(row.amount / 100, row.procurement.currency)}</span>,
    },
  ];
  const state = isPending ? 'loading' : isError ? 'error' : position.payables.length === 0 ? 'empty' : undefined;

  return (
    <DataTable
      rows={position.payables}
      columns={columns}
      rowKey={(row) => row.procurement.id}
      rowLabel={(row) => t('finance:area.openSupplierInvoice', 'Open supplier invoice for {{supplier}}', { supplier: row.procurement.vendor?.name ?? row.procurement.title })}
      onActivate={(row) => navigate(withLayout(`/procurement/${row.procurement.id}`))}
      state={state}
      emptyTitle={t('finance:area.noSupplierInvoicesWaiting', 'No supplier invoices waiting to be paid.')}
      errorTitle={t('finance:area.payablesLoadError', "Couldn't load supplier invoices")}
      onRetry={onRetry}
      accessibleName={t('finance:area.payablesTable', 'Supplier invoices waiting to be paid')}
      tableId="finance-payables-table"
    />
  );
};
