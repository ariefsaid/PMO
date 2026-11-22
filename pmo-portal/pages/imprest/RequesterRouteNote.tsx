import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '@/src/components/ui';
import { useImprestRequesterRoute } from '@/src/hooks/useImprest';
import { waitingForText, waitingRoleLabel } from '@/src/lib/approvals/waitingFor';
import type { ImprestRequesterRoute, ImprestRequesterRouteKind } from '@/src/lib/db/imprest';

/**
 * #1568 — one sentence from one database route. The database decides who; this only words it, in the reader's
 * language. `unavailable` and a `named` route with nobody in it render nothing (never a fabricated fallback person).
 * A payment step is worded as waiting to pay, so it cannot read as still awaiting approval.
 */
export function requesterRouteText(route: ImprestRequesterRoute, t: TFunction): string | null {
  switch (route.route_kind) {
    case 'named':
      return route.approvers.length > 0 ? waitingForText({ names: route.approvers.map((a) => a.name) }, t) : null;
    case 'flat':
      return waitingForText({ names: [], role: waitingRoleLabel('roleApprovalRank', t) }, t);
    case 'admin':
      return waitingForText({ names: [], role: waitingRoleLabel('roleAdmin', t) }, t);
    case 'finance_admin':
      return route.action === 'pay' && route.approvers.length > 0
        ? t('imprest:rep.waitingToPay', 'Waiting for {{who}} to pay', {
            who: route.approvers.map((a) => a.name).join(t('waitingList:waitingFor.or', ' or ')),
          })
        : waitingForText({ names: [], role: waitingRoleLabel('roleFinanceAdmin', t) }, t);
    case 'unavailable':
      return null;
    default:
      return null;
  }
}

/**
 * The waiting line beside a Submitted plan, a Proposed float limit change, or a Requested/Approved replenishment.
 * Pending and error are stated honestly: an unread route claims nobody. `prefix` (e.g. the proposed amount and a
 * separator) renders with the pending/error state and the sentence; an `unavailable` route renders nothing, so a
 * caller that keeps the amount outside the note never leaves a dangling separator.
 */
export const RequesterRouteNote: React.FC<{
  kind: ImprestRequesterRouteKind;
  recordId: string;
  testId: string;
  prefix?: React.ReactNode;
  className?: string;
}> = ({ kind, recordId, testId, prefix, className }) => {
  const { t } = useTranslation();
  const route = useImprestRequesterRoute(kind, recordId);
  const style = className ?? 'text-control text-muted-foreground';
  const lead = prefix ?? null;
  if (route.isError) {
    return (
      <span data-testid={testId} role="status" className={style}>
        {lead}
        {t('imprest:waiting.error', "Couldn't check who decides")}{' '}
        <Button variant="ghost" size="sm" onClick={() => void route.refetch()}>{t('imprest:waiting.retry', 'Retry')}</Button>
      </span>
    );
  }
  if (route.isPending) {
    return <span data-testid={testId} aria-busy="true" className={style}>{lead}{t('imprest:waiting.checking', 'Checking who decides…')}</span>;
  }
  const text = route.data ? requesterRouteText(route.data, t) : null;
  if (!text) return null;
  return <span data-testid={testId} className={style}>{lead}{text}</span>;
};
