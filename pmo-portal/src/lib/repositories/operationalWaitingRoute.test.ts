import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { operationalWaitingRouteRepository } from './operationalWaitingRoute';

beforeEach(() => h.rpc.mockReset());

describe('operational waiting route repository', () => {
  it('delegates to the DAL and returns the typed route', async () => {
    h.rpc.mockResolvedValue({ data: { approvers: [{ id: 'u-1', name: 'Ani', role: 'Finance' }], route_kind: 'transfer_receipt' }, error: null });

    await expect(operationalWaitingRouteRepository.get('transfer_receipt', 't-1')).resolves.toEqual({
      approvers: [{ id: 'u-1', name: 'Ani', role: 'Finance' }],
      routeKind: 'transfer_receipt',
    });
    expect(h.rpc).toHaveBeenCalledWith('get_operational_waiting_route', { p_kind: 'transfer_receipt', p_record_id: 't-1' });
  });

  it('normalises a refusal to the shared AppError shape', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'not authorized', code: '42501' } });

    await expect(operationalWaitingRouteRepository.get('delivery_record', 'p-1')).rejects.toMatchObject({
      name: 'AppError',
      message: 'not authorized',
      code: '42501',
    });
  });
});
