import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { AppError } from '@/src/lib/appError';
import { getDsrValidationRoute, parseDsrValidationRoute } from './dsrValidationRoute';

beforeEach(() => { h.rpc.mockReset(); });

const routeBody = {
  approvers: [{ id: 'u-pm', name: 'Rina Wati', role: 'Project Manager' }],
  route_kind: 'project_manager',
};

describe('FR-WAIT-006 site report validation-route DAL', () => {
  it('reads ONE report by id through the invoker RPC, never sends org_id, and maps the route facts', async () => {
    h.rpc.mockResolvedValue({ data: routeBody, error: null });

    const route = await getDsrValidationRoute('r1');

    expect(h.rpc).toHaveBeenCalledWith('get_dsr_validation_route', { p_report_id: 'r1' });
    expect(JSON.stringify(h.rpc.mock.calls)).not.toContain('org_id');
    expect(route).toEqual({
      routeKind: 'project_manager',
      approvers: [{ id: 'u-pm', name: 'Rina Wati', role: 'Project Manager' }],
    });
  });

  it.each([
    ['finance_admin', 'the role-level Admin/Finance fallback'],
    ['nobody', 'a proven empty route'],
    ['unavailable', 'the non-leaking empty shape'],
  ])('accepts the honest empty route (%s) without inventing an approver', (kind) => {
    expect(parseDsrValidationRoute({ approvers: [], route_kind: kind })).toEqual({
      approvers: [], routeKind: kind,
    });
  });

  it('surfaces an RPC error as a code-bearing AppError (the screen can retry)', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'not authorized', code: '42501' } });

    await expect(getDsrValidationRoute('r1')).rejects.toMatchObject({
      name: 'AppError',
      message: 'not authorized',
      code: '42501',
    });
  });

  it.each([
    ['null body', null],
    ['array body', []],
    ['missing approvers', { route_kind: 'project_manager' }],
    ['approvers not an array', { approvers: {}, route_kind: 'project_manager' }],
    ['missing route kind', { approvers: [] }],
    ['unknown route kind', { approvers: [], route_kind: 'approved' }],
    ['approver without id', { approvers: [{ name: 'Rina', role: 'Project Manager' }], route_kind: 'project_manager' }],
    ['approver with blank name', { approvers: [{ id: 'u1', name: '  ', role: 'Project Manager' }], route_kind: 'project_manager' }],
  ])('rejects a malformed response (%s) instead of fabricating a route', (_label, body) => {
    expect(() => parseDsrValidationRoute(body)).toThrow(AppError);
    expect(() => parseDsrValidationRoute(body)).toThrow(/malformed/);
  });
});
