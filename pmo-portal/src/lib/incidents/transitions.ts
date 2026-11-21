import type { TFunction } from 'i18next';
import type { IncidentStatus } from '@/src/lib/db/incidents';

/** A status the workflow can transition TO (Open is only an initial state). */
export type AdvanceStatus = 'Investigating' | 'Closed';

/** The next workflow step for a status (Closed is terminal → null). */
export const NEXT_STATUS: Record<IncidentStatus, AdvanceStatus | null> = {
  Open: 'Investigating',
  Investigating: 'Closed',
  Closed: null,
};

/** Human verb-object label + confirm copy for a status transition, in the reader's language. */
export function transitionCopy(t: TFunction<'incidents'>, to: AdvanceStatus) {
  const action = to === 'Closed'
    ? t('transition.Closed.action', 'Close incident')
    : t('transition.Investigating.action', 'Start investigating');
  return {
    menu: action,
    confirm: action,
    title: (type: string) => to === 'Closed'
      ? t('transition.Closed.title', 'Close {{type}}?', { type })
      : t('transition.Investigating.title', 'Start investigating {{type}}?', { type }),
    body: to === 'Closed'
      ? t('transition.Closed.body', 'This marks the incident Closed. Closed is the final state; reopen by filing a follow-up if new information emerges.')
      : t('transition.Investigating.body', 'This moves the incident to Investigating so the team can record findings. You can close it once the investigation is complete.'),
  };
}

/** Severity (stored enum) → label in the reader's language. */
export function severityLabel(t: TFunction<'incidents'>, severity: string): string {
  switch (severity) {
    case 'Low': return t('severity.Low', 'Low');
    case 'Medium': return t('severity.Medium', 'Medium');
    case 'High': return t('severity.High', 'High');
    case 'Critical': return t('severity.Critical', 'Critical');
    default: return severity;
  }
}
