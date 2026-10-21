import React from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, StatusPill, type Column, type StatusVariant } from '@/src/components/ui';
import { formatCurrency, formatDate } from '@/src/lib/format';
import { paymentState, type PaymentState } from '@/src/lib/erpPurchaseAging';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';

const PAYMENT_VARIANT: Record<PaymentState, StatusVariant> = {
  paid: 'won', 'partly-paid': 'progress', unpaid: 'open', overdue: 'overdue', return: 'neutral',
};

export interface ErpPurchasesTableProps {
  rows: ErpPurchaseRow[];
  today: string;
  tableId: string;
  /** Org-wide view: project column; ids not in the map read "No project". */
  projectNames?: ReadonlyMap<string, string>;
  /** Project view: mark invoices also attributed to other projects. */
  sharedMarker?: boolean;
}

/** FR-EPR-006/007 — read-only rows; nothing here opens, edits or adopts the ERP document (DD-XING-2). */
export const ErpPurchasesTable: React.FC<ErpPurchasesTableProps> = ({ rows, today, tableId, projectNames, sharedMarker }) => {
  const { t } = useTranslation('finance');
  const paymentLabel = (s: PaymentState) => ({
    paid: t('erpPurchases.status.paid', 'Paid'),
    'partly-paid': t('erpPurchases.status.partlyPaid', 'Partly paid'),
    unpaid: t('erpPurchases.status.unpaid', 'Unpaid'),
    overdue: t('erpPurchases.status.overdue', 'Overdue'),
    return: t('erpPurchases.status.return', 'Return'),
  })[s];
  const statusLabel = (r: ErpPurchaseRow) => {
    const s = paymentState(r, today);
    return s ? paymentLabel(s) : (r.erpStatus ?? '—');
  };
  const projectLabel = (r: ErpPurchaseRow) =>
    r.projectIds.map((id) => projectNames?.get(id)).filter(Boolean).join(', ') || t('erpPurchases.noProject', 'No project');

  const columns: Column<ErpPurchaseRow>[] = [
    {
      key: 'document',
      header: t('erpPurchases.column.document', 'Document'),
      kind: 'primary',
      primaryTitle: (r) => r.name,
      cell: (r) => <span className="font-mono">{r.name}</span>,
      secondaryCell: (r) => (
        <>
          {r.doctype === 'Purchase Order' ? t('erpPurchases.type.order', 'Purchase order') : t('erpPurchases.type.invoice', 'Supplier invoice')}
          {sharedMarker && r.projectIds.length > 1 && ` · ${t('erpPurchases.shared', 'Shared with other projects')}`}
        </>
      ),
      exportValue: (r) => r.name,
    },
    { key: 'supplier', header: t('erpPurchases.column.supplier', 'Supplier'), cell: (r) => r.supplier ?? '—', exportValue: (r) => r.supplier ?? '' },
    ...(projectNames ? [{
      key: 'project', header: t('erpPurchases.column.project', 'Project'),
      cell: (r: ErpPurchaseRow) => projectLabel(r), exportValue: (r: ErpPurchaseRow) => projectLabel(r),
    }] : []),
    { key: 'date', header: t('erpPurchases.column.date', 'Date'), kind: 'date', cell: (r) => formatDate(r.docDate), exportValue: (r) => r.docDate ?? '' },
    { key: 'billNo', header: t('erpPurchases.column.billNo', 'Supplier invoice no.'), kind: 'meta', cell: (r) => r.billNo ?? '—', exportValue: (r) => r.billNo ?? '' },
    {
      key: 'amount', header: t('erpPurchases.column.amount', 'Amount'), kind: 'money', align: 'num',
      cell: (r) => (r.grandTotal === null ? '—' : formatCurrency(r.grandTotal, r.currency ?? '')),
      exportValue: (r) => r.grandTotal ?? '',
    },
    {
      key: 'status', header: t('erpPurchases.column.status', 'Status'), kind: 'status',
      cell: (r) => {
        const s = paymentState(r, today);
        return s ? <StatusPill variant={PAYMENT_VARIANT[s]}>{paymentLabel(s)}</StatusPill> : <span>{r.erpStatus ?? '—'}</span>;
      },
      exportValue: statusLabel,
    },
  ];

  return (
    <DataTable<ErpPurchaseRow>
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      tableId={tableId}
      accessibleName={t('erpPurchases.title', 'Purchases recorded in ERPNext')}
    />
  );
};
