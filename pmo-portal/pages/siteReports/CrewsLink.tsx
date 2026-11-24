import React, { useMemo } from 'react';
import { Link } from 'react-router';
import { QueryClientContext } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useCrewPunctuality } from '@/src/hooks/useSiteCheckpoints';
import { usePermission } from '@/src/auth/usePermission';
import { checkpointToday } from './checkpointTime';

/**
 * Doorway from the site report list to `/site-reports/crews` (#2594). A role that reads every checkpoint day always has it
 * (walk F3-3: hidden until rows existed, nobody found it); a role that reads only its own projects' days has it once some exist.
 */
/** Without a query client in scope (a bare render of the list) there is nothing to ask, so nothing shows. */
export const CrewsLink: React.FC = () => (React.useContext(QueryClientContext) ? <CrewsLinkInner /> : null);

const CrewsLinkInner: React.FC = () => {
  const { t } = useTranslation('siteReport');
  const filter = useMemo(() => {
    const to = checkpointToday();
    const d = new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 29);
    return { from: d.toISOString().slice(0, 10), to };
  }, []);
  const crews = useCrewPunctuality(filter);
  const readsAll = usePermission()('view', 'siteCheckpoint');
  if (!readsAll && (crews.data?.crews.length ?? 0) === 0) return null;
  return (
    <p>
      <Link to="/site-reports/crews" className="inline-flex min-h-11 items-center text-primary-text underline" data-testid="crews-link">{t('crews.link', 'Missed checkpoints, crews on time and lost time')}</Link>
    </p>
  );
};
