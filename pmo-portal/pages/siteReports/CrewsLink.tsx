import React, { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useCrewPunctuality } from '@/src/hooks/useSiteCheckpoints';
import { checkpointToday } from './checkpointTime';

/**
 * Doorway from the site report list to `/site-reports/crews` (#2594). It shows only when the viewer may read checkpoint days
 * and the organisation has some in the last 30 days, so an organisation with no checkpoint list sees no new link.
 */
export const CrewsLink: React.FC = () => {
  const { t } = useTranslation('siteReport');
  const filter = useMemo(() => {
    const to = checkpointToday();
    const d = new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 29);
    return { from: d.toISOString().slice(0, 10), to };
  }, []);
  const crews = useCrewPunctuality(filter);
  if ((crews.data?.crews.length ?? 0) === 0) return null;
  return (
    <p>
      <Link to="/site-reports/crews" className="inline-flex min-h-11 items-center text-primary-text underline" data-testid="crews-link">{t('crews.link', 'Crews on time and lost time')}</Link>
    </p>
  );
};
