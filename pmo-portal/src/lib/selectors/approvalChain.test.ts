import { describe, expect, it } from 'vitest';
import { expenseClaimApprovalChain, procurementApprovalChain } from './approvalChain';

const route = { route: 'project' as const, approvers: [{ id: 'a1', fullName: 'Rina Kartika' }] };

describe('procurement approval chain', () => {
  it('a waiting request: requester done when raised, the routed approver current since then', () => {
    const steps = procurementApprovalChain({
      status: 'Requested',
      created_at: '2026-11-01T08:00:00Z',
      requested_by: { full_name: 'Budi Santoso' },
      approvalRoute: route,
      statusEvents: [{ to_status: 'Requested', created_at: '2026-11-02T09:00:00Z', actor: { full_name: 'Budi Santoso' } }],
    });
    expect(steps).toEqual([
      { key: 'requested', role: 'requester', people: ['Budi Santoso'], state: 'done', at: '2026-11-02T09:00:00Z' },
      { key: 'approval', role: 'approver', people: ['Rina Kartika'], state: 'current', at: '2026-11-02T09:00:00Z' },
    ]);
  });

  it('only an Admin can decide: the current step names the Admin role', () => {
    const steps = procurementApprovalChain({ status: 'Requested', created_at: '2026-11-01T08:00:00Z', approvalRoute: { route: 'admin', approvers: [] } });
    expect(steps?.[1]).toMatchObject({ role: 'admin', state: 'current', people: [] });
  });

  it('an approved purchase: both steps done, the approver and date from the timeline', () => {
    const steps = procurementApprovalChain({
      status: 'Ordered',
      created_at: '2026-10-01T08:00:00Z',
      requested_by: { full_name: 'Budi Santoso' },
      statusEvents: [
        { to_status: 'Requested', created_at: '2026-10-02T08:00:00Z', actor: { full_name: 'Budi Santoso' } },
        { to_status: 'Approved', created_at: '2026-10-04T08:00:00Z', actor: { full_name: 'Rina Kartika' } },
      ],
    });
    expect(steps?.map((s) => [s.key, s.state, s.people, s.at])).toEqual([
      ['requested', 'done', ['Budi Santoso'], '2026-10-02T08:00:00Z'],
      ['approval', 'done', ['Rina Kartika'], '2026-10-04T08:00:00Z'],
    ]);
  });

  it('shows nothing when the route is unknown, the approval was never logged, or the purchase is not in approval', () => {
    expect(procurementApprovalChain({ status: 'Requested', created_at: '2026-11-01T08:00:00Z', approvalRoute: null })).toBeNull();
    expect(procurementApprovalChain({ status: 'Paid', created_at: '2026-11-01T08:00:00Z', approved_by: { full_name: 'Rina Kartika' }, statusEvents: [] })).toBeNull();
    expect(procurementApprovalChain({ status: 'Draft', created_at: '2026-11-01T08:00:00Z', approvalRoute: route })).toBeNull();
  });

  it('carries only who and when: never the amount basis, headroom or why the tier was chosen', () => {
    const steps = procurementApprovalChain({
      status: 'Requested',
      created_at: '2026-11-01T08:00:00Z',
      approvalRoute: { ...route, reason: 'exceeds_line', requestAmount: 9, lineBudget: 5, lineUsed: 4 } as typeof route,
    });
    expect(JSON.stringify(steps)).not.toMatch(/exceeds_line|lineBudget|requestAmount|lineUsed/);
  });
});

describe('expense claim approval chain', () => {
  it('a submitted claim: claimant done at submission, the route current', () => {
    const steps = expenseClaimApprovalChain(
      { status: 'Submitted', submitted_at: '2026-11-03T08:00:00Z', created_at: '2026-11-01T08:00:00Z', claimant: { full_name: 'Dewi Lestari' } },
      route,
    );
    expect(steps?.map((s) => [s.role, s.state, s.people, s.at])).toEqual([
      ['requester', 'done', ['Dewi Lestari'], '2026-11-03T08:00:00Z'],
      ['approver', 'current', ['Rina Kartika'], '2026-11-03T08:00:00Z'],
    ]);
  });

  it('shows nothing without a route or once the claim is decided', () => {
    const claim = { status: 'Submitted', created_at: '2026-11-01T08:00:00Z' };
    expect(expenseClaimApprovalChain(claim, null)).toBeNull();
    expect(expenseClaimApprovalChain({ ...claim, status: 'Approved' }, route)).toBeNull();
  });
});
