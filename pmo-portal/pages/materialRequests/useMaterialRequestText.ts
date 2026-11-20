import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDay } from '@/src/lib/format';
import { useUsers } from '@/src/hooks/useUsers';
import { materialRequestRefusal, type MaterialRequestRefusal, type MaterialRequestStatus, type StepStatus } from '@/src/lib/repositories/materialRequests';

/** Static label maps (no computed keys, so the catalogue extractor sees every string). */
export function useLabels() {
  const { t } = useTranslation('materialRequests');
  return {
    status: {
      draft: t('status.draft', 'Draft'), pending: t('status.pending', 'Waiting for approval'), approved: t('status.approved', 'Approved'),
      rejected: t('status.rejected', 'Rejected'), cancelled: t('status.cancelled', 'Withdrawn'), fulfilled: t('status.fulfilled', 'Delivered'),
    } satisfies Record<MaterialRequestStatus, string>,
    step: {
      waiting: t('stepStatus.waiting', 'Not yet'), open: t('stepStatus.open', 'Waiting'), approved: t('stepStatus.approved', 'Approved'),
      returned: t('stepStatus.returned', 'Sent back'), rejected: t('stepStatus.rejected', 'Rejected'), superseded: t('stepStatus.superseded', 'Replaced'),
    } satisfies Record<StepStatus, string>,
    event: {
      created: t('event.created', 'Raised'), submitted: t('event.submitted', 'Sent for approval'), approved_step: t('event.approved_step', 'Step approved'),
      returned: t('event.returned', 'Sent back'), rejected: t('event.rejected', 'Rejected'), approved: t('event.approved', 'Approved'),
      cancelled: t('event.cancelled', 'Withdrawn'), fulfilled: t('event.fulfilled', 'Delivered'),
      transfer_cancelled: t('event.transfer_cancelled', 'Transfer cancelled'), transfer_created: t('event.transfer_created', 'Transfer draft created'),
    } as Record<string, string>,
    role: {
      Engineer: t('role.Engineer', 'Engineer'), 'Project Manager': t('role.ProjectManager', 'Project Manager'), Finance: t('role.Finance', 'Finance'),
      Executive: t('role.Executive', 'Executive'), Admin: t('role.Admin', 'Admin'),
    } as Record<string, string>,
  };
}

/** id -> display name from the org directory; an unknown id shows an em dash, never a raw uuid. */
export function useUserNames(): (id: string | null | undefined) => string {
  const { data } = useUsers();
  const byId = useMemo(() => new Map((data ?? []).map((u) => [u.id, u.full_name])), [data]);
  return (id) => (id ? byId.get(id) ?? '—' : '—');
}

/** A refusal from the database as one plain sentence. The server states the rule; this only translates it. */
export function useRefusalText(): (err: unknown) => string {
  const { t } = useTranslation('materialRequests');
  const copy: Record<MaterialRequestRefusal, string> = {
    sodAuthor: t('refusal.sodAuthor', 'You raised this request, so you cannot approve it.'),
    sodTwice: t('refusal.sodTwice', 'You already decided another step of this request.'),
    outOfOrder: t('refusal.outOfOrder', 'An earlier step has not been approved yet.'),
    notApprover: t('refusal.notApprover', 'This step is not yours to decide.'),
    reasonRequired: t('refusal.reasonRequired', 'Give a reason.'),
    overPlanReason: t('refusal.overPlanReason', 'A line over plan needs a reason.'),
    cutoff: t('refusal.cutoff', 'The daily cut-off has passed for tomorrow. Choose a later needed-by date.'),
    neededBy: t('refusal.neededBy', 'Choose a needed-by date that is not in the past.'),
    noChain: t('refusal.noChain', 'No approval chain is set up yet. Ask an administrator.'),
    sourceRequired: t('refusal.sourceRequired', 'Choose the warehouse the material leaves from.'),
    noDestination: t('refusal.noDestination', 'The work order’s project has no site, yard or staging location to deliver to.'),
    manyDestinations: t('refusal.manyDestinations', 'The work order’s project has several delivery locations. Ask the requester to name the one this goes to.'),
    notKeeper: t('refusal.notKeeper', 'You do not keep that warehouse, so you cannot send stock from it.'),
    notPending: t('refusal.notPending', 'This request is no longer waiting for approval.'),
    notDraft: t('refusal.notDraft', 'Only a draft can be changed.'),
    notAuthor: t('refusal.notAuthor', 'Only the person who raised the request can do this.'),
    workOrder: t('refusal.workOrder', 'Choose a work order you can see.'),
    standIn: t('refusal.standIn', 'This stand-in is not allowed: choose an active colleague and a valid date range.'),
    adminOnly: t('refusal.adminOnly', 'Only an administrator can do this.'),
    notPinned: t('refusal.notPinned', 'This step is pinned to another approver on this project.'),
    pinForbidden: t('refusal.pinForbidden', 'Only an administrator or the project\'s manager can pin an approval step.'),
    pinInvalid: t('refusal.pinInvalid', 'Choose an active member who holds this step\'s role.'),
    invalid: t('refusal.invalid', 'The request could not be saved. Check that each item appears once, that items counted in whole units have no fraction, and that quantities have at most three decimals.'),
    notFound: t('refusal.notFound', 'That request or person was not found. Reload the page and try again.'),
    destination: t('refusal.destination', 'Choose a delivery location that belongs to the work order’s project.'),
    unknown: t('refusal.unknown', 'That did not work. Try again.'),
  };
  return (err) => {
    const kind = materialRequestRefusal(err);
    // The server names the cut-off time and the earliest accepted date (FR-MRQ-014); say both.
    const m = kind === 'cutoff' ? /close at (\d{2}:\d{2}).*earliest date you can request is (\d{4}-\d{2}-\d{2})/.exec(String((err as { message?: unknown }).message)) : null;
    return m ? t('refusal.cutoffDated', 'Requests for tomorrow closed at {{time}}. The earliest date you can request is {{date}}.', { time: m[1], date: formatDay(m[2]) }) : copy[kind];
  };
}
