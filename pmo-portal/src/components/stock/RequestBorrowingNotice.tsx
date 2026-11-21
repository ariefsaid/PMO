import React from 'react';
import { useTranslation } from 'react-i18next';
import { useRequestBorrowing, useReservationsEnabled } from '@/src/hooks/useStockReservations';
import { formatQuantity } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';

/** On a material request: how much of it uses the work order's own reservation and how much borrows another work order's reserved stock (#2693). Renders nothing while reservations are off or the request was not checked. */
export const RequestBorrowingNotice: React.FC<{ requestId: string }> = ({ requestId }) => {
  const { t } = useTranslation('stock');
  const on = useReservationsEnabled();
  const q = useRequestBorrowing(requestId, on);
  if (!on || !q.data || !q.data.borrowing) return null;
  const loc = getNumberLocale();
  const borrowed = q.data.lines.reduce((n, l) => n + Number(l.borrowedQty), 0);
  return (
    <p role="status" className="rounded-lg border border-border p-3 text-sm">
      <b className="font-semibold">{t('reservations.borrowing.title')}</b> {t('reservations.borrowing.body', { n: formatQuantity(String(borrowed), loc) })}
    </p>
  );
};
