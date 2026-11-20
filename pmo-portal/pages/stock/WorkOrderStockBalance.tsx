import React, { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkOrderStockBalance } from '@/src/hooks/useStockSiteWork';
import { formatStockValue } from '@/src/lib/stockFormat';
import { isOwnershipCacheSynced, routeDomainWrite, subscribeOwnershipCache } from '@/src/lib/adapterSeam/ownershipCache';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';

/**
 * Stock held for one work order (#2523, FR-SSW-030/031). Ledger-derived by the database; an empty list is an empty state,
 * never a row of zeros. A tag's name (e.g. the org's word for client-supplied stock) comes from data. Value is shown only when the
 * server sent it (roles that read stock value).
 */
export const WorkOrderStockBalance: React.FC<{ workOrderId: string; currency: string }> = ({ workOrderId, currency }) => {
  const { t } = useTranslation('stock');
  const q = useWorkOrderStockBalance({ workOrderId });
  const ownership = useSyncExternalStore(subscribeOwnershipCache, () => isOwnershipCacheSynced() ? routeDomainWrite('inventory') : 'unknown');
  const rows = q.data ?? [];
  const showValue = rows.some((r) => r.onSiteValue !== undefined);
  return (
    <section aria-labelledby={`wo-stock-${workOrderId}`} className="space-y-2">
      <h3 id={`wo-stock-${workOrderId}`} className="text-base font-semibold">{t('siteWork.balance.title')}</h3>
      {ownership === 'unknown' ? (
        <p role="status" className="text-sm text-muted-foreground">{t('siteWork.balance.loading')}</p>
      ) : ownership === 'external' ? (
        <p role="status" className="text-sm text-muted-foreground">{t('siteWork.balance.connectedUnavailable')}</p>
      ) : q.isError ? (
        <p role="alert" className="text-sm text-destructive">{t('siteWork.balance.error')}</p>
      ) : q.isLoading ? (
        <p role="status" className="text-sm text-muted-foreground">{t('siteWork.balance.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('siteWork.balance.empty')}</p>
      ) : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th scope="col">{t('siteWork.balance.item')}</th>
              <th scope="col">{t('siteWork.balance.location')}</th>
              <th scope="col" className="text-right">{t('siteWork.balance.received')}</th>
              <th scope="col" className="text-right">{t('siteWork.balance.movedOut')}</th>
              <th scope="col" className="text-right">{t('siteWork.balance.issued')}</th>
              <th scope="col" className="text-right">{t('siteWork.balance.onSite')}</th>
              {showValue && <th scope="col" className="text-right">{t('siteWork.balance.issuedValue')}</th>}
              {showValue && <th scope="col" className="text-right">{t('siteWork.balance.value')}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.itemId}-${r.warehouseId}`}>
                <td>{r.itemName}{r.tagName ? <span className="ml-2 text-muted-foreground">{r.tagName}</span> : null}</td>
                <td>{r.warehouseCode}</td>
                <td className="text-right tabular-nums">{r.receivedQty}</td>
                <td className="text-right tabular-nums">{r.movedOutQty}</td>
                <td className="text-right tabular-nums">{r.issuedQty}</td>
                <td className="text-right tabular-nums">{r.onSiteQty} {r.unitCode}</td>
                {showValue && <td className="text-right tabular-nums">{r.issuedValue === undefined ? t('siteWork.balance.noValue') : formatStockValue(r.issuedValue, currency, getNumberLocale())}</td>}
                {showValue && <td className="text-right tabular-nums">{r.onSiteValue === undefined ? t('siteWork.balance.noValue') : formatStockValue(r.onSiteValue, currency, getNumberLocale())}</td>}
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </section>
  );
};
