import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { repositories } from '@/src/lib/repositories';
import { formatCurrency, formatDateOnly } from '@/src/lib/format';
import type { InvoicePairProposal, UnpairedReason } from '@/src/lib/db/revenue';
import { Button, ConfirmDialog } from '@/src/components/ui';

/**
 * ECA-5 (#1602, AC-ECA-030): PMO invoices that are the same invoice the ERP already holds. One bulk accept makes
 * each sale count once, as the ERP copy; nothing is paired until a person confirms. Self-hiding: renders nothing for a
 * role that cannot pair, while the ERP does not own revenue, or when there is nothing to review.
 */
export function InvoicePairReview({ orgId }: { orgId?: string }) {
  const { t } = useTranslation('administration');
  const may = usePermission();
  const canPair = may('pair_invoices', 'salesInvoice');
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enabled = Boolean(orgId && canPair);
  const proposals = useQuery({
    queryKey: ['invoicePairs', 'propose', orgId],
    queryFn: () => repositories.revenue.proposeInvoicePairs(),
    enabled, retry: false,
  });
  const unpaired = useQuery({
    queryKey: ['invoicePairs', 'unpaired', orgId],
    queryFn: () => repositories.revenue.listUnpairedNativeInvoices(),
    enabled, retry: false,
  });
  const accepted = useQuery({
    queryKey: ['invoicePairs', 'accepted', orgId],
    queryFn: () => repositories.revenue.listAcceptedInvoicePairs(),
    enabled, retry: false,
  });

  if (!canPair) return null;
  const rows = proposals.data ?? [];
  const clear = rows.filter((r) => !r.ambiguous);
  const ambiguous = rows.filter((r) => r.ambiguous);
  const stillPmo = unpaired.data ?? [];
  const done = accepted.data ?? [];
  if (clear.length + ambiguous.length + stillPmo.length + done.length === 0 && !notice) return null;

  const money = (amount: number, currency: string) => formatCurrency(amount, currency);
  const reasonText: Record<UnpairedReason, string> = {
    'no-match': t('invoicePairs.reason.noMatch', 'No matching ERP invoice'),
    'ambiguous': t('invoicePairs.reason.ambiguous', 'More than one ERP invoice matches'),
    'has-receipt': t('invoicePairs.reason.hasReceipt', 'PMO already recorded a payment on this invoice'),
  };
  const countLabel = (n: number) => n === 1
    ? t('invoicePairs.countOne', '1 invoice')
    : t('invoicePairs.countOther', '{{count}} invoices', { count: n });

  const accept = async () => {
    setSaving(true);
    setError(null);
    try {
      const applied = await repositories.revenue.acceptInvoicePairs(
        clear.map((r) => ({ pmoInvoiceId: r.pmoInvoiceId, erpInvoiceId: r.erpInvoiceId })),
      );
      setNotice(applied === 1
        ? t('invoicePairs.doneOne', '1 invoice now counts once.')
        : t('invoicePairs.doneOther', '{{count}} invoices now count once.', { count: applied }));
    } catch {
      setError(t('invoicePairs.failed', 'No invoice was changed. The list may be out of date; it has been reloaded. Try again.'));
    } finally {
      setSaving(false);
      setConfirming(false);
      // Every figure that sums invoices moves when a pair is accepted.
      void qc.invalidateQueries({ queryKey: ['invoicePairs'] });
      void qc.invalidateQueries({ queryKey: ['salesInvoices'] });
      void qc.invalidateQueries({ queryKey: ['project-finances'] });
    }
  };

  const th = 'px-2 py-1.5 text-left text-xs font-medium text-muted-foreground';
  const td = 'px-2 py-1.5 align-top';
  return (
    <section id='invoice-pairs' className='mt-4 space-y-4 text-sm' aria-labelledby='invoice-pairs-title'>
      <div>
        <h3 id='invoice-pairs-title' className='font-medium'>
          {t('invoicePairs.title', 'Invoices on both sides')}
        </h3>
        <p className='mt-1 text-muted-foreground'>
          {t('invoicePairs.intro', 'Some invoices PMO raised are also in your ERP. Count each sale once, as the ERP copy. The PMO copy stays on record, linked to it, and stops adding to revenue and receivables.')}
        </p>
      </div>

      {notice && <p role='status' className='font-medium'>{notice}</p>}
      {error && <p role='alert' className='text-destructive'>{error}</p>}

      {clear.length > 0 && (
        <div>
          <table className='w-full border-collapse'>
            <thead>
              <tr>
                <th className={th}>{t('invoicePairs.col.pmo', 'PMO invoice')}</th>
                <th className={th}>{t('invoicePairs.col.erp', 'ERP invoice')}</th>
                <th className={th}>{t('invoicePairs.col.customer', 'Customer')}</th>
                <th className={`${th} text-right`}>{t('invoicePairs.col.amount', 'Amount')}</th>
              </tr>
            </thead>
            <tbody>
              {clear.map((r) => <PairRow key={`${r.pmoInvoiceId}:${r.erpInvoiceId}`} row={r} money={money} td={td} />)}
            </tbody>
          </table>
          <div className='mt-3'>
            <Button size='sm' onClick={() => setConfirming(true)}>
              {t('invoicePairs.acceptAll', 'Count each once')}
            </Button>
          </div>
        </div>
      )}

      {ambiguous.length > 0 && (
        <section aria-label={t('invoicePairs.needsDecision', 'Needs a decision')}>
          <h4 className='font-medium'>{t('invoicePairs.needsDecision', 'Needs a decision')}</h4>
          <p className='mt-1 text-muted-foreground'>
            {t('invoicePairs.needsDecisionHelp', 'These match more than one invoice. Open them in the ERP to tell them apart; PMO will not choose for you.')}
          </p>
          <ul className='mt-2 divide-y divide-border'>
            {ambiguous.map((r) => (
              <li key={`${r.pmoInvoiceId}:${r.erpInvoiceId}`} className='py-1.5'>
                {r.pmoNumber ?? '-'} → {r.erpNumber ?? '-'} · {money(r.amount, r.currency)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {stillPmo.length > 0 && (
        <section aria-label={t('invoicePairs.stillPmo', 'Still counted as PMO invoices')}>
          <h4 className='font-medium'>{t('invoicePairs.stillPmo', 'Still counted as PMO invoices')}</h4>
          <ul className='mt-2 divide-y divide-border'>
            {stillPmo.map((u) => (
              <li key={u.invoiceId} className='flex flex-wrap justify-between gap-2 py-1.5'>
                <span>{u.pmoNumber ?? '-'} · {u.customerName ?? '-'} · {u.invoiceDate ? formatDateOnly(u.invoiceDate) : '-'} · {money(u.amount, u.currency)}</span>
                <span className='text-muted-foreground'>{reasonText[u.reason]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {done.length > 0 && (
        <details>
          <summary className='cursor-pointer'>
            {done.length === 1
              ? t('invoicePairs.alreadyOne', '1 invoice already counts once')
              : t('invoicePairs.alreadyOther', '{{count}} invoices already count once', { count: done.length })}
          </summary>
          <ul className='mt-2 divide-y divide-border'>
            {done.map((d) => (
              <li key={d.pmoInvoiceId} className='py-1.5'>
                <span>{d.pmoNumber ?? '-'}</span>
                <span className='text-muted-foreground'> · {t('invoicePairs.countedAs', 'counted as ERP invoice {{number}}', { number: d.erpNumber ?? '-' })} · {money(d.amount, d.currency)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <ConfirmDialog
        open={confirming}
        title={t('invoicePairs.confirmTitle', 'Count these invoices once?')}
        description={t('invoicePairs.confirmBody', 'Count {{what}} once, as the ERP copy?', { what: countLabel(clear.length) })}
        confirmLabel={t('invoicePairs.confirmAction', 'Count once')}
        loading={saving}
        confirmDisabled={clear.length === 0}
        onConfirm={() => void accept()}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}

function PairRow({ row, money, td }: { row: InvoicePairProposal; money: (a: number, c: string) => string; td: string }) {
  return (
    <tr className='border-t border-border'>
      <td className={td}>{row.pmoNumber ?? '-'}</td>
      <td className={td}>{row.erpNumber ?? '-'}</td>
      <td className={td}>{row.customerName ?? '-'}</td>
      <td className={`${td} text-right tabular-nums`}>{money(row.amount, row.currency)}</td>
    </tr>
  );
}
