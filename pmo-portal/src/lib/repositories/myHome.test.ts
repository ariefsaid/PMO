/** AC-LA-006/012 (#2710) — the repository seam over my_home and the seat report. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn(), update: vi.fn(), select: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    rpc: h.rpc,
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => h.select() }) }) }) }), update: (v: unknown) => ({ eq: (c: string, id: string) => ({ select: () => h.update(v, c, id) }) }) }),
  },
}));
import { myHomeRepository } from './myHome';

beforeEach(() => vi.clearAllMocks());

describe('myHomeRepository', () => {
  it('reads my_home and fills missing sections with empty lists', async () => {
    h.rpc.mockResolvedValue({ data: { today: '2026-11-21', tasks: [{ id: 't1' }] }, error: null });
    const home = await myHomeRepository.get();
    expect(h.rpc).toHaveBeenCalledWith('my_home');
    expect(home.tasks).toHaveLength(1);
    expect(home.work_orders).toEqual([]);
    expect(home.issues).toEqual([]);
  });
  it('keeps the database error code', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'nope', code: '42501' } });
    await expect(myHomeRepository.get()).rejects.toMatchObject({ code: '42501' });
  });
  it('sends only the status when a task is updated', async () => {
    h.update.mockResolvedValue({ data: [{ id: 't1' }], error: null });
    await myHomeRepository.setTaskStatus('t1', 'Done');
    expect(h.update).toHaveBeenCalledWith({ status: 'Done' }, 'id', 't1');
  });
  it('reports a task that is not found', async () => {
    h.update.mockResolvedValue({ data: [], error: null });
    await expect(myHomeRepository.setTaskStatus('t1', 'Done')).rejects.toBeTruthy();
  });
  it('#1122 deliveries are the Sent transfers named to the person, never one they sent themselves', async () => {
    h.select.mockResolvedValue({ data: [
      { id: 't1', number: 'TST-1', note: 'cement', sent_by: 'other', stock_transfer_lines: [{ id: 'l1' }, { id: 'l2' }] },
      { id: 't2', number: 'TST-2', note: null, sent_by: 'me', stock_transfer_lines: [{ id: 'l3' }] },
    ], error: null });
    await expect(myHomeRepository.deliveries('me')).resolves.toEqual([{ id: 't1', number: 'TST-1', description: 'cement', lineCount: 2 }]);
  });
  it('AC-LA-012 reads the seat split', async () => {
    h.rpc.mockResolvedValue({ data: { full: 4, light: 2, total: 6 }, error: null });
    await expect(myHomeRepository.seatReport()).resolves.toEqual({ full: 4, light: 2, total: 6 });
    expect(h.rpc).toHaveBeenCalledWith('org_seat_report');
  });
});
