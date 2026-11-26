import React, { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui';
import { formatQuantity } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import type { FreeReservedRow } from '@/src/lib/repositories/stockReservations';

const Figure: React.FC<{ qty: string; unitCode: string }> = ({ qty, unitCode }) => (
  // The number never breaks; a long unit code wraps under it rather than running past the column's right edge.
  <span className="tabular-nums"><span className="whitespace-nowrap">{formatQuantity(qty, getNumberLocale())}</span>{unitCode && <span className="break-words text-muted-foreground"> {unitCode}</span>}</span>
);

/** The free quantity of one item at one location (#2693): its own right-aligned figure. Rendered only while reservations are on. */
export const FreeFigure: React.FC<{ figures: FreeReservedRow | undefined; unitCode: string }> = ({ figures, unitCode }) =>
  figures ? <Figure qty={figures.freeQty} unitCode={unitCode} /> : <span className="text-muted-foreground">—</span>;

/** The reserved quantity, how far the holders are short, and the reserving work orders one tap away (#2693). */
export const ReservedFigure: React.FC<{ figures: FreeReservedRow | undefined; unitCode: string }> = ({ figures, unitCode }) => {
  const { t } = useTranslation('stock');
  const [open, setOpen] = useState(false);
  const loc = getNumberLocale();
  if (!figures) return <span className="text-muted-foreground">—</span>;
  const holders = figures.reservations;
  return (
    <div className="flex min-w-0 flex-col items-end gap-1 text-right">
      <Figure qty={figures.reservedQty} unitCode={unitCode} />
      {Number(figures.shortBy) > 0 && <span className="text-control text-muted-foreground">{t('reservations.shortBy', { n: formatQuantity(figures.shortBy, loc) })}</span>}
      {holders.length > 0 && (
        <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? t('reservations.hideHolders') : t('reservations.showHolders', { count: holders.length })}</Button>
      )}
      {open && (
        <ul className="space-y-1 text-left" aria-label={t('reservations.holders')}>
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

/** Reserve stock here: shown only to a person who may reserve at this location. */
export const ReserveAction: React.FC<{ onReserve?: () => void }> = ({ onReserve }) => {
  const { t } = useTranslation('stock');
  return onReserve ? <Button variant="outline" size="sm" onClick={onReserve}>{t('reservations.reserve')}</Button> : null;
};
