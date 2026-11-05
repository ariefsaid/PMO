import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, CardPad, ListState } from '@/src/components/ui';
import { useVendorWithholdingRegister, useVendorWithholdingSlipMutations } from '@/src/hooks/useVendorWithholdingSlips';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';
import { VendorWithholdingSlipModal } from './VendorWithholdingSlipModal';

type Invoice = ProcurementDetail['invoices'][number];

export function VendorWithholdingSlipRecordForm({ invoice, vendorId, vendorName, onClose }: { invoice: Invoice; vendorId: string; vendorName?: string; onClose: () => void }) {
  const mutation = useVendorWithholdingSlipMutations();
  return <VendorWithholdingSlipModal invoice={invoice} vendorId={vendorId} vendorName={vendorName} open loading={mutation.record.isPending} onClose={onClose} onSave={(input) => mutation.record.mutateAsync(input)} />;
}

export function VendorWithholdingSlipHistory({ invoiceId, onClose, onView }: { invoiceId: string; onClose: () => void; onView: (id: string) => void }) {
  const { t } = useTranslation();
  const query = useVendorWithholdingRegister({ invoiceId });
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  React.useLayoutEffect(() => { headingRef.current?.focus(); headingRef.current?.scrollIntoView?.({ block: 'nearest' }); }, []);
  const close = onClose;
  return <Card className="mt-3"><CardHead level={2} aria-label={t('bupot.history', 'Bukti potong history')} ref={headingRef} tabIndex={-1} actions={<Button variant="outline" onClick={close}>{t('bupot.close', 'Close')}</Button>}>{t('bupot.history', 'Bukti potong history')}</CardHead><CardPad>
    {query.isLoading ? <ListState variant="loading" rows={2} /> : query.isError ? <ListState variant="error" title={t('bupot.loadError', 'Bukti potong unavailable')} onRetry={() => void query.refetch()} retryLabel={t('bupot.retry', 'Retry')} /> : (query.data?.pages ?? []).flatMap((page) => page.rows).length === 0 ? <ListState variant="empty" title={t('bupot.noBillHistory', 'No withholding slips recorded for this bill.')} /> : <ul>{(query.data?.pages ?? []).flatMap((page) => page.rows).map((slip) => <li key={slip.slip_id} className="flex justify-between gap-2 py-2"><span className="break-all">{slip.slip_number} · {slip.status}</span><Button variant="outline" onClick={() => onView(slip.slip_id)}>{t('bupot.view', 'View bukti potong')}</Button></li>)}</ul>}
    {query.hasNextPage && <Button variant="outline" onClick={() => void query.fetchNextPage()}>{t('bupot.loadMoreSlips', 'Load more history')}</Button>}
  </CardPad></Card>;
}
