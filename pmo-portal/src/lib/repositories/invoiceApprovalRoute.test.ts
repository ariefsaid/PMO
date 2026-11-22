import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { invoiceApprovalRouteRepository } from './invoiceApprovalRoute';

beforeEach(() => h.rpc.mockReset());

describe('invoice approval route repository', () => {
  it('delegates to the DAL and returns the typed route', async () => {
    h.rpc.mockResolvedValue({
      data: { approvers: [{ id: 'u-1', name: 'Finance Three', role: 'Finance' }], route_kind: 'named' },
      error: null,
    });

    await expect(invoiceApprovalRouteRepository.get('inv-1')).resolves.toEqual({
      approvers: [{ id: 'u-1', name: 'Finance Three', role: 'Finance' }],
      routeKind: 'named',
    });
    expect(h.rpc).toHaveBeenCalledWith('get_invoice_approval_route', { p_invoice_id: 'inv-1' });
  });

  it('normalises a refusal to the shared AppError shape', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'not authorized', code: '42501' } });

    await expect(invoiceApprovalRouteRepository.get('inv-1')).rejects.toMatchObject({
      name: 'AppError',
      message: 'not authorized',
      code: '42501',
    });
  });
});
