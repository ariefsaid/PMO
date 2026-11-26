import { WithheldPrice } from '@/src/components/ui/WithheldPrice';
import { useMaySeePrices } from '@/src/hooks/useHidePrices';
import React, { useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useOrgSwitch } from '@/src/hooks/useOrgSwitch';
import { useWorkOrderStockBalance } from '@/src/hooks/useStockSiteWork';
import { DataTable, type Column } from '@/src/components/ui';
import { PrimaryCell } from '@/src/components/ui/DataTableShared';
import type { WorkOrderStockRow } from '@/src/lib/db/stockSiteWork';
import { formatQuantity, formatStockValue } from '@/src/lib/stockFormat';
import { isOwnershipCacheSynced, routeDomainWrite, subscribeOwnershipCache } from '@/src/lib/adapterSeam/ownershipCache';
import { ReservationsSlot } from '@/src/components/stock/ReservationsSlot';
import { WorkOrderReservations } from '@/src/components/stock/WorkOrderReservations';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { WorkOrderMaterialProgressBanner } from './WorkOrderMaterialProgressBanner';

/**
 * Stock held for one work order (#2523, FR-SSW-030/031). Ledger-derived by the database; an empty list is an empty state,
 * never a row of zeros. A tag's name (e.g. the org's word for client-supplied stock) comes from data. Value is shown only when the
 * server sent it (roles that read stock value).
 */
export const WorkOrderStockBalance: React.FC<{ workOrderId: string; currency: string }> = ({ workOrderId, currency }) => {
  const { t } = useTranslation('stock');
  const maySeePrices = useMaySeePrices();
  const q = useWorkOrderStockBalance({ workOrderId });
  const ownership = useSyncExternalStore(subscribeOwnershipCache, () => isOwnershipCacheSynced() ? routeDomainWrite('inventory') : 'unknown');
  const woTransfers = useOrgSwitch('stockWoTransfers').data === true;
  const rows = q.data ?? [];
  const showValue = maySeePrices && rows.some((r) => r.onSiteValue !== undefined);
  const loc = getNumberLocale();
  // Unit shown once, beside the on-site figure; the other columns are bare numbers in the same unit.
  const qty = (v: string, unit?: string) => <span className="whitespace-nowrap tabular-nums">{formatQuantity(v, loc)}{unit ? <> <span className="text-muted-foreground">{unit}</span></> : null}</span>;
  // A zero-cost (client-supplied) row says so instead of a bare zero that reads as missing data.
  const money = (r: WorkOrderStockRow, v: string | undefined) => v === undefined ? t('siteWork.balance.noValue')
    : r.zeroCost ? t('siteWork.balance.zeroCost') : <span className="whitespace-nowrap tabular-nums">{formatStockValue(v, currency, loc)}</span>;
  const columns: Column<WorkOrderStockRow>[] = [
    { key: 'item', header: t('siteWork.balance.item'), kind: 'primary', cell: (r) => r.itemName, secondaryCell: (r) => r.tagName ?? null, primaryTitle: (r) => r.itemName },
    { key: 'location', header: t('siteWork.balance.location'), cell: (r) => r.warehouseCode },
    { key: 'received', header: t('siteWork.balance.received'), align: 'num', cell: (r) => qty(r.receivedQty) },
    { key: 'movedOut', header: t('siteWork.balance.movedOut'), align: 'num', cell: (r) => qty(r.movedOutQty) },
    { key: 'issued', header: t('siteWork.balance.issued'), align: 'num', cell: (r) => qty(r.issuedQty) },
    { key: 'onSite', header: t('siteWork.balance.onSite'), align: 'num', cell: (r) => <span className="font-semibold">{qty(r.onSiteQty, r.unitCode)}</span> },
    ...(showValue ? [
      { key: 'issuedValue', header: t('siteWork.balance.issuedValue'), align: 'num' as const, cell: (r: WorkOrderStockRow) => money(r, r.issuedValue) },
      { key: 'value', header: t('siteWork.balance.value'), align: 'num' as const, cell: (r: WorkOrderStockRow) => money(r, r.onSiteValue) },
    ] : []),
  ];
  // Phone card: what and where on top, the on-site figure big, the other figures small underneath.
  const cardDetails = (r: WorkOrderStockRow) => (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground">{r.warehouseCode}</span>
        <span className="text-base font-semibold">{qty(r.onSiteQty, r.unitCode)} <span className="text-control font-normal text-muted-foreground">{t('siteWork.balance.onSite')}</span></span>
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 text-control text-muted-foreground">
        {([['received', r.receivedQty], ['movedOut', r.movedOutQty], ['issued', r.issuedQty]] as const).map(([k, v]) => (
          <React.Fragment key={k}><dt>{t(`siteWork.balance.${k}`)}</dt><dd className="text-right">{qty(v)}</dd></React.Fragment>
        ))}
        {showValue && <><dt>{t('siteWork.balance.issuedValue')}</dt><dd className="text-right">{money(r, r.issuedValue)}</dd><dt>{t('siteWork.balance.value')}</dt><dd className="text-right">{money(r, r.onSiteValue)}</dd></>}
      </dl>
    </div>
  );
  return (
    <section aria-label={t('siteWork.balance.title')} className="space-y-2">
      {!maySeePrices && q.isSuccess && <WithheldPrice />}
      {ownership === 'pmo' && <WorkOrderMaterialProgressBanner workOrderId={workOrderId} />}
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
        <DataTable<WorkOrderStockRow> rows={rows} columns={columns} rowKey={(r) => `${r.itemId}-${r.warehouseId}`} tableId={`wo-stock-${workOrderId}`}
          accessibleName={t('siteWork.balance.title')} embedded cardValuesEnd
          mobileCardTitle={(r) => <PrimaryCell title={r.itemName} secondary={r.tagName ?? undefined} />} mobileCardDetails={cardDetails} />
      )}
      {woTransfers && rows.length > 0 && <p className="text-sm"><Link to="/stock/work-order-transfer" className="font-medium underline">{t('workOrderTransfer.entry')}</Link></p>}
      <ReservationsSlot><WorkOrderReservations workOrderId={workOrderId} /></ReservationsSlot>
    </section>
  );
};
