import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrency, formatDay } from '@/src/lib/format';
import type { IncomingPaymentRow, SalesInvoiceRow } from '@/src/lib/db/revenue';
import type { ProfileRow } from '@/src/lib/db/profiles';

/** The receivables panel's status timeline: draft → approval → received → payments → paid. */
const InvoiceStatusTimeline: React.FC<{ invoice: SalesInvoiceRow; payments: IncomingPaymentRow[]; profiles: ProfileRow[] }> = ({ invoice, payments, profiles }) => {
  const { t } = useTranslation();
  const approver = invoice.approved_by_id ? profiles.find((profile) => profile.id === invoice.approved_by_id)?.full_name : null;
  const orderedPayments = [...payments]
    .filter((payment) => payment.status === 'Paid' && !payment.cancelled_at && !payment.erp_cancelled_at)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const draft = invoice.status === 'Draft';
  const received = Boolean(invoice.received_date) || invoice.status === 'Paid';
  const hasBalance = (invoice.erp_outstanding_amount ?? 0) > 0;
  const steps: { stage: string; state: 'done' | 'current' | 'future'; content: React.ReactNode }[] = [
    {
      stage: 'drafted', state: 'done',
      content: t('finance:receivables.drafted', 'Recorded {{date}}', { date: formatDay(invoice.created_at) }),
    },
    {
      stage: 'approved', state: draft ? 'current' : 'done',
      content: invoice.approved_at
        ? approver
          ? t('finance:receivables.approvedBySecond', 'Approved {{date}} by {{name}}, a second person', { date: formatDay(invoice.approved_at), name: approver })
          : t('finance:receivables.approvalRecorded', 'Approval recorded {{date}}', { date: formatDay(invoice.approved_at) })
        : draft
          ? t('finance:receivables.awaitingApproval', 'Awaiting approval')
          : t('finance:receivables.secondApprover', 'Second person approved'),
    },
    {
      stage: 'received', state: received ? 'done' : draft ? 'future' : 'current',
      content: invoice.received_date
        ? t('finance:receivables.receivedByClient', 'Delivered to client {{date}}', { date: formatDay(invoice.received_date) })
        : draft
          ? t('finance:receivables.sentToClient', 'Delivered to client')
          : t('finance:receivables.notReceivedByClient', 'Not delivered yet'),
    },
    ...orderedPayments.map((payment) => ({
      stage: 'payment', state: 'done' as const,
      content: <><span>{payment.date ? formatDay(payment.date) : t('finance:receivables.partPayments', 'Payment received')}</span><span className="tabular">{(() => {
        // #1415: a split PMO receipt shows what reached THIS invoice, not the whole receipt.
        const share = payment.pmo_native ? payment.allocations?.find((a) => a.sales_invoice_id === invoice.id) : undefined;
        if (share) return formatCurrency(share.cash_amount, payment.currency, { precision: 'minor' });
        return payment.received_amount != null ? formatCurrency(payment.received_amount, payment.currency, { precision: 'minor' }) : payment.amount != null ? formatCurrency(payment.amount, payment.currency, { precision: 'minor' }) : '—';
      })()}</span></>,
    })),
    {
      stage: 'paid',
      state: invoice.status === 'Paid' ? 'done' : received && hasBalance && invoice.status !== 'Cancelled' ? 'current' : 'future',
      content: invoice.status === 'Paid'
        ? t('finance:receivables.statusPaid', 'Paid')
        : t('finance:receivables.awaitingPayment', 'Awaiting full payment'),
    },
  ];
  return (
    <section aria-labelledby="receivable-invoice-timeline">
      <h2 id="receivable-invoice-timeline" className="mb-2 text-sm font-semibold">{t('finance:receivables.timeline', 'Status timeline')}</h2>
      <ol className="relative space-y-3 pl-7 text-sm before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-px before:bg-border">
        {steps.map((step, index) => <li key={`${step.stage}-${index}`} data-stage={step.stage} data-state={step.state} className="relative flex min-h-4 items-start justify-between gap-3">
          <span
            aria-hidden="true"
            className={`absolute -left-7 top-0.5 size-4 rounded-full border-2 ${step.state === 'done' ? 'border-[hsl(var(--success))] bg-[hsl(var(--success))]' : step.state === 'current' ? 'border-[hsl(var(--warning))] bg-[hsl(var(--warning))]' : 'border-muted-foreground bg-card'}`}
          />
          {step.content}
        </li>)}
      </ol>
    </section>
  );
};

export default InvoiceStatusTimeline;
