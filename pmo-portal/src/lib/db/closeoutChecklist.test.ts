import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const results: Record<string, { data: unknown; error: unknown }> = {};
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'order', 'limit']) b[op] = () => b;
    b.then = (resolve: (v: unknown) => unknown) => resolve(results[table] ?? { data: [], error: null });
    return b;
  };
  return { results, from: vi.fn((t: string) => builder(t)), rpc: vi.fn() };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import { attachCloseoutItemDocument, completeCloseoutItem, getCloseoutTemplate, listWorkOrderCloseoutItems, setCloseoutTemplate } from './closeoutChecklist';
import { AppError } from '@/src/lib/appError';

beforeEach(() => { h.rpc.mockReset(); for (const k of Object.keys(h.results)) delete h.results[k]; });

describe('close-out checklist DAL', () => {
  it('AC-WCO-001 the list is sent whole, in order, with each required flag', async () => {
    h.rpc.mockResolvedValue({ data: 2, error: null });
    await expect(setCloseoutTemplate([{ name: 'Item one', required: true }, { name: 'Item two', required: false }])).resolves.toBe(2);
    expect(h.rpc).toHaveBeenCalledWith('set_closeout_checklist', { p_items: [{ name: 'Item one', required: true }, { name: 'Item two', required: false }] });
  });

  it('AC-WCO-004 a refusal detail from the database becomes the error code the screen explains', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'complete the earlier close-out items first', code: '55000', details: 'item-out-of-order' } });
    const err = await completeCloseoutItem('i2', '2026-03-02').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('item-out-of-order');
    expect(h.rpc).toHaveBeenCalledWith('complete_closeout_item', { p_item: 'i2', p_done_on: '2026-03-02' });
  });

  it('AC-WCO-003 attaching sends the item and the document and nothing from the client about the organisation', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    await attachCloseoutItemDocument('i1', 'd1');
    expect(h.rpc).toHaveBeenCalledWith('attach_closeout_item_document', { p_item: 'i1', p_document: 'd1' });
  });

  it('a refusal without a named detail keeps the SQLSTATE as the code', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'denied', code: '42501', details: null } });
    const err = await attachCloseoutItemDocument('i1', 'd1').catch((e) => e);
    expect((err as AppError).code).toBe('42501');
  });

  it('reads the template and one work order checklist in order, with who marked each item done', async () => {
    h.results.closeout_checklist_templates = { data: [{ position: 1, name: 'Item one', required: true }, { position: 2, name: 'Item two', required: false }], error: null };
    await expect(getCloseoutTemplate()).resolves.toEqual([{ name: 'Item one', required: true }, { name: 'Item two', required: false }]);
    h.results.work_order_closeout_items = { data: [
      { id: 'i1', position: 1, name: 'Item one', required: true, started_on: '2026-03-01', done_on: '2026-03-04', document_id: 'd1', done_by: 'u1', doer: { full_name: 'Dewi' } },
      { id: 'i2', position: 2, name: 'Item two', required: false, started_on: '2026-03-04', done_on: null, document_id: null, done_by: null, doer: null },
    ], error: null };
    const rows = await listWorkOrderCloseoutItems('w1');
    expect(rows[0]).toEqual({ id: 'i1', position: 1, name: 'Item one', required: true, startedOn: '2026-03-01', doneOn: '2026-03-04', documentId: 'd1', doneBy: 'u1', doneByName: 'Dewi' });
    expect(rows[1].doneByName).toBeNull();
  });
});
