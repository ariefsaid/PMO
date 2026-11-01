import type { TFunction } from 'i18next';
import { projectStatusGroup, type ProjectStatus } from '@/src/lib/db/projectTransitions';

export const isLostTarget = (to: ProjectStatus) => projectStatusGroup(to) === 'lost';

/** The status menu's confirm copy, shared with the board drop (moved verbatim from ProjectStatusControl). */
export function projectConfirmCopy(to: ProjectStatus) {
  return isLostTarget(to)
    ? { tone: 'destructive' as const, title: 'Mark project as lost',
        description: 'This moves the project to a terminal lost stage. You can still review it, but it leaves the active pipeline.',
        confirmLabel: 'Mark lost' }
    : { tone: 'default' as const, title: `Move project to ${to}?`,
        description: `This moves the project forward to the ${to} stage.`, confirmLabel: `Move to ${to}` };
}

/** The menu's message for a win-eligibility decision that is not 'allowed'. */
export function winEligibilityMessage(t: TFunction, decision: string | null | undefined): string {
  if (!decision || decision === 'unavailable')
    return t('project:winEligibility.unavailable', 'Win eligibility is unavailable. Refresh this page and try again.');
  if (decision === 'inactive_reviewer')
    return t('project:winEligibility.inactive', 'Ask an active supervisor or a more senior reviewer to confirm the value.');
  return t('project:winEligibility.reviewer', 'Ask your supervisor or a more senior reviewer to confirm the value before winning this project.');
}

/** Both win inputs are required before the transition may be sent. */
export const winDetailsComplete = (contractRef: string, contractDate: string) =>
  contractRef.trim() !== '' && contractDate !== '';
