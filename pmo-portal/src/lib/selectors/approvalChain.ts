/**
 * The approval chain for one record, built only from what the record screens already read: the record's own
 * requester, its approval route (who it waits on) and its status timeline (who approved, and when). It never carries
 * the amount basis, the budget headroom or the reason a tier was chosen. `null` = not readable, so no strip shows.
 */
import type { ApprovalRoute } from '@/src/lib/procurement/approvalRoute';

/** The step's part in the chain; `admin` = only an Admin can decide this one. */
export type ChainRole = 'requester' | 'approver' | 'admin';

export interface ChainStep {
  key: 'requested' | 'approval';
  role: ChainRole;
  /** Full names; the strip shows initials and keeps the name for the tooltip and screen readers. */
  people: string[];
  state: 'done' | 'current';
  /** Done: when it happened. Current: since when it has waited. */
  at: string;
}

type RouteLike = Pick<ApprovalRoute, 'route' | 'approvers'>;

interface StatusEventLike {
  to_status: string;
  created_at: string;
  actor?: { full_name: string | null } | null;
}

/** Statuses a purchase only reaches after its approval was given. */
const PAST_APPROVAL = new Set(['Approved', 'Vendor Quoted', 'Quote Selected', 'Ordered', 'Received', 'Vendor Invoiced', 'Paid']);

function latest(events: readonly StatusEventLike[] | null | undefined, to: string): StatusEventLike | undefined {
  return (events ?? [])
    .filter((e) => e.to_status === to)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
}

function waitingStep(route: RouteLike, since: string): ChainStep {
  return {
    key: 'approval',
    role: route.route === 'admin' ? 'admin' : 'approver',
    people: route.approvers.map((a) => a.fullName).filter(Boolean),
    state: 'current',
    at: since,
  };
}

export function procurementApprovalChain(p: {
  status: string;
  created_at: string;
  requested_by?: { full_name: string | null } | null;
  approved_by?: { full_name: string | null } | null;
  approvalRoute?: RouteLike | null;
  statusEvents?: readonly StatusEventLike[] | null;
}): ChainStep[] | null {
  const requestedEvent = latest(p.statusEvents, 'Requested');
  const requesterName = requestedEvent?.actor?.full_name ?? p.requested_by?.full_name ?? null;
  const requestedAt = requestedEvent?.created_at ?? p.created_at;
  const requested: ChainStep = {
    key: 'requested',
    role: 'requester',
    people: requesterName ? [requesterName] : [],
    state: 'done',
    at: requestedAt,
  };

  if (p.status === 'Requested') {
    return p.approvalRoute ? [requested, waitingStep(p.approvalRoute, requestedAt)] : null;
  }
  if (PAST_APPROVAL.has(p.status)) {
    const approvedEvent = latest(p.statusEvents, 'Approved');
    const approver = approvedEvent?.actor?.full_name ?? p.approved_by?.full_name ?? null;
    if (!approvedEvent || !approver) return null;
    return [requested, { key: 'approval', role: 'approver', people: [approver], state: 'done', at: approvedEvent.created_at }];
  }
  return null;
}

/**
 * An expense claim's chain while it waits: the claimant submitted it, the route names who decides. Once decided, the
 * claim screens do not read the approver's name, so a decided claim has no strip.
 */
export function expenseClaimApprovalChain(
  claim: { status: string; submitted_at?: string | null; created_at: string; claimant?: { full_name: string | null } | null },
  route: RouteLike | null | undefined,
): ChainStep[] | null {
  if (claim.status !== 'Submitted' || !route) return null;
  const since = claim.submitted_at ?? claim.created_at;
  const name = claim.claimant?.full_name ?? null;
  return [
    { key: 'requested', role: 'requester', people: name ? [name] : [], state: 'done', at: since },
    waitingStep(route, since),
  ];
}
