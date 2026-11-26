import React, { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui';
import { formatQuantity } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import type { FreeReservedRow } from '@/src/lib/repositories/stockReservations';

/** The free quantity of one item at one location, as a figure with its unit (#2693). Rendered only while reservations are on. */
export const FreeQty: React.FC<{ figures: FreeReservedRow | undefined; unitCode: string }> = ({ figures, unitCode }) => {
  const loc = getNumberLocale();
  return figures ? <span className="whitespace-nowrap tabular-nums">{formatQuantity(figures.freeQty, loc)} <span className="text-muted-foreground">{unitCode}</span></span> : <span className="text-muted-foreground">—</span>;
};

/** The reserved quantity, with the shortfall under it and the reserving work orders one tap away. */
export const ReservedQty: React.FC<{ figures: FreeReservedRow | undefined; unitCode: string }> = ({ figures, unitCode }) => {
  const { t } = useTranslation('stock');
  const [open, setOpen] = useState(false);
  const loc = getNumberLocale();
  if (!figures) return <span className="text-muted-foreground">—</span>;
  const holders = figures.reservations;
  return (
    <div className="flex min-w-0 flex-col items-end text-right">
      <span className="whitespace-nowrap tabular-nums">{formatQuantity(figures.reservedQty, loc)} <span className="text-muted-foreground">{unitCode}</span></span>
      {Number(figures.shortBy) > 0 && <span className="text-control text-muted-foreground">{t('reservations.shortBy', { n: formatQuantity(figures.shortBy, loc) })}</span>}
      {holders.length > 0 && (
        <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? t('reservations.hideHolders') : t('reservations.showHolders', { count: holders.length })}</Button>
      )}
      {open && (
        <ul className="mt-1 space-y-1 text-left" aria-label={t('reservations.holders')}>
          {holders.map((h) => (
            <li key={h.reservationId}>
              <Link to={`/work-orders/${h.workOrderId}`} className="font-medium hover:underline">{[h.workOrderNumber, h.workOrderTitle].filter(Boolean).join(' - ')}</Link>
              <span className="tabular-nums text-muted-foreground"> · {formatQuantity(h.remainingQty, loc)} {unitCode}{h.expiresOn ? ` · ${t('reservations.until', { date: h.expiresOn })}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/** The Reserve action for a row the person may reserve at. */
export const ReserveButton: React.FC<{ onReserve?: () => void }> = ({ onReserve }) => {
  const { t } = useTranslation('stock');
  return onReserve ? <Button variant="outline" size="sm" onClick={onReserve}>{t('reservations.reserve')}</Button> : null;
};
