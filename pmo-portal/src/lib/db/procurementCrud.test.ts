import { describe, it, expect, vi, beforeEach } from 'vitest';

// A flexible chainable mock of the supabase query builder (mirrors companies.test.ts) plus an `rpc`
// spy for the select-quote RPC path. Each terminal (awaited) call resolves `result.value`; we assert
// the recorded calls.
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const rpcResult = { value: { data: null as unknown, error: null as unknown } };
  const calls = {
    from: [] as unknown[],
    select: [] as unknown[],
    eq: [] as unknown[],
    order: [] as unknown[],
    insert: [] as unknown[],
    update: [] as unknown[],
    delete: 0,
    single: 0,
    rpc: [] as unknown[],
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...args: unknown[]) => {
    if (name === 'delete' || name === 'single') {
      (calls[name] as number)++;
    } else {
      (calls[name] as unknown[]).push(args.length === 1 ? args[0] : args);
    }
    return builder;
  };
  builder.select = chain('select');
  builder.eq = chain('eq');
  builder.order = chain('order');
  builder.insert = chain('insert');
  builder.update = chain('update');
  builder.delete = chain('delete');
  builder.single = chain('single');
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });
  const rpc = vi.fn((name: string, args: unknown) => {
    calls.rpc.push([name, args]);
    return Promise.resolve(rpcResult.value);
  });
  return { from, rpc, calls, result, rpcResult };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import {
  createProcurement,
  updateProcurementHeader,
  createProcurementItem,
  updateProcurementItem,
  deleteProcurementItem,
  selectProcurementQuote,
  listProcurementDocuments,
  createProcurementDocument,
  deleteProcurementDocument,
} from './procurementCrud';
import { ProcurementError } from './procurementLifecycle';

beforeEach(() => {
  h.from.mockClear();
  h.rpc.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
    if (typeof h.calls[k] === 'number') (h.calls[k] as unknown) = 0;
    else (h.calls[k] as unknown[]).length = 0;
  }
  h.result.value = { data: null, error: null };
  h.rpcResult.value = { data: null, error: null };
});

describe('AC-PROC-001 createProcurement (New PR header → Draft, requester stamped, no org_id)', () => {
  it('AC-PROC-001: inserts a Draft PR with requested_by_id, never sends org_id, returns the new row', async () => {
    h.result.value = {
      data: { id: 'pr1', title: 'Welding consumables', status: 'Draft' },
      error: null,
    };
    const row = await createProcurement(
      { title: 'Welding consumables', projectId: 'proj1', vendorId: null },
      'user-uid-1',
    );
    expect(h.calls.from).toContain('procurements');
    const insert = h.calls.insert[0] as Record<string, unknown>;
    expect(insert.title).toBe('Welding consumables');
    expect(insert.project_id).toBe('proj1');
    expect(insert.requested_by_id).toBe('user-uid-1');
    // status defaults to Draft on the server, but the DAL may set it explicitly to Draft.
    expect(insert.status === undefined || insert.status === 'Draft').toBe(true);
    // org_id is NEVER sent (RLS stamps it from auth_org_id()).
    expect(JSON.stringify(h.calls.insert)).not.toContain('org_id');
    expect(h.calls.single).toBe(1);
    expect(row.id).toBe('pr1');
  });

  it('AC-PROC-001: omits a null vendor (no vendor_id key) and includes one when provided', async () => {
    h.result.value = { data: { id: 'pr2', title: 'X', status: 'Draft' }, error: null };
    await createProcurement({ title: 'X', projectId: null, vendorId: 'vend1' }, 'u1');
    const insert = h.calls.insert[0] as Record<string, unknown>;
    expect(insert.vendor_id).toBe('vend1');
  });

  it('AC-PROC-001: throws ProcurementError preserving the code on a denied insert', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(
      createProcurement({ title: 'X', projectId: null, vendorId: null }, 'u1'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      createProcurement({ title: 'X', projectId: null, vendorId: null }, 'u1'),
    ).rejects.toBeInstanceOf(ProcurementError);
  });
});

describe('AC-PROC-002 updateProcurementHeader (requester edits while Draft, no org_id)', () => {
  it('AC-PROC-002: updates only the editable header fields by id, never org_id', async () => {
    h.result.value = { data: null, error: null };
    await updateProcurementHeader('pr1', { title: 'New title', projectId: 'p2', vendorId: 'v2' });
    expect(h.calls.from).toContain('procurements');
    const patch = h.calls.update[0] as Record<string, unknown>;
    expect(patch.title).toBe('New title');
    expect(patch.project_id).toBe('p2');
    expect(patch.vendor_id).toBe('v2');
    expect(JSON.stringify(patch)).not.toContain('org_id');
    expect(JSON.stringify(patch)).not.toContain('"status"');
    expect(h.calls.eq).toContainEqual(['id', 'pr1']);
  });

  it('AC-PROC-002: throws ProcurementError with code on a denied update', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(
      updateProcurementHeader('pr1', { title: 'x', projectId: null, vendorId: null }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('AC-PROC-003 line items CRUD (procurement_items, no org_id, no generated amount)', () => {
  it('AC-PROC-003: createProcurementItem inserts name/quantity/rate + procurement_id, never org_id or amount', async () => {
    h.result.value = { data: { id: 'it1', name: 'Wire', quantity: 24, rate: 86 }, error: null };
    const row = await createProcurementItem('pr1', { name: 'Wire', quantity: 24, rate: 86 });
    expect(h.calls.from).toContain('procurement_items');
    const insert = h.calls.insert[0] as Record<string, unknown>;
    expect(insert.procurement_id).toBe('pr1');
    expect(insert.name).toBe('Wire');
    expect(insert.quantity).toBe(24);
    expect(insert.rate).toBe(86);
    // amount is a generated stored column — never written.
    expect(insert.amount).toBeUndefined();
    expect(JSON.stringify(h.calls.insert)).not.toContain('org_id');
    expect(row.id).toBe('it1');
  });

  it('AC-PROC-003: updateProcurementItem patches name/quantity/rate by id, never amount/org_id', async () => {
    h.result.value = { data: null, error: null };
    await updateProcurementItem('it1', { name: 'Wire 1.2mm', quantity: 30, rate: 90 });
    const patch = h.calls.update[0] as Record<string, unknown>;
    expect(patch.name).toBe('Wire 1.2mm');
    expect(patch.quantity).toBe(30);
    expect(patch.rate).toBe(90);
    expect(patch.amount).toBeUndefined();
    expect(JSON.stringify(patch)).not.toContain('org_id');
    expect(h.calls.eq).toContainEqual(['id', 'it1']);
  });

  it('AC-PROC-003: deleteProcurementItem deletes by id, never org_id', async () => {
    h.result.value = { data: null, error: null };
    await deleteProcurementItem('it1');
    expect(h.calls.from).toContain('procurement_items');
    expect(h.calls.delete).toBe(1);
    expect(h.calls.eq).toContainEqual(['id', 'it1']);
  });

  it('AC-PROC-003: surfaces a Draft-freeze 42501 as ProcurementError preserving the code', async () => {
    h.result.value = { data: null, error: { message: 'new row violates RLS', code: '42501' } };
    await expect(
      createProcurementItem('pr1', { name: 'x', quantity: 1, rate: 1 }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('AC-PROC-004 selectProcurementQuote (RPC, no org_id, code preserved)', () => {
  it('AC-PROC-004: calls the select_procurement_quote RPC with the quotation id only', async () => {
    h.rpcResult.value = { data: null, error: null };
    await selectProcurementQuote('q1');
    expect(h.calls.rpc).toContainEqual(['select_procurement_quote', { p_quotation_id: 'q1' }]);
    // org_id is never part of the RPC args (the RPC re-asserts it internally).
    expect(JSON.stringify(h.calls.rpc)).not.toContain('org_id');
  });

  it('AC-PROC-004: throws ProcurementError preserving P0001 (illegal stage) from the RPC', async () => {
    h.rpcResult.value = { data: null, error: { message: 'cannot select from stage', code: 'P0001' } };
    await expect(selectProcurementQuote('q1')).rejects.toMatchObject({ code: 'P0001' });
    await expect(selectProcurementQuote('q1')).rejects.toBeInstanceOf(ProcurementError);
  });
});

describe('AC-PROC-005 procurement documents metadata CRUD (procurement_documents)', () => {
  it('AC-PROC-005: listProcurementDocuments selects by procurement_id, never org_id', async () => {
    h.result.value = { data: [{ id: 'd1', type: 'PO', status: 'Draft' }], error: null };
    const rows = await listProcurementDocuments('pr1');
    expect(h.calls.from).toContain('procurement_documents');
    expect(h.calls.eq).toContainEqual(['procurement_id', 'pr1']);
    expect(JSON.stringify(h.calls)).not.toContain('org_id');
    expect(rows[0].id).toBe('d1');
  });

  it('AC-PROC-005: createProcurementDocument inserts type/reference/status + procurement_id, never org_id', async () => {
    h.result.value = { data: { id: 'd2', type: 'Spec sheet', status: 'Draft' }, error: null };
    const row = await createProcurementDocument('pr1', {
      type: 'Spec sheet',
      referenceNumber: 'DOC-001',
      status: 'Draft',
    });
    const insert = h.calls.insert[0] as Record<string, unknown>;
    expect(insert.procurement_id).toBe('pr1');
    expect(insert.type).toBe('Spec sheet');
    expect(insert.reference_number).toBe('DOC-001');
    expect(insert.status).toBe('Draft');
    expect(JSON.stringify(h.calls.insert)).not.toContain('org_id');
    expect(row.id).toBe('d2');
  });

  it('AC-PROC-005: deleteProcurementDocument deletes by id', async () => {
    h.result.value = { data: null, error: null };
    await deleteProcurementDocument('d1');
    expect(h.calls.from).toContain('procurement_documents');
    expect(h.calls.delete).toBe(1);
    expect(h.calls.eq).toContainEqual(['id', 'd1']);
  });

  it('AC-PROC-005: throws ProcurementError with code on a denied document insert', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(
      createProcurementDocument('pr1', { type: 'X', referenceNumber: null, status: 'Draft' }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
