import React from 'react';
import { useTranslation } from 'react-i18next';
import type { MyHomeIssue } from '@/src/lib/repositories/myHome';
import { statusLabel } from '@/src/lib/status/statusMap';
import { severityLabel } from '@/src/lib/incidents/transitions';
import { formatDay } from '@/src/lib/format';
import { MySection } from './MySection';

/** Issues the person reported. Read-only here; reporting stays on the existing issue form. */
export const MyIssues: React.FC<{ issues: MyHomeIssue[] }> = ({ issues }) => {
  const { t } = useTranslation('myHome');
  const { t: tIncidents } = useTranslation('incidents');
  const { t: tStatus } = useTranslation('status');
  return (
    <MySection id="my-issues" title={t('myHome:issues.title', 'Issues I reported')}>
      {issues.length === 0 ? <p className="text-control text-muted-foreground">{t('myHome:issues.empty', 'You have not reported an issue')}</p> : (
        <ul className="space-y-2">
          {issues.map((i) => (
            <li key={i.id} className="rounded-md border border-border p-3">
              <p className="text-control font-semibold">{i.type}</p>
              <p className="text-control text-muted-foreground">{severityLabel(tIncidents, i.severity)} · {statusLabel('incident', i.status, tStatus)} · {formatDay(i.incident_date)}</p>
              {i.description && <p className="text-control">{i.description}</p>}
            </li>
          ))}
        </ul>
      )}
    </MySection>
  );
};
