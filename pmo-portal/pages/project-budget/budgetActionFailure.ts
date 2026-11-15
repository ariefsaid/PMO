import type { TFunction } from 'i18next';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

/** A transport failure carries engine/browser text ("Failed to fetch") that tells a person nothing to do. */
const TRANSPORT = /failed to fetch|networkerror|load failed|network request failed|fetch failed/i;

/**
 * #2091: toast copy for a failed budget action. A classified failure shows its product headline and
 * detail; a transport failure shows a localized next step. The raw message is never shown for a
 * transport failure (it stays in the dev console via `classifyMutationError`).
 */
export function budgetActionFailure(error: unknown, t: TFunction): { headline: string; detail: string } {
  const classified = classifyMutationError(error);
  const fallbackHeadline = t('financeCopy.actionFailed', 'Action failed');
  if (classified.classification === 'unclassified' && (error instanceof TypeError || TRANSPORT.test(classified.rawDetail))) {
    return {
      headline: fallbackHeadline,
      detail: t('financeCopy.actionFailedNextStep', 'Check your connection and try again. If it keeps failing, contact your administrator.'),
    };
  }
  return {
    headline: classified.classification === 'unclassified' ? fallbackHeadline : classified.headline,
    detail: classified.detail,
  };
}
