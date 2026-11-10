import type { TFunction } from 'i18next';
import { invoiceReceiptAwaitingOdoo } from '@/src/lib/adapterSeam/odoo/revenue/status';
import { clientInvoiceOverdueDays } from '@/src/lib/repositories/revenueDisplay';
import { salesInvoiceStatusVariant } from '@/src/lib/status/statusVariants';
import { invoiceGross, isPartlyPaid } from '@/src/lib/revenue/nativeInvoice';
import type { IncomingPaymentRow, SalesInvoiceRow } from '@/src/lib/db/revenue';
import { odooOutcome as deriveOdooOutcome } from '@/src/lib/procurement/odooOutcome';

/** One shared Odoo command row (outbox) for the invoice status derivation. */
export interface OdooCommandRow {
  kind: string;
  recordId: string;
  state?: string | null;
  updatedAt?: string | null;
  lastError?: string | null;
}

/**
 * Whether THIS invoice has a receipt whose Odoo push is still pending (#1825 family). The receipt's
 * own Odoo reference appearing in the invoice read-back clears the flag; the wall-clock comparison
 * inside is only the fallback for commands without that evidence.
 */
export function createInvoiceReceiptGate(
  paymentRows: IncomingPaymentRow[],
  /** #2103: pre-built `invoice id → payments` index. When given, the per-row scan over every payment
   *  (and every allocation inside it) is skipped; the predicate itself is unchanged. */
  paymentsByInvoiceId?: ReadonlyMap<string, IncomingPaymentRow[]>,
) {
  return (inv: SalesInvoiceRow) => (paymentsByInvoiceId
    ? paymentsByInvoiceId.get(inv.id) ?? []
    : paymentRows.filter((payment) =>
      payment.sales_invoice_id === inv.id
      || Boolean(payment.allocation_details?.some((allocation) => allocation.invoice_id === inv.id)))
  ).some((payment) =>
    invoiceReceiptAwaitingOdoo({
      invoiceStatus: inv.status,
      invoiceErpModified: inv.erp_modified,
      receiptCommandState: payment.push_command_state,
      receiptCommandCreatedAt: payment.push_command_created_at,
      invoiceMatchedPaymentRefs: inv.odoo_matched_payment_refs,
      receiptCommandExternalRef: payment.push_command_external_record_id,
      receiptCommandRecordedReadBack: (payment.push_command_matched_payment_refs?.length ?? 0) > 0,
    }),
  );
}

export interface InvoiceStatusDeps {
  t: TFunction;
  canApproveDraft: (inv: SalesInvoiceRow) => boolean;
  receiptAwaitingOdooForInvoice: (inv: SalesInvoiceRow) => boolean;
  odoo: boolean;
  odooOffline: boolean;
  organizationToday: string | null;
  odooCommandsData: OdooCommandRow[] | undefined;
  /** #2103: pre-built `invoice id → Odoo command` index; when given, the per-row linear `find` over
   *  every command is skipped. Selection rule (first `sales-invoice` command wins) is unchanged. */
  commandForInvoice?: (invoiceId: string) => OdooCommandRow | undefined;
}

/** The receivables list's status derivation (label + pill variant + partly-settled + Odoo outcome). */
export function createInvoiceStatus(deps: InvoiceStatusDeps) {
  const { t, canApproveDraft, receiptAwaitingOdooForInvoice, odoo, odooOffline, organizationToday, odooCommandsData, commandForInvoice } = deps;
  return (inv: SalesInvoiceRow) => {
    const command = commandForInvoice
      ? commandForInvoice(inv.id)
      : (odooCommandsData ?? []).find((row) => row.kind === 'sales-invoice' && row.recordId === inv.id);
    const externalOutcome = odoo ? deriveOdooOutcome({
      erpState: inv.odoo_state,
      erpAttention: inv.odoo_attention,
      erpReadAt: inv.odoo_read_at,
      outboxState: command?.state,
      outboxUpdatedAt: command?.updatedAt,
      lastError: command?.lastError,
    }) : null;
    const result = <T extends { label: string; variant: ReturnType<typeof salesInvoiceStatusVariant>; partlySettled: boolean }>(row: T) => ({ ...row, odooOutcome: externalOutcome, odooOffline });
    const gross = invoiceGross(inv);
    const partlySettled = isPartlyPaid(inv) || (
      (inv.status === 'Submitted' || inv.status === 'Unpaid')
      && gross != null
      && inv.erp_outstanding_amount != null
      && inv.erp_outstanding_amount > 0
      && inv.erp_outstanding_amount < gross
    );
    const lateDays = clientInvoiceOverdueDays(inv, organizationToday) ?? 0;
    if (inv.status === 'Draft') return result({
      label: canApproveDraft(inv)
        ? t('finance:receivables.statusDraftApproval', 'Draft · to approve')
        : t('finance:receivables.statusDraftSecond', 'Draft · needs a second approver'),
      variant: salesInvoiceStatusVariant(inv.status),
      partlySettled,
    });
    if (inv.status === 'Cancelled') return result({ label: t('finance:receivables.statusCancelled', 'Cancelled'), variant: salesInvoiceStatusVariant(inv.status), partlySettled });
    if (inv.status === 'Paid') return result({ label: t('finance:receivables.statusPaid', 'Paid'), variant: salesInvoiceStatusVariant(inv.status), partlySettled });
    if (receiptAwaitingOdooForInvoice(inv)) return result({
      label: t('finance:receivables.statusReceiptAwaitingOdoo', 'Receipt sent, awaiting Odoo'),
      variant: 'progress' as const,
      partlySettled,
      receiptAwaitingOdoo: true,
    });
    if (partlySettled) return result({
      label: lateDays > 0
        ? lateDays === 1
          ? t('finance:receivables.statusPartlyPaidLateDay', 'Partly paid · {{count}} day late', { count: lateDays })
          : t('finance:receivables.statusPartlyPaidLateDays', 'Partly paid · {{count}} days late', { count: lateDays })
        : t('finance:receivables.statusPartlyPaid', 'Partly paid · not yet due'),
      variant: lateDays > 0 ? 'overdue' as const : salesInvoiceStatusVariant('Unpaid'),
      partlySettled,
    });
    if (lateDays > 0) return result({
      label: lateDays === 1
        ? t('finance:receivables.statusOverdueDay', 'Overdue · {{count}} day', { count: lateDays })
        : t('finance:receivables.statusOverdueDays', 'Overdue · {{count}} days', { count: lateDays }),
      variant: 'overdue' as const,
      partlySettled,
    });
    if (inv.status === 'Submitted') return result({ label: t('finance:receivables.statusSubmitted', 'Submitted'), variant: salesInvoiceStatusVariant(inv.status), partlySettled });
    return result({ label: t('finance:receivables.statusUnpaid', 'Unpaid · not yet due'), variant: salesInvoiceStatusVariant(inv.status), partlySettled });
  };
}
