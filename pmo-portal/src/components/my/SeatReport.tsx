import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSeatReport } from '@/src/hooks/useMyHome';

/** Active seats split full and light (#2710). Read-only, counts only; renders nothing until the report reads. Price is the owner's. */
export const SeatReport: React.FC = () => {
  const { t } = useTranslation('myHome');
  const report = useSeatReport(true);
  if (!report.data) return null;
  return (
    <div className="mt-4 max-w-md space-y-1" data-testid="seat-report">
      <h3 className="text-control font-semibold">{t('myHome:seats.title', 'Seats')}</h3>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 text-control">
        <dt>{t('myHome:seats.full', 'Full accounts')}</dt><dd>{report.data.full}</dd>
        <dt>{t('myHome:seats.light', 'Light accounts (Foreman, Field user)')}</dt><dd>{report.data.light}</dd>
        <dt className="font-semibold">{t('myHome:seats.total', 'Active seats')}</dt><dd className="font-semibold">{report.data.total}</dd>
      </dl>
      <p className="text-control text-muted-foreground">{t('myHome:seats.helper', 'A light account has one phone home screen. Price and seat counts are agreed with the owner.')}</p>
    </div>
  );
};
