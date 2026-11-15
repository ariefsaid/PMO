import { useTranslation } from 'react-i18next';
import { StatusPill } from '@/src/components/ui';
import { statusLabel } from '@/src/lib/status/statusMap';

/** The row's one status mark: lifecycle name, exception tone, lateness beneath (same amber pill as the record). */
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
        ? <StatusPill record="project" state={state} wrap className="py-1" />
        : (
          <StatusPill variant={exception === 'overBudget' ? 'overdue' : 'warn'} wrap className="py-1">
            {exception === 'overBudget'
              ? tp('health.statusOverBudget', '{{status}} · over budget', { status: name })
              : tp('health.statusAtRisk', '{{status}} · at risk', { status: name })}
          </StatusPill>
        )}
      {lateDays !== null && (
        // The record's mark (amber pill). Exception colour once per row: over budget (red) wins, so late drops to plain text.
        exception === 'overBudget'
          ? <span className="text-control text-foreground">{tp('health.daysLate', '{{count}} days late', { count: lateDays })}</span>
          : <StatusPill variant="warn" wrap className="py-1">{tp('health.daysLate', '{{count}} days late', { count: lateDays })}</StatusPill>
      )}
    </div>
  );
}
