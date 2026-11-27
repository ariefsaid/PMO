import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, RecordSection, type Column } from '@/src/components/ui';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { formatDuration, useBreakdowns, useVendorNames, useVendorResponseReady } from '@/src/hooks/useVendorResponse';
import { vendorResponseSummary, type VendorResponseSummary } from '@/src/lib/vendorResponse';

/** Per-vendor table: breakdowns, responded, awaiting, median, average, slowest. Figures right-aligned on one edge; a phone gets cards. */
export const VendorResponseSummaryTable: React.FC<{ rows: VendorResponseSummary[] }> = ({ rows }) => {
  const { t } = useTranslation();
  const name = useVendorNames();
  const num = (key: string, header: string, cell: (r: VendorResponseSummary) => React.ReactNode): Column<VendorResponseSummary> =>
    ({ key, header, align: 'num', size: 112, cell: (r) => <span className="whitespace-nowrap tabular-nums">{cell(r)}</span> });
  const columns: Column<VendorResponseSummary>[] = [
    { key: 'vendor', header: t('equipment:vendorResponse.vendor', 'Vendor'), kind: 'primary', rowHeader: true, size: 220, cell: (r) => name(r.vendorId) },
    num('breakdowns', t('equipment:vendorResponse.breakdowns', 'Breakdowns'), (r) => r.breakdowns),
    num('responded', t('equipment:vendorResponse.responded', 'Responded'), (r) => r.responded),
    num('awaiting', t('equipment:vendorResponse.awaitingCount', 'Awaiting'), (r) => r.awaiting),
    num('median', t('equipment:vendorResponse.median', 'Median'), (r) => formatDuration(t, r.medianMinutes)),
    num('average', t('equipment:vendorResponse.average', 'Average'), (r) => formatDuration(t, r.averageMinutes)),
    num('slowest', t('equipment:vendorResponse.slowest', 'Slowest'), (r) => formatDuration(t, r.slowestMinutes)),
  ];
  return <DataTable<VendorResponseSummary> embedded rows={rows} columns={columns} rowKey={(r) => r.vendorId} tableId="vendor-response-summary"
    accessibleName={t('equipment:vendorResponse.summaryTitle', 'Vendor response time, last 12 months')} />;
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
    <RecordSection className="mt-6" title={t('equipment:vendorResponse.summaryTitle', 'Vendor response time, last 12 months')} subline={t("equipment:vendorResponse.loadedScope", "{{count}} rented machines from the loaded equipment pages; other machines are excluded.", {count: assetIds.length})} flush>
      <VendorResponseSummaryTable rows={rows} />
    </RecordSection>
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
