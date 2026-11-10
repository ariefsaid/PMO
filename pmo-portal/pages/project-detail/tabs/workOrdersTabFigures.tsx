import React from 'react';
import { Tooltip } from '@/src/components/ui';
import type { TFunction } from 'i18next';
import type { WorkOrderRow, WorkOrderStatus } from '@/src/lib/db/workOrders';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import type { BoqItemRow } from '@/src/lib/db/progressBilling';
import type { AllocationFacts } from '@/src/lib/progressBilling';
import { summarizeInvoiceSettlement } from '@/src/lib/invoiceSettlement';

export type InvoiceWithWorkOrder = SalesInvoiceRow & { work_order_id?: string | null };

export interface OrderLineView {
  key: string;
  order: WorkOrderRow;
  item: BoqItemRow | null;
  allocation: AllocationFacts;
  rate: number | null;
}

/** A pending status move awaiting its confirm. */
export interface PendingTransition {
  row: WorkOrderRow;
  to: WorkOrderStatus;
}

// eslint-disable-next-line react-refresh/only-export-components -- shared figures/helpers used across the work-orders split.
export function invoiceBalanceFigures(invoice: InvoiceWithWorkOrder): { paid: number | null; unpaid: number | null } {
  if (invoice.status === 'Draft' || invoice.status === 'Cancelled') return { paid: null, unpaid: null };
  if (invoice.amount === null || invoice.erp_outstanding_amount === null) return { paid: null, unpaid: null };
  if (invoice.status === 'Paid') return { paid: invoice.amount, unpaid: 0 };
  const balance = summarizeInvoiceSettlement([invoice]);
  return { paid: balance.paid, unpaid: balance.unpaid };
}

// eslint-disable-next-line react-refresh/only-export-components -- shared figures/helpers used across the work-orders split.
export function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

// eslint-disable-next-line react-refresh/only-export-components -- shared figures/helpers used across the work-orders split.
export function treatmentLabel(treatment: string, t: TFunction): string {
  return treatment === 'inclusive'
    ? t('projectDetail.workOrders.tax.inclusive', 'incl. PPN')
    : t('projectDetail.workOrders.tax.exclusive', 'excl. PPN');
}

// eslint-disable-next-line react-refresh/only-export-components -- shared figures/helpers used across the work-orders split.
export function basisNote(row: WorkOrderRow, t: TFunction): string {
  const numerator = row.tax_base_numerator ?? 1;
  const denominator = row.tax_base_denominator ?? 1;
  if (row.tax_rate != null && numerator === denominator) return treatmentLabel(row.tax_treatment, t);
  return `${treatmentLabel(row.tax_treatment, t)}${row.tax_rate != null ? `\u00a0${row.tax_rate}%` : ` · ${t('tax.details.unknownRate', 'rate not recorded')}`} · DPP\u00a0${numerator}/${denominator}`;
}

export const MoneyFigure: React.FC<{ label: string; value: string; detail?: string; destructive?: boolean; testId?: string }> = ({ label, value, detail, destructive = false, testId }) => (
  <div className="min-w-20" data-testid={testId}>
    <dt className="text-xs text-muted-foreground"><Tooltip content={detail ?? 'Source: billing records for this customer order.'}><span className="cursor-help">{label}</span></Tooltip></dt>
    <dd className={`cursor-help text-lg font-semibold tabular-nums ${destructive ? 'text-destructive-text' : 'text-foreground'}`}><Tooltip content={detail ?? 'Source: billing records for this customer order.'}><span>{value}</span></Tooltip></dd>
  </div>
);

export const QuantityFigure: React.FC<{ label: string; value: string; detail?: string }> = ({ label, value, detail }) => (
  <div className="flex items-baseline justify-between gap-2">
    <dt><Tooltip content={detail ?? 'Source: project billing records.'}><span className="cursor-help">{label}</span></Tooltip></dt>
    <dd className="cursor-help tabular-nums text-foreground"><Tooltip content={detail ?? 'Source: project billing records.'}><span>{value}</span></Tooltip></dd>
  </div>
);
