import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { AppError } from '@/src/lib/appError';
import { getTimesheetApprovalRoute, parseTimesheetApprovalRoute } from './timesheetApprovalRoute';

beforeEach(() => h.rpc.mockReset());

const routeBody = {
  approvers: [
    { id: 'u-manager', name: 'Ani Manager', role: 'line_manager' },
    { id: 'u-admin', name: 'Budi Admin', role: 'Admin' },
  ],
  route_kind: 'line_manager',
};

describe('FR-WAIT-006 timesheet approval-route DAL', () => {
  it('reads ONE sheet by id through the invoker RPC, never sends org_id, and maps the route facts', async () => {
    h.rpc.mockResolvedValue({ data: routeBody, error: null });

    const route = await getTimesheetApprovalRoute('ts-1');

    expect(h.rpc).toHaveBeenCalledWith('get_timesheet_approval_route', { p_timesheet_id: 'ts-1' });
    expect(JSON.stringify(h.rpc.mock.calls)).not.toContain('org_id');
    expect(route).toEqual({
      routeKind: 'line_manager',
      approvers: [
        { id: 'u-manager', name: 'Ani Manager', role: 'line_manager' },
        { id: 'u-admin', name: 'Budi Admin', role: 'Admin' },
      ],
    });
  });

  it('accepts the honest empty route (no approver named) without inventing one', () => {
    expect(parseTimesheetApprovalRoute({ approvers: [], route_kind: 'admin_executive' })).toEqual({
      approvers: [], routeKind: 'admin_executive',
    });
    expect(parseTimesheetApprovalRoute({ approvers: [], route_kind: 'unavailable' })).toEqual({
      approvers: [], routeKind: 'unavailable',
    });
  });

  it('accepts a valid blank server full_name (falls back in wording), never a permanent malformed error', () => {
    expect(parseTimesheetApprovalRoute({
      approvers: [{ id: 'u-admin', name: '   ', role: 'Admin' }],
      route_kind: 'admin_executive',
    })).toEqual({
      approvers: [{ id: 'u-admin', name: '', role: 'Admin' }],
      routeKind: 'admin_executive',
    });
  });

  it('surfaces an RPC error as a code-bearing AppError (the screen can retry)', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'not authorized', code: '42501' } });

    await expect(getTimesheetApprovalRoute('ts-1')).rejects.toMatchObject({
      name: 'AppError',
      message: 'not authorized',
      code: '42501',
    });
  });

  it.each([
    ['null body', null],
    ['array body', []],
    ['missing approvers', { route_kind: 'line_manager' }],
    ['approvers not an array', { approvers: {}, route_kind: 'line_manager' }],
    ['missing route kind', { approvers: [] }],
    ['unknown route kind', { approvers: [], route_kind: 'approved' }],
    ['approver without id', { approvers: [{ name: 'Ani', role: 'Admin' }], route_kind: 'admin_executive' }],
    ['approver with non-string name', { approvers: [{ id: 'u1', name: 42, role: 'Admin' }], route_kind: 'admin_executive' }],
    ['approver with blank role', { approvers: [{ id: 'u1', name: 'Ani', role: ' ' }], route_kind: 'admin_executive' }],
  ])('rejects a malformed response (%s) instead of fabricating a route', (_label, body) => {
    expect(() => parseTimesheetApprovalRoute(body)).toThrow(AppError);
    expect(() => parseTimesheetApprovalRoute(body)).toThrow(/malformed/);
  });
});
