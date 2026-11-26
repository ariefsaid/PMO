import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState, RecordSection, StatusPill } from '@/src/components/ui';
import { formatDay } from '@/src/lib/format';
import { isIncidentOverdue } from '@/src/lib/incidents/overdue';
import type { IncidentRow } from '@/src/lib/db/incidents';

interface Props { issues: IncidentRow[]; isPending: boolean; isError: boolean; onRetry: () => void }

/** FR-WORP-025: the issues (#2521) that name this work order, with status and due time, each linking to the issue. */
export const IssuesSection: React.FC<Props> = ({ issues, isPending, isError, onRetry }) => {
  const { t } = useTranslation('workOrders');
  const title = t('issues.title', 'Issues');
  if (isPending) return <RecordSection title={title}><ListState variant="loading" rows={1} /></RecordSection>;
  if (isError) return <RecordSection title={title}><ListState variant="error" title={t('issues.error', "Couldn't load the issues")} onRetry={onRetry} /></RecordSection>;
  return (
    <RecordSection title={title} actions={<Link to="/incidents" className="text-control text-primary-text hover:underline">{t('issues.open', 'Open incidents')}</Link>}>
      {issues.length === 0
        ? <p className="text-control text-muted-foreground">{t('issues.empty', 'No issues name this work order.')}</p>
        : <ul className="divide-y divide-border" data-testid="wo-issues">
            {issues.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                <Link className="min-w-0 flex-1 underline" to={`/incidents/${i.id}`}>{i.type}</Link>
                <StatusPill record="incident" state={i.status} />
                {isIncidentOverdue(i) && <StatusPill variant="lost">{t('issues.overdue', 'Overdue')}</StatusPill>}
                <span className="text-muted-foreground">{i.due_at ? t('issues.due', 'Fix by {{date}}', { date: formatDay(i.due_at) }) : t('issues.noDue', 'No due time')}</span>
              </li>
            ))}
          </ul>}
    </RecordSection>
  );
};
