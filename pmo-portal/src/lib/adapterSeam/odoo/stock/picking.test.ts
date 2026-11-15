import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindCall, OdooError, type OdooCall } from '../client.ts';
import { createFakeOdoo } from '../fakeOdoo.ts';
import { completeStockPicking, sendStockPicking, type SendStockPickingParams } from './picking.ts';

const KEY = 'stock:123e4567-e89b-12d3-a456-426614174000';
const LINES = [
  { productId: 101, quantity: 8 },
  { productId: 102, quantity: 3 },
];
const SEND: SendStockPickingParams = {
  anchorKey: KEY,
  companyId: 1,
  pickingTypeId: 2,
  lines: LINES,
  src: 10,
  dest: 20,
};

function setup(wrap?: (inner: OdooCall) => OdooCall) {
  const fake = createFakeOdoo({ key: 'k' });
  const raw = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', companyId: 1, fetchImpl: fake.fetch });
  const seen: Array<{ model: string; method: string; body: Record<string, unknown> }> = [];
  const traced: OdooCall = async <T>(model: string, method: string, body: Record<string, unknown> = {}) => {
    seen.push({ model, method, body });
    return raw<T>(model, method, body);
  };
  return { fake, call: wrap ? wrap(traced) : traced, seen };
}

const failing = (match: (model: string, method: string) => boolean, error: Error): ((inner: OdooCall) => OdooCall) =>
  (inner) => (async <T>(model: string, method: string, body?: Record<string, unknown>) => {
    if (match(model, method)) throw error;
    return inner<T>(model, method, body);
  }) as OdooCall;

afterEach(() => vi.useRealTimers());

describe('AC-OSP-002 sendStockPicking and completeStockPicking carry every line of a stock document', () => {
  it('AC-OSP-002 a two-line transfer loads both moves under one anchor and validates once', async () => {
    const { fake, call, seen } = setup();

    const sent = await sendStockPicking(call, SEND);
    expect(sent).toMatchObject({ outcome: 'sent' });
    if (sent.outcome !== 'sent') throw new Error('unreachable');

    const moves = fake.rows('stock.move').filter((m) => m.picking_id === sent.pickingId);
    expect(moves.map((m) => [m.product_id, m.product_uom_qty])).toEqual([[101, 8], [102, 3]]);
    expect(fake.rows('stock.picking')).toHaveLength(1);
    expect(fake.rows('ir.model.data')).toHaveLength(1);
    expect(seen.filter((c) => c.method === 'load')).toHaveLength(1);

    const done = await completeStockPicking(call, sent.pickingId, LINES);
    expect(done.outcome).toBe('validated');
    expect(seen.filter((c) => c.method === 'button_validate')).toHaveLength(1);
    expect(seen.filter((c) => c.method === 'write' && c.model === 'stock.move')).toHaveLength(2);
    expect(fake.rows('stock.picking')[0]).toMatchObject({ state: 'done' });
    expect(fake.rows('stock.move').map((m) => [m.product_id, m.quantity, m.state])).toEqual([[101, 8, 'done'], [102, 3, 'done']]);
  });

  it('AC-OSP-002 the picking carries the project and origin the caller names', async () => {
    const { fake, call } = setup();
    await sendStockPicking(call, { ...SEND, projectId: 55, origin: 'STK-1' });
    expect(fake.rows('stock.picking')[0]).toMatchObject({ project_id: 55, origin: 'STK-1' });
  });

  it('AC-OSP-002 load ids:false is a definitive failure with zero further calls', async () => {
    const { call, seen } = setup((inner) => (async <T>(model: string, method: string, body?: Record<string, unknown>) => {
      if (method === 'load') return { ids: false, messages: [{ message: 'database lock' }] } as T;
      return inner<T>(model, method, body);
    }) as OdooCall);

    const sent = await sendStockPicking(call, SEND);

    expect(sent).toMatchObject({ outcome: 'rejected', message: expect.stringContaining('database lock') });
    expect(seen).toHaveLength(0); // the wrapper answered load itself; nothing else reached Odoo
  });

  it('AC-OSP-002 a 4xx answer to load is a definitive failure', async () => {
    const { call } = setup(failing((_m, method) => method === 'load', new OdooError('validation', 422)));
    expect(await sendStockPicking(call, SEND)).toMatchObject({ outcome: 'rejected' });
  });
});

describe('AC-OSP-004 a call whose outcome is not known is never reported as failed', () => {
  it('AC-OSP-004 a thrown load is unknown, never failed', async () => {
    const { fake, call } = setup();
    fake.failAt('after-load');

    const sent = await sendStockPicking(call, SEND);

    expect(sent.outcome).toBe('unknown');
    expect(fake.rows('stock.picking')).toHaveLength(1); // Odoo kept it: the response is what was lost
  });

  it('AC-OSP-004 a transport failure or a 5xx on load is unknown', async () => {
    for (const error of [new Error('rpc network failure'), new OdooError('server-error', 500), new OdooError('unreachable')]) {
      const { call } = setup(failing((_m, method) => method === 'load', error));
      expect((await sendStockPicking(call, SEND)).outcome).toBe('unknown');
    }
  });

  it('AC-OSP-004 a failed quantity write or validate after load is unknown or held, never failed', async () => {
    for (const [method, model] of [['write', 'stock.move'], ['button_validate', 'stock.picking']] as const) {
      const { fake, call } = setup();
      const sent = await sendStockPicking(call, SEND);
      if (sent.outcome !== 'sent') throw new Error('unreachable');

      const transport = setup(failing((m, me) => m === model && me === method, new Error('connection dropped')));
      const sentT = await sendStockPicking(transport.call, SEND);
      if (sentT.outcome !== 'sent') throw new Error('unreachable');
      expect((await completeStockPicking(transport.call, sentT.pickingId, LINES)).outcome).toBe('unknown');

      const refused = setup(failing((m, me) => m === model && me === method, new OdooError('validation', 422)));
      const sentR = await sendStockPicking(refused.call, SEND);
      if (sentR.outcome !== 'sent') throw new Error('unreachable');
      expect((await completeStockPicking(refused.call, sentR.pickingId, LINES)).outcome).toBe('held');
      expect(fake.rows('stock.picking')).toHaveLength(1);
    }
  });

  it('AC-OSP-004 a lost validate response is unknown while Odoo has validated', async () => {
    const { fake, call } = setup();
    const sent = await sendStockPicking(call, SEND);
    if (sent.outcome !== 'sent') throw new Error('unreachable');
    fake.failAt('after-validate');

    expect((await completeStockPicking(call, sent.pickingId, LINES)).outcome).toBe('unknown');
    expect(fake.rows('stock.picking')[0]).toMatchObject({ state: 'done' });
  });

  it('AC-OSP-004 a failed or empty move lookup after load is unknown or held, never failed', async () => {
    const thrown = setup(failing((m, me) => m === 'stock.move' && me === 'search_read', new Error('search_read timeout')));
    const sentT = await sendStockPicking(thrown.call, SEND);
    if (sentT.outcome !== 'sent') throw new Error('unreachable');
    expect((await completeStockPicking(thrown.call, sentT.pickingId, LINES)).outcome).toBe('unknown');

    const empty = setup();
    const sentE = await sendStockPicking(empty.call, SEND);
    if (sentE.outcome !== 'sent') throw new Error('unreachable');
    expect((await completeStockPicking(empty.call, sentE.pickingId + 999, LINES)).outcome).toBe('held');
  });

  it('AC-OSP-004 moves that differ from the lines are held with no write', async () => {
    const { call, seen } = setup();
    const sent = await sendStockPicking(call, SEND);
    if (sent.outcome !== 'sent') throw new Error('unreachable');

    const result = await completeStockPicking(call, sent.pickingId, [{ productId: 101, quantity: 8 }, { productId: 999, quantity: 3 }]);

    expect(result.outcome).toBe('held');
    expect(seen.filter((c) => c.method === 'write' || c.method === 'button_validate')).toHaveLength(0);
  });

  it('AC-OSP-004 a move whose demanded quantity differs from the line is held with no write', async () => {
    const { call, seen } = setup();
    const sent = await sendStockPicking(call, SEND);
    if (sent.outcome !== 'sent') throw new Error('unreachable');

    const result = await completeStockPicking(call, sent.pickingId, [{ productId: 101, quantity: 9 }, { productId: 102, quantity: 3 }]);

    expect(result.outcome).toBe('held');
    expect(seen.filter((c) => c.method === 'write' || c.method === 'button_validate')).toHaveLength(0);
  });

  it('AC-OSP-004 a backorder wizard after load is held with no further call', async () => {
    const { call, seen } = setup((inner) => (async <T>(model: string, method: string, body?: Record<string, unknown>) => {
      if (method === 'button_validate') return { type: 'ir.actions.act_window', res_model: 'stock.backorder.confirmation' } as T;
      return inner<T>(model, method, body);
    }) as OdooCall);
    const sent = await sendStockPicking(call, SEND);
    if (sent.outcome !== 'sent') throw new Error('unreachable');
    const before = seen.length;

    const result = await completeStockPicking(call, sent.pickingId, LINES);

    expect(result).toMatchObject({ outcome: 'held', wizard: 'stock.backorder.confirmation' });
    expect(seen.slice(before).map((c) => c.method)).toEqual(['search_read', 'write', 'write']);
  });

  it('AC-OSP-004 an expired commit deadline stops before the next write', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { call, seen } = setup((inner) => (async <T>(model: string, method: string, body?: Record<string, unknown>) => {
      const out = await inner<T>(model, method, body);
      if (model === 'stock.move' && method === 'write') vi.setSystemTime(5_000);
      return out;
    }) as OdooCall);
    const sent = await sendStockPicking(call, { ...SEND, deadlineAtMs: 3_000 });
    if (sent.outcome !== 'sent') throw new Error('unreachable');

    const result = await completeStockPicking(call, sent.pickingId, LINES, 3_000);

    expect(result.outcome).toBe('unknown');
    expect(seen.filter((c) => c.model === 'stock.move' && c.method === 'write')).toHaveLength(1);
    expect(seen.filter((c) => c.method === 'button_validate')).toHaveLength(0);
  });

  it('AC-OSP-004 an expired deadline stops send before load', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000);
    const { call, seen } = setup();
    expect((await sendStockPicking(call, { ...SEND, deadlineAtMs: 3_000 })).outcome).toBe('unknown');
    expect(seen).toHaveLength(0);
  });
});
