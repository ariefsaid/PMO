import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, ConfirmDialog, ListState, useToast } from '@/src/components/ui';
import { useRevenueMutations } from '@/src/hooks/useRevenue';
import { useInvoicesAwaitingViewer } from '@/src/hooks/useInvoicesAwaitingViewer';
import { useCommandIntentMap } from '@/src/hooks/useCommandIntent';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { nativeRevenueHeadlines } from '@/src/lib/revenue/nativeRevenueErrors';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import { SalesInvoiceApprovalRow } from './SalesInvoiceApprovalRow';

/**
 * "Customer invoices awaiting you" on /approvals (#784 FR-NAR-006, DD-NAR-12): PMO drafts the viewer may approve — never
 * their own, by the same can() predicate as the Sales Invoices menu (the RPC is the authority). Each row opens the whole
 * invoice before Approve (I-1); Approve stays behind a confirm. Hidden when none, when the viewer cannot approve, or once
 * an ERP owns revenue; a failed read says so rather than showing a false "nothing".
 */
export const SalesInvoiceApprovalSection: React.FC = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { rows, isPending, isError, refetch } = useInvoicesAwaitingViewer();
  const { submitInvoice } = useRevenueMutations();
  const intents = useCommandIntentMap();
  const [target, setTarget] = useState<SalesInvoiceRow | null>(null);

  if (isPending) return <div className="mb-4"><ListState variant="loading" rows={3} /></div>;
  if (isError) {
    return (
      <div className="mb-4">
        <ListState variant="error" title={t('approvals.salesInvoices.errorTitle', "Couldn't load invoices awaiting you")}
          sub={t('approvals.salesInvoices.errorSub', 'Purchase requests and timesheets below are unaffected.')} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (rows.length === 0) return null;

  const onConfirm = async () => {
    if (!target) return;
    const key = `approve:${target.id}`;
    try {
      await submitInvoice.mutateAsync({ siId: target.id, intent: intents.intentFor(key) });
      intents.release(key);
      toast(t('financeCopy.invoiceApproved', 'Invoice approved'), target.customer_name ?? target.id, 'success');
      setTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err, nativeRevenueHeadlines(t));
      toast(headline, detail, 'warning');
    }
  };

  return (
    <section aria-label={t('approvals.salesInvoices.label', 'Customer invoices awaiting you')} className="mb-4">
      {/* M-8: the same overline heading as the other sections above the queue. */}
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {t('approvals.salesInvoices.heading', 'Customer invoices awaiting you ({{count}})', { count: rows.length })}
      </h2>
      <Card>
        <ul className="divide-y divide-border">
          {rows.map((inv) => (
            <li key={inv.id}>
              <SalesInvoiceApprovalRow inv={inv} onApprove={setTarget} />
            </li>
          ))}
        </ul>
      </Card>
      <ConfirmDialog
        open={!!target}
        title={t('financeCopy.approveInvoiceNamed', 'Approve the invoice for {{customer}}?', { customer: target?.customer_name ?? '' })}
        description={t('financeCopy.approveInvoiceBody', 'Approving issues the invoice: it gets its number, becomes Unpaid and can receive payments. Its author cannot approve it.')}
        confirmLabel={t('financeCopy.approveInvoice', 'Approve invoice')}
        loading={submitInvoice.isPending}
        onConfirm={onConfirm}
        onCancel={() => setTarget(null)}
      />
    </section>
  );
};
