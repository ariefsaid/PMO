import React, { useContext } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';

import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState, RecordSection } from '@/src/components/ui';
import { useWorkOrderRoster } from '@/src/hooks/useCrews';
import { useOrgToday } from '@/src/hooks/useOrgToday';

/**
 * Today's crews on this work order (walk F7-3, PC9): the roster lives on Crews → Roster; this names who is on the work
 * order today and opens that roster with the work order already chosen. Same read and same date as the roster page.
 */
const WorkOrderCrewLinkBody: React.FC<{ workOrderId: string }> = ({ workOrderId }) => {
  const { t } = useTranslation('workOrders');
  const roster = useWorkOrderRoster(workOrderId, useOrgToday());
  const open = (
    <Link to={`/crews?view=roster&wo=${workOrderId}`} className="text-control font-medium text-primary-text hover:underline" data-testid="wo-crews-open">
      {t('crewsToday.open', 'Open crew roster')}
    </Link>
  );
  return (
    <RecordSection title={t('crewsToday.title', 'Crews today')} actions={open} data-testid="wo-crews-today">
      {roster.isPending ? <ListState variant="loading" rows={2} />
        : roster.isError ? <ListState variant="error" title={t('crewsToday.loadError', "Couldn't load today's crews")} onRetry={() => void roster.refetch()} />
          : (roster.data ?? []).length === 0 ? <p className="text-control text-muted-foreground">{t('crewsToday.none', 'No crew rostered today')}</p>
            : (
              <ul className="flex flex-col divide-y divide-border text-control">
                {(roster.data ?? []).map((c) => (
                  <li key={c.crew_id} className="flex items-center justify-between gap-4 py-2 first:pt-0 last:pb-0">
                    <span>{c.crew_code} · {c.crew_name}</span>
                    <span className="tabular-nums text-muted-foreground">{t('crewsToday.people', '{{count}} people', { count: c.members.length })}</span>
                  </li>
                ))}
              </ul>
            )}
    </RecordSection>
  );
};

/** Renders nothing outside the auth and query providers (bare renders of the page in unit tests). */
export const WorkOrderCrewLink: React.FC<{ workOrderId: string }> = (props) => {
  const auth = useContext(AuthContext);
  const queryClient = useContext(QueryClientContext);
  if (!auth || !queryClient) return null;
  return <WorkOrderCrewLinkBody {...props} />;
};
