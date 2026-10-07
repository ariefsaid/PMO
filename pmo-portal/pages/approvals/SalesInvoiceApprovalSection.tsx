import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, ConfirmDialog, ListState, TaxBasisLabel, useToast } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useRevenueMode } from '@/src/hooks/useRevenueMode';
import { useNativeDraftInvoices, useRevenueMutations } from '@/src/hooks/useRevenue';
import { useCommandIntentMap } from '@/src/hooks/useCommandIntent';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatCurrencyCents } from '@/src/lib/format';
import { nativeInvoiceSummary } from '@/src/lib/revenue/nativeInvoice';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

/**
 * "Customer invoices awaiting you" on /approvals (#784 FR-NAR-006, DD-NAR-12): PMO drafts the viewer may approve — never
 * their own, by the same can() predicate as the Sales Invoices menu (the RPC is the authority). Hidden when none, when
 * the viewer cannot approve, or once an ERP owns revenue; a failed read says so rather than showing a false "nothing".
 */
export const SalesInvoiceApprovalSection: React.FC = () => {
  const { t } = useTranslation();
  const may = usePermission();
  const { toast } = useToast();
  const userId = useAuth().currentUser?.id;
  const native = useRevenueMode() === 'native';
  const canApprove = may('create', 'salesInvoice');
  const { data, isPending, isError, refetch } = useNativeDraftInvoices(canApprove && native);
  const { submitInvoice } = useRevenueMutations();
  const intents = useCommandIntentMap();
  const [target, setTarget] = useState<SalesInvoiceRow | null>(null);

  const rows = useMemo(
    () => (data ?? []).filter((inv) =>
      may('submit_sales_invoice', 'salesInvoice', {
        currentUserId: userId,
        record: { author_id: inv.author_user_id, author_ids: inv.author_user_ids },
      })),
    [data, may, userId],
  );

  if (!canApprove || !native || isPending) return null;
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
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  return (
    <section aria-label={t('approvals.salesInvoices.label', 'Customer invoices awaiting you')} className="mb-4">
      <Card seam>
        <CardHead className="rounded-t-lg">{t('approvals.salesInvoices.heading', 'Customer invoices awaiting you ({{count}})', { count: rows.length })}</CardHead>
        <ul className="divide-y divide-border rounded-b-lg border-t border-border">
          {rows.map((inv) => (
            <li key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className="font-medium">{inv.customer_name ?? '—'}</span>
              <span className="min-w-0 truncate text-muted-foreground">{nativeInvoiceSummary(inv) ?? '—'}</span>
              <span className="ml-auto inline-flex items-baseline gap-1.5">
                <span className="tabular-nums">{inv.amount != null ? formatCurrencyCents(inv.amount, inv.currency) : '—'}</span>
                <TaxBasisLabel treatment={inv.tax_treatment} taxRate={inv.tax_rate} taxBaseNumerator={inv.tax_base_numerator} taxBaseDenominator={inv.tax_base_denominator} />
              </span>
              <Button variant="outline" size="sm" onClick={() => setTarget(inv)}>{t('financeCopy.approve', 'Approve')}</Button>
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
