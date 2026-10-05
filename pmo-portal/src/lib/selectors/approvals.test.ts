import { describe, it, expect } from 'vitest';
import { pendingProcurementApprovals } from './approvals';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type { ApprovalRoute } from '@/src/lib/procurement/approvalRoute';

const routed = (ids: string[], kind: ApprovalRoute['route'] = 'project'): ApprovalRoute => ({
  procurementId: 'x',
  route: kind,
  reason: 'within_budget',
  approvers: ids.map((id) => ({ id, fullName: id })),
  requestAmount: 1,
  lineBudget: 10,
  lineUsed: 0,
});
const row = (id: string, approvalRoute?: ApprovalRoute, over: Record<string, unknown> = {}) =>
  ({ id, status: 'Requested', requested_by_id: 'u-req', approvalRoute, ...over }) as unknown as ProcurementWithRefs;

describe('AC-APR-032 awaiting-you respects approval routing', () => {
  it('AC-APR-032: keeps requests routed to me, flat, or unrouted; drops ones routed to someone else', () => {
    const list = [
      row('mine', routed(['u-me'])),
      row('theirs', routed(['u-other'])),
      row('flat', routed([], 'flat')),
      row('unrouted'),
    ];
    expect(pendingProcurementApprovals(list, 'u-me').map((r) => r.id)).toEqual(['mine', 'flat', 'unrouted']);
  });

  it('AC-APR-032: still drops my own requests (SoD-a) and non-Requested rows', () => {
    const list = [row('own', undefined, { requested_by_id: 'u-me' }), row('draft', undefined, { status: 'Draft' })];
    expect(pendingProcurementApprovals(list, 'u-me')).toEqual([]);
  });

  it('AC-APR-010: an admin-routed request awaits every Admin, and only Admins; Admins still skip named routes', () => {
    const list = [row('admin', routed([], 'admin')), row('theirs', routed(['u-other']))];
    expect(pendingProcurementApprovals(list, 'u-adm', true).map((r) => r.id)).toEqual(['admin']);
    expect(pendingProcurementApprovals(list, 'u-me', false)).toEqual([]);
  });
});
