import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { getOperationalWaitingRoute, mapOperationalWaitingRoute } from './operationalWaitingRoute';
import { AppError } from '@/src/lib/appError';

beforeEach(() => h.rpc.mockReset());

describe('operational waiting route DAL', () => {
  it('asks the one RPC for this kind and record, and never sends an organisation id', async () => {
    h.rpc.mockResolvedValue({ data: { approvers: [], route_kind: 'work_order_issue' }, error: null });

    await getOperationalWaitingRoute('work_order_issue', 'wo-1');

    expect(h.rpc).toHaveBeenCalledWith('get_operational_waiting_route', { p_kind: 'work_order_issue', p_record_id: 'wo-1' });
    expect(JSON.stringify(h.rpc.mock.calls)).not.toContain('org_id');
  });

  it('maps the named people and their real role values', async () => {
    h.rpc.mockResolvedValue({
      data: {
        approvers: [
          { id: 'u-1', name: 'Ani', role: 'Finance' },
          { id: 'u-2', name: 'Budi', role: 'Project Manager' },
        ],
        route_kind: 'work_order_issue',
      },
      error: null,
    });

    await expect(getOperationalWaitingRoute('work_order_issue', 'wo-1')).resolves.toEqual({
      approvers: [
        { id: 'u-1', name: 'Ani', role: 'Finance' },
        { id: 'u-2', name: 'Budi', role: 'Project Manager' },
      ],
      routeKind: 'work_order_issue',
    });
  });

  it('returns the same honest empty route for null, malformed and non-route payloads', () => {
    for (const data of [null, undefined, 'nope', { approvers: 'nope' }, {}]) {
      expect(mapOperationalWaitingRoute(data)).toEqual({ approvers: [], routeKind: null });
    }
  });

  it('drops malformed or repeated people rather than inventing them', () => {
    expect(mapOperationalWaitingRoute({
      approvers: [
        { id: 'u-1', name: 'Ani', role: 'Finance' },
        { id: 'u-1', name: 'Ani again', role: 'Finance' },
        { id: 'u-2', name: '', role: 'Admin' },
        { id: 'u-3', name: 'Budi' },
        'nope',
      ],
      route_kind: 'delivery_record',
    })).toEqual({ approvers: [{ id: 'u-1', name: 'Ani', role: 'Finance' }], routeKind: 'delivery_record' });
  });

  it('raises a code-bearing AppError when the read is refused', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'not authorized', code: '42501' } });

    const error = await getOperationalWaitingRoute('transfer_receipt', 't-1').catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('42501');
  });
});
