import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui';
import { useOrderReceiving, useOrderReceivingEnabled } from '@/src/hooks/useOrderReceiving';
import { formatQuantity } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';

/** The order's stock receipt position; the server returns quantity facts only for purchasing users. */
export function OrderReceivingProgress({ orderId }: { orderId: string | undefined }) {
  const { t } = useTranslation('stock');
  const flag = useOrderReceivingEnabled();
  const order = useOrderReceiving(flag.data && orderId ? orderId : '');
  if (!orderId || flag.isPending || flag.data === false) return null;
  if (flag.isError || order.isError) return <div role="alert"><p>{t('receiving.loadError')}</p><Button variant="outline" onClick={() => { void flag.refetch(); void order.refetch(); }}>{t('receiving.retry')}</Button></div>;
  if (!order.data?.purchaser) return null;
  const q = (value: string | undefined) => value === undefined ? '—' : formatQuantity(value, getNumberLocale());
  return <section className="space-y-3 border-t border-border pt-4" aria-label={t('receiving.progressTitle')}>
    <h2 className="text-base font-semibold">{t('receiving.progressTitle')}</h2>
    <ul className="space-y-3">{order.data.lines.map((line) => <li key={line.id} className="text-control">
      <p className="font-medium">{line.name}</p>
      <p>{t('receiving.progress', { ordered: q(line.ordered), received: q(line.received), outstanding: q(line.outstanding) })}</p>
      <p className="text-muted-foreground">{t(`receiving.${line.status}`)}</p>
    </li>)}</ul>
    <Link className="inline-flex min-h-11 items-center text-control text-primary underline" to={`/stock/new/receive?order=${orderId}`}>{t('receiving.openReceiving')}</Link>
  </section>;
}
