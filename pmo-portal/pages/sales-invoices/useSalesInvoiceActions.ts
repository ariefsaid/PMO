import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/src/components/ui';
import { useCommandIntentMap } from '@/src/hooks/useCommandIntent';
import { useRevenueMutations } from '@/src/hooks/useRevenue';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { nativeRevenueHeadlines } from '@/src/lib/revenue/nativeRevenueErrors';
import { invoiceNumber } from '@/src/lib/revenue/nativeInvoice';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

export function useSalesInvoiceActions() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const mutations = useRevenueMutations();
  const { submitInvoice, cancelInvoice } = mutations;
  const [cancelTarget, setCancelTarget] = useState<SalesInvoiceRow | null>(null);
  const [submitTarget, setSubmitTarget] = useState<SalesInvoiceRow | null>(null);
  const [receiptTarget, setReceiptTarget] = useState<SalesInvoiceRow | null>(null);
  const [efakturTarget, setEfakturTarget] = useState<SalesInvoiceRow | null>(null);
  const [projectTarget, setProjectTarget] = useState<SalesInvoiceRow | null>(null);

  // BLOCK 2 (ADR-0058): the confirm dialogs are ALWAYS mounted, so their command identity cannot be
  // a plain ref — it must be per (record, verb) or a retry on invoice B would carry invoice A's key.
  // Released only after a terminal success (never on error — reusing the key on retry IS the fix).
  const verbIntents = useCommandIntentMap();
  const onCancelConfirm = async () => {
    if (!cancelTarget) return;
    const key = `cancel:${cancelTarget.id}`;
    try {
      await cancelInvoice.mutateAsync({ siId: cancelTarget.id, intent: verbIntents.intentFor(key) });
      verbIntents.release(key);
      toast(t('financeCopy.invoiceCancelled', 'Invoice cancelled'), invoiceNumber(cancelTarget) ?? cancelTarget.customer_name ?? cancelTarget.id, 'success');
      setCancelTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err, nativeRevenueHeadlines(t));
      toast(headline, detail, 'warning');
    }
  };

  async function onSubmitConfirm() {
    if (!submitTarget) return;
    const key = `submit:${submitTarget.id}`;
    try {
      await submitInvoice.mutateAsync({ siId: submitTarget.id, intent: verbIntents.intentFor(key) });
      verbIntents.release(key);
      toast(
        submitTarget.pmo_native ? t('financeCopy.invoiceApproved', 'Invoice approved') : t('financeCopy.invoiceSubmitted', 'Invoice submitted'),
        invoiceNumber(submitTarget) ?? submitTarget.customer_name ?? submitTarget.id,
        'success',
      );
      setSubmitTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err, nativeRevenueHeadlines(t));
      toast(headline, detail, 'warning');
    }
  }

  return { ...mutations, cancelTarget, setCancelTarget, submitTarget, setSubmitTarget, receiptTarget, setReceiptTarget, efakturTarget, setEfakturTarget, projectTarget, setProjectTarget, onCancelConfirm, onSubmitConfirm };
}
