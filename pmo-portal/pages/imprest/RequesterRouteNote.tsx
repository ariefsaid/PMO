import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '@/src/components/ui';
import { useImprestRequesterRoute } from '@/src/hooks/useImprest';
import { waitingForText, waitingRoleLabel } from '@/src/lib/approvals/waitingFor';
import { useRoleLabels } from '@/pages/admin-users/roleLabels';
import type {
  ImprestRequesterAction, ImprestRequesterApprover, ImprestRequesterRoute, ImprestRequesterRouteKind,
} from '@/src/lib/db/imprest';

/** "Sari Senior (Executive)" per person, deduped by the full label so two people with one name but different roles
 *  stay distinguishable. The role is the person's actual returned role, worded by the existing role-label seam. */
function approverWho(approvers: readonly ImprestRequesterApprover[], roleLabel: (role: string) => string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of approvers) {
    const label = a.role ? `${a.name} (${roleLabel(a.role)})` : a.name;
    if (!seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  return out;
}

/**
 * #1568 — one sentence from one database route. The database decides who; this only words it, in the reader's
 * language. A `named` route reports the true Admin break-glass alternative when the database says one exists (never a
 * fabricated Admin). `unavailable` and an empty named set render nothing. A payment step is worded as waiting to pay,
 * so it cannot read as still awaiting approval.
 */
export function requesterRouteText(
  route: ImprestRequesterRoute,
  t: TFunction,
  roleLabel: (role: string) => string,
): string | null {
  switch (route.route_kind) {
    case 'named': {
      const who = approverWho(route.approvers, roleLabel);
      if (who.length === 0) return null;
      const alternatives = route.admin_breakglass ? [waitingRoleLabel('roleAdmin', t)] : [];
      return waitingForText({ names: who, alternativeRoles: alternatives }, t);
    }
    case 'flat':
      return waitingForText({ names: [], role: waitingRoleLabel('roleApprovalRank', t) }, t);
    case 'admin':
      return waitingForText({ names: [], role: waitingRoleLabel('roleAdmin', t) }, t);
    case 'finance_admin': {
      const who = approverWho(route.approvers, roleLabel);
      return route.action === 'pay' && who.length > 0
        ? t('imprest:rep.waitingToPay', 'Waiting for {{who}} to pay', {
            who: who.join(t('waitingList:waitingFor.or', ' or ')),
          })
        : waitingForText({ names: [], role: waitingRoleLabel('roleFinanceAdmin', t) }, t);
    }
    case 'unavailable':
      return null;
    default:
      return null;
  }
}

/**
 * The waiting line beside a Submitted plan, a Proposed float limit change, or a Requested/Approved replenishment.
 * Pending and error are stated honestly: an unread route claims nobody. `expectAction` binds the line to this record
 * state, so a stale approval answer can never render in the payment slot after a transition. `prefix` (e.g. the
 * proposed amount and a separator) renders with the pending/error state and the sentence; an `unavailable` route
 * renders nothing, so a caller that keeps the amount outside the note never leaves a dangling separator.
 */
export const RequesterRouteNote: React.FC<{
  kind: ImprestRequesterRouteKind;
  recordId: string;
  testId: string;
  expectAction?: ImprestRequesterAction | null;
  prefix?: React.ReactNode;
  className?: string;
}> = ({ kind, recordId, testId, expectAction = null, prefix, className }) => {
  const { t } = useTranslation();
  const { options } = useRoleLabels();
  const route = useImprestRequesterRoute(kind, recordId, expectAction);
  const roleLabel = (role: string) => options.find((o) => o.value === role)?.label ?? role;
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
  const data = route.data;
  if (!data) return null;
  // A transition changes the expected action; a cached answer for the previous state is not this state's answer.
  if (expectAction && data.action !== expectAction) return null;
  const text = requesterRouteText(data, t, roleLabel);
  if (!text) return null;
  return <span data-testid={testId} className={style}>{lead}{text}</span>;
};
