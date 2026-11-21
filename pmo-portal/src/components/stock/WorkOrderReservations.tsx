import React from 'react';
import { useTranslation } from 'react-i18next';
import { useReservationsEnabled, useWorkOrderReservations } from '@/src/hooks/useStockReservations';
import { useStockItems, useStockWarehouses } from '@/src/hooks/useStock';
import { formatQuantity } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';

/** On a work order's stock balance: what the work order holds in reserve (#2693). Renders nothing while reservations are off or it holds none. */
export const WorkOrderReservations: React.FC<{ workOrderId: string }> = ({ workOrderId }) => {
  const { t } = useTranslation('stock');
  const on = useReservationsEnabled();
  const q = useWorkOrderReservations(workOrderId, on);
  const items = useStockItems(false);
  const warehouses = useStockWarehouses(false);
  const rows = (q.data ?? []).filter((r) => Number(r.remainingQty) > 0);
  if (!on || rows.length === 0) return null;
  const loc = getNumberLocale();
  const itemName = (id: string) => (items.data ?? []).find((i) => i.id === id)?.name ?? id;
  const whName = (id: string) => (warehouses.data ?? []).find((w) => w.id === id)?.name ?? id;
  return (
    <section aria-label={t('reservations.heldByWorkOrder')} className="mt-4">
      <h3 className="text-sm font-semibold">{t('reservations.heldByWorkOrder')}</h3>
      <ul className="mt-1 space-y-1 text-sm">
        {rows.map((r) => (
          <li key={r.reservationId}>{itemName(r.itemId)} · {whName(r.warehouseId)} · <span className="tabular-nums">{formatQuantity(r.remainingQty, loc)}</span>{r.expiresOn ? ` · ${t('reservations.until', { date: r.expiresOn })}` : ''}</li>
        ))}
      </ul>
    </section>
  );
};
