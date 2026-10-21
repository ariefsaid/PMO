import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => {
  const result = { data: null as unknown, error: null as unknown };
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const thenable: Record<string, unknown> = { then: (resolve: (v: unknown) => unknown) => resolve(result) };
  for (const name of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'limit', 'single']) {
    chain[name] = vi.fn(() => thenable);
    thenable[name] = chain[name];
  }
  return { rpc: vi.fn(), from: vi.fn(() => thenable), chain, result };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: h.from } }));
import {
  confirmWorkOrderAcceptance, createWorkOrderLine, deleteWorkOrderLine, listProjectAcceptances, listWorkOrderLines,
  prepareWorkOrderAcceptance, updateWorkOrderLine, withdrawWorkOrderAcceptance,
} from './workOrderAcceptances';

beforeEach(() => {
  vi.clearAllMocks();
  h.result.data = null; h.result.error = null;
});

describe('work-order acceptance DAL', () => {
  it('AC-CQ-004 lists a project\'s acceptances with their lines, newest first, filtered by project', async () => {
    h.result.data = [{ id: 'a1', lines: [] }];
    expect(await listProjectAcceptances('p1')).toEqual([{ id: 'a1', lines: [] }]);
    expect(h.from).toHaveBeenCalledWith('work_order_acceptances');
    expect(h.chain.select).toHaveBeenCalledWith('*, lines:work_order_acceptance_lines(*)');
    expect(h.chain.eq).toHaveBeenCalledWith('project_id', 'p1');
    expect(h.chain.order.mock.calls).toEqual([['prepared_at', { ascending: false }], ['id', { ascending: false }]]);
  });

  it('AC-CQ-015 a saturated list is refused rather than silently truncated', async () => {
    h.result.data = Array.from({ length: 1000 }, (_, i) => ({ id: `a${i}`, lines: [] }));
    await expect(listProjectAcceptances('p1')).rejects.toMatchObject({ code: 'list-saturated' });
    h.result.data = Array.from({ length: 1000 }, (_, i) => ({ id: `l${i}` }));
    await expect(listWorkOrderLines('wo-1')).rejects.toMatchObject({ code: 'list-saturated' });
  });

  it('AC-CQ-002 lists the allocations of one work order', async () => {
    h.result.data = [{ id: 'l1' }];
    expect(await listWorkOrderLines('wo-1')).toEqual([{ id: 'l1' }]);
    expect(h.from).toHaveBeenCalledWith('work_order_lines');
    expect(h.chain.eq).toHaveBeenCalledWith('work_order_id', 'wo-1');
  });

  it('AC-CQ-002 an allocation insert sends the work order, line and quantity — never org_id', async () => {
    h.result.data = { id: 'l1' };
    await createWorkOrderLine({ workOrderId: 'wo-1', boqItemId: 'b1', quantity: 1000 });
    expect(h.chain.insert).toHaveBeenCalledWith({ work_order_id: 'wo-1', boq_item_id: 'b1', quantity: 1000 });
  });

  it('AC-CQ-002 an allocation update sends only the quantity and fails if no row landed', async () => {
    h.result.data = [{ id: 'l1' }];
    await updateWorkOrderLine('l1', 997.5);
    expect(h.chain.update).toHaveBeenCalledWith({ quantity: 997.5 });
    expect(h.chain.eq).toHaveBeenCalledWith('id', 'l1');
    h.result.data = [];
    await expect(updateWorkOrderLine('l1', 1)).rejects.toThrow(/permission/);
  });

  it('AC-CQ-002 deleting an allocation fails loudly when nothing was deleted, and surfaces the server code', async () => {
    h.result.data = [];
    await expect(deleteWorkOrderLine('l1')).rejects.toThrow(/permission/);
    h.result.data = null; h.result.error = { message: 'cannot reduce below accepted', code: '23514' };
    await expect(deleteWorkOrderLine('l1')).rejects.toMatchObject({ code: '23514', message: 'cannot reduce below accepted' });
  });

  it('AC-CQ-004 prepare sends exactly the named parameters and returns the acceptance id', async () => {
    h.rpc.mockResolvedValue({ data: 'acc-1', error: null });
    expect(await prepareWorkOrderAcceptance({
      workOrderId: 'wo-1', acceptanceDate: '2026-10-20', isFinal: true,
      lines: [{ boqItemId: 'b1', quantity: 997 }], documentId: 'doc-1', note: 'signed', acceptanceId: 'acc-0',
    })).toBe('acc-1');
    expect(h.rpc).toHaveBeenCalledWith('prepare_work_order_acceptance', {
      p_work_order_id: 'wo-1', p_acceptance_date: '2026-10-20', p_is_final: true,
      p_lines: [{ boq_item_id: 'b1', quantity: 997 }], p_document_id: 'doc-1', p_note: 'signed', p_acceptance_id: 'acc-0',
    });
  });

  it('AC-CQ-004 prepare omits the optional document, note and acceptance id when absent', async () => {
    h.rpc.mockResolvedValue({ data: 'acc-1', error: null });
    await prepareWorkOrderAcceptance({ workOrderId: 'wo-1', acceptanceDate: '2026-10-20', isFinal: false, lines: [], documentId: null, note: null });
    expect(h.rpc).toHaveBeenCalledWith('prepare_work_order_acceptance', {
      p_work_order_id: 'wo-1', p_acceptance_date: '2026-10-20', p_is_final: false, p_lines: [],
    });
  });

  it('AC-CQ-004 prepare surfaces a server refusal and never a fabricated id', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'work order is not Issued', code: 'P0001' } });
    await expect(prepareWorkOrderAcceptance({ workOrderId: 'w', acceptanceDate: '2026-10-20', isFinal: false, lines: [], documentId: null, note: null }))
      .rejects.toMatchObject({ code: 'P0001' });
    h.rpc.mockResolvedValue({ data: null, error: null });
    await expect(prepareWorkOrderAcceptance({ workOrderId: 'w', acceptanceDate: '2026-10-20', isFinal: false, lines: [], documentId: null, note: null }))
      .rejects.toMatchObject({ code: 'acceptance-malformed' });
  });

  it('AC-CQ-005 withdraw names the acceptance only', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    await withdrawWorkOrderAcceptance('acc-1');
    expect(h.rpc).toHaveBeenCalledWith('withdraw_work_order_acceptance', { p_id: 'acc-1' });
  });

  it('AC-CQ-006 confirm returns the closing value and DP held; a stage confirmation has a null closing value', async () => {
    h.rpc.mockResolvedValue({ data: { closing_value: '49850000.00', dp_held: 120000 }, error: null });
    expect(await confirmWorkOrderAcceptance('acc-1')).toEqual({ closingValue: 49_850_000, dpHeld: 120_000 });
    expect(h.rpc).toHaveBeenCalledWith('confirm_work_order_acceptance', { p_id: 'acc-1' });
    h.rpc.mockResolvedValue({ data: { closing_value: null, dp_held: 0 }, error: null });
    expect(await confirmWorkOrderAcceptance('acc-1')).toEqual({ closingValue: null, dpHeld: 0 });
  });

  it.each([
    ['no payload', null],
    ['missing dp_held', { closing_value: 1 }],
    ['null dp_held', { closing_value: 1, dp_held: null }],
    ['non-finite dp_held', { closing_value: 1, dp_held: 'Infinity' }],
    ['missing closing_value key', { dp_held: 0 }],
    ['non-numeric closing_value', { closing_value: 'abc', dp_held: 0 }],
  ])('AC-CQ-006 a malformed confirmation (%s) is an error, not a successful close', async (_name, data) => {
    h.rpc.mockResolvedValue({ data, error: null });
    await expect(confirmWorkOrderAcceptance('acc-1')).rejects.toMatchObject({ code: 'acceptance-malformed' });
  });

  it('AC-CQ-006 a refused confirmation surfaces the server code and message', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'closing value above order net', code: 'BW001' } });
    await expect(confirmWorkOrderAcceptance('acc-1')).rejects.toMatchObject({ code: 'BW001', message: 'closing value above order net' });
  });
});
