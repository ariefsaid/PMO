import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState, RecordSection, StatusPill } from '@/src/components/ui';
import { useDailySiteReports } from '@/src/hooks/useDailySiteReports';
import { formatDay } from '@/src/lib/format';

/** The latest daily site reports of this work order, with the crew or person each names (docs/specs/site-report-crew-link.spec.md). */
export const SiteReportsSection: React.FC<{ workOrderId: string }> = ({ workOrderId }) => {
  const { t } = useTranslation('siteReport');
  const list = useDailySiteReports({ workOrderId }, 0);
  const rows = (list.data?.rows ?? []).slice(0, 10);
  return (
    <RecordSection title={t('woSection.title', 'Site reports')} actions={<Link to="/site-reports" className="text-control text-primary-text hover:underline">{t('woSection.open', 'Open reports')}</Link>}>
      {list.isPending ? <ListState variant="loading" rows={2} />
        : list.isError ? <ListState variant="error" title={t('woSection.error', "Couldn't load the site reports")} onRetry={() => void list.refetch()} />
        : rows.length === 0 ? <p className="text-control text-muted-foreground">{t('woSection.empty', 'No site reports on this work order yet.')}</p>
        : (
          <ul className="divide-y divide-border" data-testid="wo-site-reports">
            {rows.map((r) => (
              <li key={r.id}>
                <Link to={`/site-reports/${r.id}`} className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 py-2 hover:bg-surface-hover">
                  <span className="tabular-nums text-foreground">{formatDay(r.work_date)}</span>
                  {r.crew_name && <span className="min-w-0 flex-1 truncate text-foreground">{t('list.crewLabel', { defaultValue: 'Crew {{name}}', name: r.crew_name })}</span>}
                  {r.person_name && <span className="min-w-0 flex-1 truncate text-foreground" data-testid="wo-dsr-person">{t('list.personLabel', { defaultValue: 'Person {{name}}', name: r.person_name })}</span>}
                  <span className="text-muted-foreground">{r.author_name ?? '—'}</span>
                  <StatusPill record="siteReport" state={r.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
    </RecordSection>
  );
};
