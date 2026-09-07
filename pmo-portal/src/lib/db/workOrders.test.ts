import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * DAL tests for workOrders.ts (#566, migrations 0193 + 0197).
 *
 * The assertions that matter here are about the WRITE TOPOLOGY, not about plumbing: a body update
 * that ships `order_value` or a tax column is a `42501` the moment it reaches the server (0197 §5(a)
 * revoked all three from the client UPDATE grant), a create that ships `status` is refused by the
 * origination guard, and an over-commit acknowledgement attached to a Cancel is a `P0001`. Each of
 * those is asserted on the ARGUMENTS this module builds, because that is the layer that can get
 * them wrong.
 */
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const rpcResult = { value: { data: null as unknown, error: null as unknown } };
  const calls = {
    from: [] as string[],
    rpc: [] as Array<[string, unknown]>,
    insert: [] as unknown[],
    update: [] as unknown[],
    eq: [] as unknown[],
    order: [] as unknown[],
    select: 0,
    single: 0,
    maybeSingle: 0,
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...args: unknown[]) => {
    if (name === 'select' || name === 'single' || name === 'maybeSingle') {
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
  builder.single = chain('single');
  builder.maybeSingle = chain('maybeSingle');
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

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { from: h.from, rpc: h.rpc },
}));

import {
  listProjectWorkOrders,
  getWorkOrder,
  createWorkOrder,
  updateWorkOrder,
  setWorkOrderValue,
  transitionWorkOrder,
  getProjectDrawdown,
  isLegalWorkOrderTransition,
  isOverCommitmentRefusal,
  LEGAL_WORK_ORDER_TRANSITIONS,
  type WorkOrderInput,
} from './workOrders';
import { AppError } from '@/src/lib/appError';

const INPUT: WorkOrderInput = {
  title: 'Phase 1 fabrication',
  clientPoNumber: 'PO-9001',
  description: 'Client scope grant',
  orderValue: 500_000,
  taxTreatment: 'exclusive',
  taxAmount: 55_000,
  orderDate: '2026-08-01',
  startDate: '2026-08-05',
  endDate: '2026-09-30',
};

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

describe('reads', () => {
  it('lists a project’s work orders newest first, sending no org_id', async () => {
    h.result.value = { data: [{ id: 'wo-1' }], error: null };
    const rows = await listProjectWorkOrders('proj-1');
    expect(rows).toEqual([{ id: 'wo-1' }]);
    expect(h.calls.from).toEqual(['work_orders']);
    expect(h.calls.eq).toEqual([['project_id', 'proj-1']]);
    expect(h.calls.order).toEqual([['created_at', { ascending: false }]]);
    expect(JSON.stringify(h.calls)).not.toContain('org_id');
  });

  it('returns null for an unreadable work order rather than a fabricated row', async () => {
    h.result.value = { data: null, error: null };
    await expect(getWorkOrder('wo-1')).resolves.toBeNull();
    expect(h.calls.maybeSingle).toBe(1);
  });

  it('surfaces a read failure as an AppError carrying the Postgres code', async () => {
    h.result.value = { data: null, error: { message: 'boom', code: '42501' } };
    await expect(listProjectWorkOrders('proj-1')).rejects.toBeInstanceOf(AppError);
    await expect(listProjectWorkOrders('proj-1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('createWorkOrder', () => {
  it('sends the granted body only — never status, wo_number, org_id or any stamp', async () => {
    h.result.value = { data: { id: 'wo-new' }, error: null };
    await createWorkOrder('proj-1', INPUT);
    const body = h.calls.insert[0] as Record<string, unknown>;
    expect(body).toEqual({
      project_id: 'proj-1',
      title: 'Phase 1 fabrication',
      client_po_number: 'PO-9001',
      description: 'Client scope grant',
      order_value: 500_000,
      tax_treatment: 'exclusive',
      tax_amount: 55_000,
      order_date: '2026-08-01',
      start_date: '2026-08-05',
      end_date: '2026-09-30',
    });
    for (const forbidden of [
      'status',
      'wo_number',
      'org_id',
      'currency',
      'issued_by',
      'issued_at',
      'order_value_set_by',
      'order_value_set_at',
      'over_commit_ack_by',
      'over_commit_ack_at',
      'closed_at',
      'cancelled_at',
    ]) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });

  it('preserves the Postgres code so the UI can classify the refusal', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(createWorkOrder('proj-1', INPUT)).rejects.toMatchObject({ code: '42501' });
  });
});

describe('updateWorkOrder', () => {
  it('sends the body columns only — the value and its tax basis are NOT in the client grant', async () => {
    h.result.value = { data: [{ id: 'wo-1' }], error: null };
    await updateWorkOrder('wo-1', {
      title: 'Renamed',
      clientPoNumber: null,
      description: null,
      orderDate: null,
      startDate: null,
      endDate: null,
    });
    const body = h.calls.update[0] as Record<string, unknown>;
    expect(body).toEqual({
      title: 'Renamed',
      client_po_number: null,
      description: null,
      order_date: null,
      start_date: null,
      end_date: null,
    });
    // 0197 §5(a): these three left the client UPDATE grant when the tax basis became an input to
    // the over-commit control. Shipping them here would be a 42501 AND would bypass the witness.
    expect(body).not.toHaveProperty('order_value');
    expect(body).not.toHaveProperty('tax_treatment');
    expect(body).not.toHaveProperty('tax_amount');
    expect(body).not.toHaveProperty('status');
  });

  it('throws 42501 when the update matched no row (RLS or the post-Draft freeze)', async () => {
    h.result.value = { data: [], error: null };
    await expect(
      updateWorkOrder('wo-1', {
        title: 'x',
        clientPoNumber: null,
        description: null,
        orderDate: null,
        startDate: null,
        endDate: null,
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('setWorkOrderValue', () => {
  it('sends the value and its basis in ONE call to the sole witnessed writer', async () => {
    await setWorkOrderValue({
      id: 'wo-1',
      value: 400_000,
      taxTreatment: 'inclusive',
      taxAmount: 40_000,
    });
    expect(h.calls.rpc).toEqual([
      [
        'set_work_order_value',
        { p_id: 'wo-1', p_value: 400_000, p_tax_treatment: 'inclusive', p_tax_amount: 40_000 },
      ],
    ]);
  });

  it('sends a zero tax amount rather than omitting it — 0 is the "no tax" answer', async () => {
    await setWorkOrderValue({
      id: 'wo-1',
      value: 100,
      taxTreatment: 'exclusive',
      taxAmount: 0,
    });
    const args = h.calls.rpc[0][1] as Record<string, unknown>;
    expect(args.p_tax_amount).toBe(0);
  });

  it('preserves the RPC error code', async () => {
    h.rpcResult.value = { data: null, error: { message: 'frozen', code: '42501' } };
    await expect(
      setWorkOrderValue({ id: 'wo-1', value: 1, taxTreatment: 'exclusive', taxAmount: 0 }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('transitionWorkOrder', () => {
  it('omits the acknowledgement when the caller has none to make', async () => {
    await transitionWorkOrder('wo-1', 'Issued');
    const args = h.calls.rpc[0][1] as Record<string, unknown>;
    expect(args).toEqual({ p_id: 'wo-1', p_to: 'Issued', p_over_commit_ack: undefined });
  });

  it('sends the acknowledgement only when explicitly given', async () => {
    await transitionWorkOrder('wo-1', 'Issued', { overCommitAck: true });
    expect(h.calls.rpc[0][1]).toMatchObject({ p_over_commit_ack: true });
  });

  it('does not attach an acknowledgement to a cancel (the RPC refuses one there)', async () => {
    await transitionWorkOrder('wo-1', 'Cancelled');
    const args = h.calls.rpc[0][1] as Record<string, unknown>;
    expect(args.p_over_commit_ack).toBeUndefined();
  });
});

describe('getProjectDrawdown', () => {
  it('normalises every numeric and returns the basis the RPC states', async () => {
    h.rpcResult.value = {
      data: [{ committed: '500000.00', draft: '250000.00', ceiling: '900000.00', currency: 'IDR', basis: 'net' }],
      error: null,
    };
    await expect(getProjectDrawdown('proj-1')).resolves.toEqual({
      committed: 500_000,
      draft: 250_000,
      ceiling: 900_000,
      currency: 'IDR',
      basis: 'net',
    });
    expect(h.calls.rpc).toEqual([['get_project_drawdown', { p_project_id: 'proj-1' }]]);
  });

  it('returns null on zero rows instead of a plausible zero (an invisible project is not a $0 one)', async () => {
    h.rpcResult.value = { data: [], error: null };
    await expect(getProjectDrawdown('proj-1')).resolves.toBeNull();
  });

  it('preserves the RPC error code', async () => {
    h.rpcResult.value = { data: null, error: { message: 'nope', code: '42501' } };
    await expect(getProjectDrawdown('proj-1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('the transition map and the net conversion mirror the SQL', () => {
  it('matches transition_work_order’s v_legal literal, with both terminal states empty', () => {
    expect(LEGAL_WORK_ORDER_TRANSITIONS).toEqual({
      Draft: ['Issued', 'Cancelled'],
      Issued: ['Closed', 'Cancelled'],
      Closed: [],
      Cancelled: [],
    });
  });

  it('refuses a no-op and every move out of a terminal state', () => {
    expect(isLegalWorkOrderTransition('Draft', 'Issued')).toBe(true);
    expect(isLegalWorkOrderTransition('Draft', 'Closed')).toBe(false);
    expect(isLegalWorkOrderTransition('Draft', 'Draft')).toBe(false);
    expect(isLegalWorkOrderTransition('Closed', 'Cancelled')).toBe(false);
    expect(isLegalWorkOrderTransition('Cancelled', 'Issued')).toBe(false);
  });

});

describe('isOverCommitmentRefusal', () => {
  const REAL_MESSAGE =
    'issuing this work order would commit 1200000 against a contract ceiling of 1000000 ' +
    '(already committed: 900000): this is allowed, but it must be acknowledged explicitly — ' +
    're-issue with the over-commitment acknowledgement so the decision is recorded against your name';

  it('recognises the over-ceiling refusal, so the UI can offer the acknowledgement', () => {
    expect(isOverCommitmentRefusal(new AppError(REAL_MESSAGE, 'P0001'))).toBe(true);
  });

  it('does NOT claim an illegal transition is an over-commitment (same errcode, different refusal)', () => {
    expect(isOverCommitmentRefusal(new AppError('illegal transition Closed -> Issued', 'P0001'))).toBe(
      false,
    );
  });

  it('does NOT claim the "nothing to acknowledge" refusal is one either', () => {
    expect(
      isOverCommitmentRefusal(
        new AppError('there is no over-commitment to acknowledge: committing 10 leaves the contract ceiling of 100 intact', 'P0001'),
      ),
    ).toBe(false);
  });

  it('requires the errcode too — the phrase alone is not enough', () => {
    expect(isOverCommitmentRefusal(new AppError(REAL_MESSAGE, '42501'))).toBe(false);
    expect(isOverCommitmentRefusal(new Error(REAL_MESSAGE))).toBe(false);
  });

  it('is total over junk — null, a string and a bare object are all "not that refusal"', () => {
    expect(isOverCommitmentRefusal(null)).toBe(false);
    expect(isOverCommitmentRefusal('P0001')).toBe(false);
    expect(isOverCommitmentRefusal({ code: 'P0001' })).toBe(false);
  });
});
