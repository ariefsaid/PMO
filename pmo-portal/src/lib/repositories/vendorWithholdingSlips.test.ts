import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Coverage batching semantics: deduplicated 100-ID RPC chunks, a small bounded pool (at most
 * three requests in flight), results concatenated in input chunk order regardless of completion
 * order, failure propagated without a partial success, and no request at all for an empty list.
 */
const h = vi.hoisted(() => ({ listBills: vi.fn() }));
vi.mock('@/src/lib/db/vendorWithholdingSlips', () => ({ listBills: h.listBills }));

import { vendorWithholdingSlipsRepository } from './vendorWithholdingSlips';

const row = (invoiceId: string) => ({ invoice_id: invoiceId }) as never;
const range = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}-${String(i).padStart(3, '0')}`);

beforeEach(() => {
  h.listBills.mockReset();
});

describe('vendor withholding bill coverage batching', () => {
  it('deduplicates invoice IDs into 100-ID chunks with at most three requests in flight', async () => {
    const unique = [...range('inv', 250)];
    let inFlight = 0;
    let maxInFlight = 0;
    h.listBills.mockImplementation(async ({ p_invoice_ids }: { p_invoice_ids: string[] }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      expect(p_invoice_ids.length).toBeLessThanOrEqual(100);
      return { rows: p_invoice_ids.map(row), nextCursor: null };
    });

    const out = await vendorWithholdingSlipsRepository.coverage([...unique, ...unique.slice(0, 50)]);

    expect(h.listBills).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBe(3);
    expect(h.listBills.mock.calls[0][0].limit).toBe(100);
    expect(out).toHaveLength(unique.length);
    expect(out.map((r) => (r as { invoice_id: string }).invoice_id)).toEqual(unique);
  });

  it('holds three requests before starting the fourth chunk and preserves input chunk order', async () => {
    const unique = range('pool', 401);
    const started: string[] = [];
    const pending = new Map<string, () => void>();
    let inFlight = 0;
    let peakInFlight = 0;
    let resolveFourthStarted!: () => void;
    let resolveFifthStarted!: () => void;
    const fourthStarted = new Promise<void>((resolve) => { resolveFourthStarted = resolve; });
    const fifthStarted = new Promise<void>((resolve) => { resolveFifthStarted = resolve; });

    h.listBills.mockImplementation(({ p_invoice_ids }: { p_invoice_ids: string[] }) => {
      const firstId = p_invoice_ids[0]!;
      started.push(firstId);
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      if (firstId === 'pool-300') resolveFourthStarted();
      if (firstId === 'pool-400') resolveFifthStarted();

      return new Promise((resolve) => {
        pending.set(firstId, () => {
          pending.delete(firstId);
          inFlight -= 1;
          resolve({ rows: p_invoice_ids.map(row), nextCursor: null });
        });
      });
    });

    const outPromise = vendorWithholdingSlipsRepository.coverage(unique);

    expect(started).toEqual(['pool-000', 'pool-100', 'pool-200']);
    expect(inFlight).toBe(3);
    expect(peakInFlight).toBe(3);

    const releaseFirst = pending.get('pool-000');
    expect(releaseFirst).toBeDefined();
    releaseFirst!();
    await fourthStarted;
    expect(started).toEqual(['pool-000', 'pool-100', 'pool-200', 'pool-300']);
    expect(inFlight).toBe(3);

    const releaseFourth = pending.get('pool-300');
    expect(releaseFourth).toBeDefined();
    releaseFourth!();
    await fifthStarted;
    expect(started).toEqual(['pool-000', 'pool-100', 'pool-200', 'pool-300', 'pool-400']);
    expect(inFlight).toBe(3);

    pending.get('pool-400')!();
    pending.get('pool-200')!();
    pending.get('pool-100')!();

    const out = await outPromise;
    expect(peakInFlight).toBeLessThanOrEqual(3);
    expect(peakInFlight).toBe(3);
    expect(inFlight).toBe(0);
    expect(out.map((r) => (r as { invoice_id: string }).invoice_id)).toEqual(unique);
  });

  it('propagates a chunk failure instead of resolving a partial success', async () => {
    h.listBills.mockImplementation(async ({ p_invoice_ids }: { p_invoice_ids: string[] }) => {
      if (p_invoice_ids[0]!.startsWith('b-')) throw new Error('coverage rpc failed');
      return { rows: p_invoice_ids.map(row), nextCursor: null };
    });

    await expect(vendorWithholdingSlipsRepository.coverage([...range('a', 100), ...range('b', 100)])).rejects.toBeInstanceOf(Error);
  });

  it('makes no request for an empty invoice list', async () => {
    await expect(vendorWithholdingSlipsRepository.coverage([])).resolves.toEqual([]);
    expect(h.listBills).not.toHaveBeenCalled();
  });
});
