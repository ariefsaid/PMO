export type NeedsYouReason = 'approve' | 'pay' | 'receive';

export interface NeedsYouResult {
  reason: NeedsYouReason;
  since: Date;
}

type DateRow = { date?: string | null; created_at?: string | null; invoice_date?: string | null; amount?: number | string | null; erp_outstanding_amount?: number | string | null };

export interface NeedsYouRow {
  status: string;
  requested_by_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  project?: { project_manager_id?: string | null } | null;
  purchase_requests?: readonly DateRow[] | null;
  purchase_orders?: readonly DateRow[] | null;
  procurement_invoices?: readonly DateRow[] | null;
  payments?: readonly (DateRow & { status?: string })[] | null;
}

export interface NeedsYouViewer {
  role: string | null | undefined;
  userId: string | null | undefined;
}

function asDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function oldestDate(values: Array<string | null | undefined>): Date | null {
  const dates = values.map(asDate).filter((date): date is Date => date !== null);
  return dates.sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
}

function invoiceHasBalance(invoice: DateRow, payments: readonly (DateRow & { status?: string })[]): boolean {
  if (invoice.erp_outstanding_amount != null) return Number(invoice.erp_outstanding_amount) > 0;
  if (invoice.amount == null) return true;
  const linkedPayments = payments.filter((payment) => payment.status === 'Paid');
  const paid = linkedPayments.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);
  return Number(invoice.amount) - paid > 0;
}

/** FE queue ordering hints only; RLS and server transition rules remain authoritative. */
export function needsYou(row: NeedsYouRow, viewer: NeedsYouViewer): NeedsYouResult | null {
  const { role, userId } = viewer;
  const isProjectManager = row.project?.project_manager_id === userId;

  if (
    row.status === 'Requested'
    && userId !== row.requested_by_id
    && ['Admin', 'Executive', 'Project Manager', 'Finance'].includes(role ?? '')
    && (role !== 'Project Manager' || isProjectManager)
  ) {
    const since = oldestDate([
      ...(row.purchase_requests ?? []).map((request) => request.date ?? request.created_at),
      row.created_at,
    ]);
    return since ? { reason: 'approve', since } : null;
  }

  if (row.status === 'Vendor Invoiced' && ['Finance', 'Admin'].includes(role ?? '')) {
    const invoices = (row.procurement_invoices ?? [])
      .filter((invoice) => invoiceHasBalance(invoice, row.payments ?? []))
      .sort((a, b) => (a.invoice_date ?? a.created_at ?? '').localeCompare(b.invoice_date ?? b.created_at ?? ''));
    const since = asDate(invoices[0]?.invoice_date ?? invoices[0]?.created_at);
    return since ? { reason: 'pay', since } : null;
  }

  if (row.status === 'Ordered') {
    const mayReceive = role === 'Admin'
      || userId === row.requested_by_id
      || (role === 'Project Manager' && isProjectManager);
    if (!mayReceive) return null;
    const orderDates = (row.purchase_orders ?? []).map((order) => order.date ?? order.created_at);
    const since = oldestDate(orderDates.length > 0 ? orderDates : [row.created_at]);
    return since ? { reason: 'receive', since } : null;
  }

  return null;
}
