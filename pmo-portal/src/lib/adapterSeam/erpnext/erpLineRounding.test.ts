import { describe, expect, it, vi } from 'vitest';
import { readErpPrecision, reshapeProgressLines, type ErpPrecision } from './erpLineRounding.ts';
import type { ErpClientDeps } from './client.ts';

const line = (quantity: string, rate: string, amount: string, label = 'Survey') => ({
  item: 'SURVEY', label, unit: 'km', quantity, rate, amount,
});
const P2: ErpPrecision = { float: 2, currency: 2 };
const P0: ErpPrecision = { float: 3, currency: 0 };

describe('AC-1820 progress-claim lines keep the signed amount', () => {
  it('reshapes 0.333 x 1,000.01 on a 2-decimal float site to 1 x the signed 333.00', () => {
    const [item] = reshapeProgressLines([line('0.333', '1000.01', '333.00')], P2, 'USD');
    expect(item).toMatchObject({ item_code: 'SURVEY', qty: 1, rate: 333 });
    expect(item.description).toBe('Survey (km): 0.333 x 1,000.01, rounded to $333.00');
  });

  it('leaves an exact line unchanged', () => {
    expect(reshapeProgressLines([line('4.000', '50000.00', '200000.00')], P2, 'USD'))
      .toEqual([{ item_code: 'SURVEY', qty: 4, rate: 50000, description: 'Survey (km)' }]);
  });

  it('reshapes only the lines that round away in a multi-line claim', () => {
    const items = reshapeProgressLines([
      line('4.000', '50000.00', '200000.00'),
      line('0.333', '1000.01', '333.00', 'Odd'),
      { item: 'DP', label: '', unit: '', quantity: 1, rate: -40000, amount: -40000 },
    ], P2, 'USD');
    expect(items.map((i) => [i.qty, i.rate])).toEqual([[4, 50000], [1, 333], [1, -40000]]);
  });

  it('reshapes a half-unit tie on a 0-decimal (IDR) site and keeps exact lines', () => {
    const items = reshapeProgressLines([line('2.5', '101', '253'), line('0.333', '1000', '333')], P0, 'IDR');
    expect(items.map((i) => [i.qty, i.rate])).toEqual([[1, 253], [0.333, 1000]]);
  });

  it('with unknown precision keeps only whole-rate, whole-amount lines with qty of at most 2 decimals', () => {
    const items = reshapeProgressLines([
      line('4.00', '50000.00', '200000.00'),
      line('0.333', '1000.00', '333.00'),
      line('2', '1000.50', '2001.00'),
      line('0.125', '1', '0.13'),
    ], null, 'USD');
    expect(items.map((i) => [i.qty, i.rate])).toEqual([[4, 50000], [1, 333], [1, 2001], [1, 0.13]]);
  });

  it('a 0-decimal site books 2 x 1,000.50 exactly as 1 x 2,001', () => {
    expect(reshapeProgressLines([line('2', '1000.50', '2001')], P0, 'IDR').map((i) => [i.qty, i.rate])).toEqual([[1, 2001]]);
  });

  it('refuses a signed amount with more decimals than the site holds', () => {
    expect(() => reshapeProgressLines([line('1', '133.30', '133.30')], P0, 'IDR'))
      .toThrow(expect.objectContaining({ code: 'commit-rejected' }));
  });

  it('a tie of 0.125 at 2 decimals is reshaped (banker and half-up disagree with the signed 0.13)', () => {
    expect(reshapeProgressLines([line('0.125', '1', '0.13')], P2, 'USD').map((i) => [i.qty, i.rate])).toEqual([[1, 0.13]]);
  });
});

describe('readErpPrecision', () => {
  const deps = (doc: unknown, status = 200) => ({
    baseUrl: 'https://erp.example.test', apiKey: 'k', apiSecret: 's',
    fetchImpl: vi.fn(async () => Response.json({ data: doc }, { status })),
  }) as unknown as ErpClientDeps;

  it('reads System Settings float and currency precision', async () => {
    expect(await readErpPrecision(deps({ float_precision: '2', currency_precision: '4', number_format: '#,###.##' })))
      .toEqual({ float: 2, currency: 4 });
  });
  it('treats an explicit 0 precision as unset, as Frappe does (cint(...) or fallback)', async () => {
    expect(await readErpPrecision(deps({ float_precision: '0', currency_precision: '0', number_format: '#,###.##' })))
      .toEqual({ float: 3, currency: 2 });
  });
  it('defaults float to 3 and derives currency precision from the number format', async () => {
    expect(await readErpPrecision(deps({ float_precision: '', currency_precision: '', number_format: '#.###' })))
      .toEqual({ float: 3, currency: 0 });
  });
  it('returns null when System Settings cannot be read', async () => {
    expect(await readErpPrecision(deps({}, 403))).toBeNull();
  });
});
