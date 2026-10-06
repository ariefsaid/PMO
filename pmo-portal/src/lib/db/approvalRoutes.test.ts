import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { getProcurementApprovalRoutes, attachApprovalRoutes } from './approvalRoutes';

const rpcRow = {
  procurement_id: 'p-req',
  route: 'project',
  reason: 'within_budget',
  approvers: [{ id: 'u-a', full_name: 'Ana Approver' }],
  request_amount: '400.00',
  line_budget: '1000.00',
  line_used: '0',
};

beforeEach(() => h.rpc.mockReset());

describe('AC-APR-035 approval-route DAL', () => {
  it('AC-APR-035: calls the RPC with the ids, maps rows, never sends org_id', async () => {
    h.rpc.mockResolvedValue({ data: [rpcRow], error: null });
    const out = await getProcurementApprovalRoutes(['p-req']);
    expect(h.rpc).toHaveBeenCalledWith('get_procurement_approval_routes', { p_ids: ['p-req'] });
    expect(JSON.stringify(h.rpc.mock.calls)).not.toContain('org_id');
    expect(out).toEqual([
      {
        procurementId: 'p-req',
        route: 'project',
        reason: 'within_budget',
        approvers: [{ id: 'u-a', fullName: 'Ana Approver' }],
        requestAmount: 400,
        lineBudget: 1000,
        lineUsed: 0,
      },
    ]);
  });

  it('AC-APR-035: no ids means no call', async () => {
    expect(await getProcurementApprovalRoutes([])).toEqual([]);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('AC-APR-035: attaches routes to Requested rows only, in one call', async () => {
    h.rpc.mockResolvedValue({ data: [rpcRow], error: null });
    const out = await attachApprovalRoutes([
      { id: 'p-req', status: 'Requested' },
      { id: 'p-draft', status: 'Draft' },
    ]);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith('get_procurement_approval_routes', { p_ids: ['p-req'] });
    expect(out[0].approvalRoute?.approvers[0].fullName).toBe('Ana Approver');
    expect(out[1].approvalRoute).toBeUndefined();
  });

  it('AC-APR-035: a failed read leaves rows unrouted (role-matrix fallback, FR-APR-035)', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'boom', code: 'XX000' } });
    const out = await attachApprovalRoutes([{ id: 'p-req', status: 'Requested' }]);
    expect(out[0].approvalRoute).toBeUndefined();
  });
});
