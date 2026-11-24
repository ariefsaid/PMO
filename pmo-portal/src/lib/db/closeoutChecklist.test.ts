import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const results: Record<string, { data: unknown; error: unknown }> = {};
  const calls: Array<[string, unknown[]]> = [];
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'is', 'not', 'gt', 'order', 'limit', 'maybeSingle']) {
      b[op] = (...a: unknown[]) => { calls.push([`${table}.${op}`, a]); return b; };
    }
    b.then = (resolve: (v: unknown) => unknown) => resolve(results[table] ?? { data: [], error: null });
    return b;
  };
  return { results, calls, from: vi.fn((t: string) => builder(t)), rpc: vi.fn() };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import {
  attachCloseoutItemDocument, completeCloseoutItem, getCloseoutTemplate, getWorkOrderCloser, listOpenCloseoutDue,
  listWorkOrderCloseoutItems, setCloseoutTemplate,
} from './closeoutChecklist';
import { AppError } from '@/src/lib/appError';

beforeEach(() => {
  h.rpc.mockReset();
  h.from.mockClear();
  h.calls.length = 0;
  for (const k of Object.keys(h.results)) delete h.results[k];
});

describe('close-out checklist DAL', () => {
  it('AC-WCO-001 the list is sent whole, in order, with each required flag', async () => {
    h.rpc.mockResolvedValue({ data: 2, error: null });
    await expect(setCloseoutTemplate([
      { name: 'Item one', required: true, targetDays: null },
      { name: 'Item two', required: false, targetDays: null },
    ])).resolves.toBe(2);
    expect(h.rpc).toHaveBeenCalledWith('set_closeout_checklist', {
      p_items: [{ name: 'Item one', required: true }, { name: 'Item two', required: false }],
    });
  });

  it('FR-CTD-001 a target is sent only when the item carries one, so older lists keep their exact payload', async () => {
    h.rpc.mockResolvedValue({ data: 2, error: null });
    await setCloseoutTemplate([
      { name: 'Item one', required: true, targetDays: 5 },
      { name: 'Item two', required: false, targetDays: null },
    ]);
    const payload = h.rpc.mock.calls[0][1] as { p_items: Array<Record<string, unknown>> };
    expect(payload.p_items).toEqual([{ name: 'Item one', required: true, target_days: 5 }, { name: 'Item two', required: false }]);
    expect(payload.p_items[1]).not.toHaveProperty('target_days');
  });

  it('FR-CTD-001 the template read carries each item’s target and reads an untargeted row as null', async () => {
    h.results.closeout_checklist_templates = {
      data: [
        { position: 1, name: 'Item one', required: true, target_days: 5 },
        { position: 2, name: 'Item two', required: false, target_days: null },
      ],
      error: null,
    };
    await expect(getCloseoutTemplate()).resolves.toEqual([
      { name: 'Item one', required: true, targetDays: 5 },
      { name: 'Item two', required: false, targetDays: null },
    ]);
    expect(h.calls).toContainEqual(['closeout_checklist_templates.select', ['position,name,required,target_days,owner_job_role']]);
  });

  it('AC-WCO-004 a refusal detail from the database becomes the error code the screen explains', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'complete the earlier close-out items first', code: '55000', details: 'item-out-of-order' } });
    const err = await completeCloseoutItem('i2', '2026-03-02').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('item-out-of-order');
    expect(h.rpc).toHaveBeenCalledWith('complete_closeout_item', { p_item: 'i2', p_done_on: '2026-03-02' });
  });

  it('FR-CTD-001 a refused target keeps the refusal code the screen explains', async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { message: 'COT_TARGET_DAYS: a target is a whole number of days from 1 to 365', code: '23514', details: 'item-target-invalid' },
    });
    const err = await setCloseoutTemplate([{ name: 'Item one', required: true, targetDays: 400 }]).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('item-target-invalid');
    expect((err as AppError).message).toContain('COT_TARGET_DAYS:');
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
    h.results.closeout_checklist_templates = { data: [{ position: 1, name: 'Item one', required: true, target_days: null }, { position: 2, name: 'Item two', required: false, target_days: null }], error: null };
    await expect(getCloseoutTemplate()).resolves.toEqual([
      { name: 'Item one', required: true, targetDays: null },
      { name: 'Item two', required: false, targetDays: null },
    ]);
    h.results.work_order_closeout_items = { data: [
      { id: 'i1', position: 1, name: 'Item one', required: true, started_on: '2026-03-01', done_on: '2026-03-04', document_id: 'd1', done_by: 'u1', target_days: 5, due_on: '2026-03-06', doer: { full_name: 'Dewi' } },
      { id: 'i2', position: 2, name: 'Item two', required: false, started_on: '2026-03-04', done_on: null, document_id: null, done_by: null, target_days: null, due_on: null, doer: null },
    ], error: null };
    const rows = await listWorkOrderCloseoutItems('w1');
    expect(rows[0]).toEqual({
      id: 'i1', position: 1, name: 'Item one', required: true, startedOn: '2026-03-01', doneOn: '2026-03-04',
      documentId: 'd1', doneBy: 'u1', doneByName: 'Dewi', targetDays: 5, dueOn: '2026-03-06',
    });
    expect(rows[1].doneByName).toBeNull();
    expect(rows[1].dueOn).toBeNull();
  });

  it('FR-CTD-009 the work-orders list reads open targeted items in ONE batch, on Issued work orders only', async () => {
    h.results.work_order_closeout_items = { data: [
      { id: 'c1', work_order_id: 'w1', due_on: '2026-11-01', done_on: null },
      { id: 'c2', work_order_id: 'w2', due_on: '2026-11-05', done_on: null },
    ], error: null };
    await expect(listOpenCloseoutDue()).resolves.toEqual([
      { workOrderId: 'w1', dueOn: '2026-11-01', doneOn: null },
      { workOrderId: 'w2', dueOn: '2026-11-05', doneOn: null },
    ]);
    expect(h.calls).toContainEqual(['work_order_closeout_items.is', ['done_on', null]]);
    expect(h.calls).toContainEqual(['work_order_closeout_items.not', ['due_on', 'is', null]]);
    expect(h.calls).toContainEqual(['work_order_closeout_items.eq', ['work_orders.status', 'Issued']]);
    // One page for the whole organisation: no per-work-order read.
    expect(h.calls.filter(([k]) => k === 'work_order_closeout_items.select')).toHaveLength(1);
    // Nothing about the organisation is sent from the client.
    for (const [, args] of h.calls) expect(JSON.stringify(args)).not.toContain('org_id');
  });

  it('FR-CTD-009 the batch read pages past the 1000-row cap rather than truncating the count', async () => {
    h.results.work_order_closeout_items = { data: [{ id: 'c1', work_order_id: 'w1', due_on: '2026-11-01', done_on: null }], error: null };
    await listOpenCloseoutDue();
    // A short page ends the scan, and the keyset cursor is the last id of the previous page.
    expect(h.calls).toContainEqual(['work_order_closeout_items.order', ['id', { ascending: true }]]);
    expect(h.calls).toContainEqual(['work_order_closeout_items.limit', [1000]]);
  });

  it('FR-WCO-021 reads when a work order was closed and the name of the closer', async () => {
    h.results.work_orders = { data: { closed_at: '2026-03-12T08:00:00Z', closer: { full_name: 'Budi PM' } }, error: null };
    await expect(getWorkOrderCloser('w1')).resolves.toEqual({ closedAt: '2026-03-12T08:00:00Z', closedByName: 'Budi PM' });
    h.results.work_orders = { data: null, error: null };
    await expect(getWorkOrderCloser('w1')).resolves.toBeNull();
  });
});
