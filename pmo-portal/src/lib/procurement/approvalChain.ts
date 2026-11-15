import { ageInDays } from '@/src/lib/selectors/approvalUrgency';
import type { ApprovalRoute } from './approvalRoute';

/**
 * #2058 — who asked, who approved or decides next, and how long it has waited, read from what the
 * procurement detail already carries (its status-event log, `approved_by` and the approval route).
 * Display only, pure: no I/O, no React. `transition_procurement` stays the authority on who may decide.
 */
export interface ApprovalChainSource {
  status: string;
  created_at: string;
  requested_by: { full_name: string } | null;
  approved_by: { full_name: string } | null;
  approvalRoute?: Pick<ApprovalRoute, 'approvers'> | null;
  statusEvents: ReadonlyArray<{ to_status: string; created_at: string; actor?: { full_name?: string | null } | null }>;
}

export type ApprovalChainStep =
  | { kind: 'requested'; names: string[]; at: string }
  | { kind: 'approved'; names: string[]; at: string | null }
  | { kind: 'next'; names: string[]; waitingDays: number };

/** A chain exists from submission on; a return or cancellation without an approval ends it. */
const NO_CHAIN = new Set(['Draft', 'Rejected', 'Cancelled']);

function latest(events: ApprovalChainSource['statusEvents'], to: string) {
  return events
    .filter((event) => event.to_status === to)
    .reduce<ApprovalChainSource['statusEvents'][number] | null>((best, event) => (!best || event.created_at > best.created_at ? event : best), null);
}

const named = (name: string | null | undefined) => (name ? [name] : []);

export function approvalChain(source: ApprovalChainSource, now: Date = new Date()): ApprovalChainStep[] | null {
  if (NO_CHAIN.has(source.status)) return null;
  const submitted = latest(source.statusEvents, 'Requested');
  const requestedAt = submitted?.created_at ?? source.created_at;
  const requested: ApprovalChainStep = {
    kind: 'requested',
    names: named(source.requested_by?.full_name ?? submitted?.actor?.full_name),
    at: requestedAt,
  };
  if (source.status === 'Requested') {
    return [requested, {
      kind: 'next',
      names: (source.approvalRoute?.approvers ?? []).map((approver) => approver.fullName),
      waitingDays: ageInDays(requestedAt, now),
    }];
  }
  const approved = latest(source.statusEvents, 'Approved');
  return [requested, {
    kind: 'approved',
    names: named(approved?.actor?.full_name ?? source.approved_by?.full_name),
    at: approved?.created_at ?? null,
  }];
}
