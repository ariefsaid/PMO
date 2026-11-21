import React, { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui';
import { formatQuantity } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import type { FreeReservedRow } from '@/src/lib/repositories/stockReservations';

interface Props {
  figures: FreeReservedRow | undefined;
  unitCode: string;
  /** Set when the person may reserve here: shows the Reserve button. */
  onReserve?: () => void;
}

/** "x free + y reserved" for one item at one location, with the reserving work orders one tap away (#2693). Rendered only while reservations are on. */
export const ReservedCell: React.FC<Props> = ({ figures, unitCode, onReserve }) => {
  const { t } = useTranslation('stock');
  const [open, setOpen] = useState(false);
  const loc = getNumberLocale();
  if (!figures) return onReserve ? <Button variant="outline" size="sm" onClick={onReserve}>{t('reservations.reserve')}</Button> : <span className="text-muted-foreground">—</span>;
  const holders = figures.reservations;
  return (
    <div className="min-w-0 text-sm">
      <p className="tabular-nums">
        {t('reservations.freePlusReserved', { free: formatQuantity(figures.freeQty, loc), reserved: formatQuantity(figures.reservedQty, loc), unit: unitCode })}
      </p>
      {Number(figures.shortBy) > 0 && <p className="text-muted-foreground">{t('reservations.shortBy', { n: formatQuantity(figures.shortBy, loc) })}</p>}
      <div className="flex flex-wrap gap-2">
        {holders.length > 0 && (
          <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? t('reservations.hideHolders') : t('reservations.showHolders', { count: holders.length })}</Button>
        )}
        {onReserve && <Button variant="outline" size="sm" onClick={onReserve}>{t('reservations.reserve')}</Button>}
      </div>
      {open && (
        <ul className="mt-1 space-y-1" aria-label={t('reservations.holders')}>
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
