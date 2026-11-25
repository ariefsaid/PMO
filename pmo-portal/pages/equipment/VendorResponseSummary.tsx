import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad } from '@/src/components/ui';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { formatDuration, useBreakdowns, useVendorNames, useVendorResponseReady } from '@/src/hooks/useVendorResponse';
import { vendorResponseSummary, type VendorResponseSummary } from '@/src/lib/vendorResponse';

/** Per-vendor table: breakdowns, responded, awaiting, median, average, slowest. Scrolls sideways on a phone, never the page. */
export const VendorResponseSummaryTable: React.FC<{ rows: VendorResponseSummary[] }> = ({ rows }) => {
  const { t } = useTranslation();
  const name = useVendorNames();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-muted-foreground">
          <th scope="col" className="pr-3 font-medium">{t('equipment:vendorResponse.vendor', 'Vendor')}</th>
          <th scope="col" className="pr-3 font-medium">{t('equipment:vendorResponse.breakdowns', 'Breakdowns')}</th>
          <th scope="col" className="pr-3 font-medium">{t('equipment:vendorResponse.responded', 'Responded')}</th>
          <th scope="col" className="pr-3 font-medium">{t('equipment:vendorResponse.awaitingCount', 'Awaiting')}</th>
          <th scope="col" className="pr-3 font-medium">{t('equipment:vendorResponse.median', 'Median')}</th>
          <th scope="col" className="pr-3 font-medium">{t('equipment:vendorResponse.average', 'Average')}</th>
          <th scope="col" className="font-medium">{t('equipment:vendorResponse.slowest', 'Slowest')}</th>
        </tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.vendorId}>
            <th scope="row" className="pr-3 text-left font-normal">{name(r.vendorId)}</th>
            <td className="pr-3 tabular-nums">{r.breakdowns}</td><td className="pr-3 tabular-nums">{r.responded}</td><td className="pr-3 tabular-nums">{r.awaiting}</td>
            <td className="pr-3 tabular-nums">{formatDuration(t, r.medianMinutes)}</td><td className="pr-3 tabular-nums">{formatDuration(t, r.averageMinutes)}</td><td className="tabular-nums">{formatDuration(t, r.slowestMinutes)}</td>
          </tr>))}</tbody>
      </table>
    </div>
  );
};

const Card_: React.FC<{ assetIds: string[] }> = ({ assetIds }) => {
  const { t } = useTranslation();
  const today = useOrgToday();
  const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 365);
  const q = useBreakdowns(assetIds, d.toISOString().slice(0, 10), today);
  const rows = useMemo(() => vendorResponseSummary((q.data ?? []).flatMap((r) => (r.vendor_id ? [{ vendorId: r.vendor_id, responseMinutes: r.response_minutes }] : []))), [q.data]);
  // An organisation that never had a rented breakdown sees nothing new.
  if (q.isPending || q.isError || rows.length === 0) return null;
  return (
    <Card className="mt-4">
      <CardHead>{t('equipment:vendorResponse.summaryTitle', 'Vendor response time, last 12 months')}</CardHead>
      <CardPad><VendorResponseSummaryTable rows={rows} /></CardPad>
    </Card>
  );
};

/** Mount point on the asset register: the rented assets loaded there, summarised per vendor (at most 200 per read). */
export const VendorResponseSummaryCard: React.FC<{ assets: { id: string; ownership?: string | null }[] }> = ({ assets }) => {
  const ready = useVendorResponseReady();
  const ids = useMemo(() => assets.filter((a) => a.ownership === 'rented').slice(0, 200).map((a) => a.id), [assets]);
  if (!ready || ids.length === 0) return null;
  return <Card_ assetIds={ids} />;
};
export default VendorResponseSummaryCard;
