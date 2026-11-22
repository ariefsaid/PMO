import type { TFunction } from 'i18next';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

/** Human words for the database refusals of the candidate work order rules (#2595); anything else is classified as usual. */
export function candidateErrorText(err: unknown, t: TFunction): string {
  const message = err instanceof Error ? err.message : '';
  if (message.includes('CWO_NOT_READY')) {
    const names = message.split('not ready:')[1]?.trim() ?? '';
    return t('projectDetail.candidates.errNotReady', 'These required checks are not ready: {{names}}', { names });
  }
  if (message.includes('CWO_DECIDED')) return t('projectDetail.candidates.errDecided', 'This candidate has already been decided.');
  if (message.includes('CWO_NA_NOTE')) return t('projectDetail.candidates.needNote', 'Add a note to mark this not applicable.');
  if (message.includes('CWO_REASON')) return t('projectDetail.candidates.errReason', 'Give a reason of 1 to 500 characters.');
  if (message.includes('CWO_REPLACES')) return t('projectDetail.candidates.errReplaces', 'Only a rejected candidate of this project can be replaced.');
  const { headline, detail } = classifyMutationError(err);
  return detail ? `${headline} ${detail}` : headline;
}
