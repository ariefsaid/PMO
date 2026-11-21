/** #2705 — the repository seam sends the position and the crew to ONE RPC, never an "inside" flag, and keeps error codes. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));
import { phoneCheckInRepository } from './phoneCheckIn';

beforeEach(() => vi.clearAllMocks());

describe('phoneCheckInRepository', () => {
  it('checkIn calls phone_check_in with the position and chosen crew only', async () => {
    h.rpc.mockResolvedValue({ data: { status: 'recorded', outcome: 'inside' }, error: null });
    const res = await phoneCheckInRepository.checkIn({ workOrderId: 'w1', crewId: 'c1', hours: 8, position: { lat: 1, lng: 2, accuracy: 9 } });
    expect(res.status).toBe('recorded');
    expect(h.rpc).toHaveBeenCalledWith('phone_check_in', { p_work_order_id: 'w1', p_crew_id: 'c1', p_lat: 1, p_lng: 2, p_accuracy: 9, p_hours: 8, p_no_position: false });
    expect(Object.keys(h.rpc.mock.calls[0][1])).not.toContain('p_inside');
  });
  it('a request without a position sends nulls and the no-position flag', async () => {
    h.rpc.mockResolvedValue({ data: { status: 'pending' }, error: null });
    await phoneCheckInRepository.checkIn({ workOrderId: 'w1', crewId: null, hours: 8, noPosition: true });
    expect(h.rpc).toHaveBeenCalledWith('phone_check_in', expect.objectContaining({ p_lat: null, p_lng: null, p_accuracy: null, p_no_position: true }));
  });
  it('decide sends the request, the decision and the reason; a refusal keeps its code', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'PCI_SELF: no', code: '42501' } });
    await expect(phoneCheckInRepository.decide('r1', false, 'not here')).rejects.toMatchObject({ code: '42501' });
    expect(h.rpc).toHaveBeenCalledWith('phone_check_in_decide', { p_request_id: 'r1', p_approve: false, p_reason: 'not here' });
  });
  it('requests returns an empty list when the database returns nothing', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    expect(await phoneCheckInRepository.requests()).toEqual([]);
  });
});
