import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { AppError } from '@/src/lib/appError';
import { getInvoiceApprovalRoute, parseInvoiceApprovalRoute } from './invoiceApprovalRoute';

beforeEach(() => { h.rpc.mockReset(); });

const routeBody = {
  approvers: [
    { id: 'u-fin', name: 'Finance Three', role: 'Finance' },
    { id: 'u-admin', name: 'Admin Four', role: 'Admin' },
  ],
  route_kind: 'named',
};

describe('FR-WAIT-006 customer-invoice approval-route DAL', () => {
  it('reads ONE invoice by id through the invoker RPC, never sends org_id, and maps the route facts', async () => {
    h.rpc.mockResolvedValue({ data: routeBody, error: null });

    const route = await getInvoiceApprovalRoute('inv-1');

    expect(h.rpc).toHaveBeenCalledWith('get_invoice_approval_route', { p_invoice_id: 'inv-1' });
    expect(JSON.stringify(h.rpc.mock.calls)).not.toContain('org_id');
    expect(route).toEqual({
      routeKind: 'named',
      approvers: [
        { id: 'u-fin', name: 'Finance Three', role: 'Finance' },
        { id: 'u-admin', name: 'Admin Four', role: 'Admin' },
      ],
    });
  });

  it.each([
    ['nobody', 'a governed route whose only other candidates are ineligible'],
    ['missing_author', 'an invoice with no recorded author'],
    ['unavailable', 'the non-leaking empty shape'],
  ])('accepts the honest empty route (%s) without inventing an approver', (kind) => {
    expect(parseInvoiceApprovalRoute({ approvers: [], route_kind: kind })).toEqual({
      approvers: [], routeKind: kind,
    });
  });

  it('keeps a blank server name (the sentence falls back to the role word) but rejects a malformed approver', () => {
    expect(parseInvoiceApprovalRoute({
      approvers: [{ id: 'u-fin', name: '', role: 'Finance' }],
      route_kind: 'named',
    })).toEqual({ approvers: [{ id: 'u-fin', name: '', role: 'Finance' }], routeKind: 'named' });
  });

  it('surfaces an RPC error as a code-bearing AppError (the screen can retry)', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'not authorized', code: '42501' } });

    await expect(getInvoiceApprovalRoute('inv-1')).rejects.toMatchObject({
      name: 'AppError',
      message: 'not authorized',
      code: '42501',
    });
  });

  it.each([
    ['null body', null],
    ['array body', []],
    ['missing approvers', { route_kind: 'named' }],
    ['approvers not an array', { approvers: {}, route_kind: 'named' }],
    ['missing route kind', { approvers: [] }],
    ['unknown route kind', { approvers: [], route_kind: 'approved' }],
    ['approver without id', { approvers: [{ name: 'Finance Three', role: 'Finance' }], route_kind: 'named' }],
    ['approver without role', { approvers: [{ id: 'u1', name: 'Finance Three' }], route_kind: 'named' }],
    ['approver with blank id', { approvers: [{ id: '  ', name: 'Finance Three', role: 'Finance' }], route_kind: 'named' }],
  ])('rejects a malformed response (%s) instead of fabricating a route', (_label, body) => {
    expect(() => parseInvoiceApprovalRoute(body)).toThrow(AppError);
    expect(() => parseInvoiceApprovalRoute(body)).toThrow(/malformed/);
  });
});
