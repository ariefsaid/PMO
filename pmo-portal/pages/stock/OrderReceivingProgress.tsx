import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, StatusPill, type Column } from '@/src/components/ui';
import type { ReceivingLine } from '@/src/lib/db/orderReceiving';
import { RECEIVING_VARIANT } from './OrderReceivingLines';
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
  const loc = getNumberLocale();
  const figure = (value: string | undefined, line: ReceivingLine) => <span className="tabular-nums whitespace-nowrap">{value === undefined ? '—' : formatQuantity(value, loc)}{line.unit && <span className="text-muted-foreground"> {line.unit}</span>}</span>;
  const columns: Column<ReceivingLine>[] = [
    { key: 'line', header: t('receiving.line'), kind: 'primary', rowHeader: true, cell: (line) => line.name },
    { key: 'ordered', header: t('receiving.ordered'), align: 'num', cell: (line) => figure(line.ordered, line) },
    { key: 'received', header: t('receiving.received'), align: 'num', cell: (line) => figure(line.received, line) },
    { key: 'outstanding', header: t('receiving.outstanding'), align: 'num', cell: (line) => figure(line.outstanding, line) },
    { key: 'status', header: t('receiving.status'), kind: 'status', cell: (line) => line.status ? <StatusPill variant={RECEIVING_VARIANT[line.status]}>{t(`receiving.${line.status}`)}</StatusPill> : null },
  ];
  return <section className="space-y-3 border-t border-border pt-4" aria-label={t('receiving.progressTitle')}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold">{t('receiving.progressTitle')}</h2>
      <Link className="inline-flex min-h-11 items-center text-control font-medium text-primary-text underline underline-offset-4" to={`/stock/new/receive?order=${orderId}`}>{t('receiving.openReceiving')}</Link>
    </div>
    <DataTable<ReceivingLine> rows={order.data.lines} columns={columns} rowKey={(line) => line.id} tableId="order-receiving-progress" accessibleName={t('receiving.progressTitle')} embedded cardValuesEnd />
  </section>;
}
