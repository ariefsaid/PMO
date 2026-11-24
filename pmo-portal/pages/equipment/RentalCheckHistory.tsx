import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSavedRentalChecks } from '@/src/hooks/useEquipmentAvailability';
import { formatIsoDay, formatInstantDate, formatInstantTime } from '@/src/lib/format';

export default function RentalCheckHistory({ assetId, procurementId }: { assetId?: string; procurementId?: string }) {
  const { t } = useTranslation('equipment');
  const query = useSavedRentalChecks(assetId, procurementId);
  if (!assetId && !procurementId) return null;
  if (query.isPending) return <p role="status">{t('hourly.loadingChecks', 'Loading saved rental checks…')}</p>;
  if (query.isError) return <p role="alert">{t('hourly.checksFailed', 'Saved rental checks could not be loaded. Retry before reviewing this invoice.')}</p>;
  if (!query.data?.length) return null;
  return <section className="my-3 space-y-2" aria-label={t('hourly.savedChecks', 'Saved rental checks')}>
    {query.data.map((check) => <article key={check.id} role={check.state === 'disputed' ? 'alert' : undefined} className="rounded-md border border-border bg-card p-3 text-sm">
      <p className="font-semibold">{check.state === 'disputed' ? t('hourly.disputed', 'Disputed') : t('hourly.checked', 'Checked')} · {check.invoice_number ?? t('hourly.unlinked', 'Invoice not linked')}</p>
      <p>{formatIsoDay(check.period_from)} – {formatIsoDay(check.period_to)} · {check.author} · <time dateTime={check.created_at}>{formatInstantDate(check.created_at)} {formatInstantTime(check.created_at)}</time></p>
      {check.note && <p className="mt-1 whitespace-pre-wrap">{check.note}</p>}
    </article>)}
    <p className="text-sm text-muted-foreground">{t('hourly.warningOnly', 'A dispute warns Finance; it does not change approval rights or amounts.')}</p>
  </section>;
}
