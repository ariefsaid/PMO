import { useTranslation } from 'react-i18next';
import { StatusPill } from '@/src/components/ui';
import { statusLabel } from '@/src/lib/status/statusMap';

/** The row's one status mark: lifecycle name and exception tone in the pill; lateness is one warning-coloured line beneath. */
export function ProjectStatusCell({ state, exception, lateDays }: {
  state: string;
  exception: 'overBudget' | 'atRisk' | null;
  lateDays: number | null;
}) {
  const { t } = useTranslation('status');
  const { t: tp } = useTranslation('projects');
  const name = statusLabel('project', state, t);
  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5">
      {exception === null
        ? <StatusPill record="project" state={state} wrap className="whitespace-normal" />
        : (
          <StatusPill variant={exception === 'overBudget' ? 'overdue' : 'warn'} wrap className="whitespace-normal">
            {exception === 'overBudget'
              ? tp('health.statusOverBudget', '{{status}} · over budget', { status: name })
              : tp('health.statusAtRisk', '{{status}} · at risk', { status: name })}
          </StatusPill>
        )}
      {lateDays !== null && (
        // One form in every row: a second pill would read as a second status.
        <span className="whitespace-nowrap text-control text-warning-foreground">{tp('health.pastEnd', { count: lateDays, defaultValue_one: '{{count}} day past end date', defaultValue_other: '{{count}} days past end date' })}</span>
      )}
    </div>
  );
}
