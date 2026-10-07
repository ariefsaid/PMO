import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const eqCalls: Array<[string, unknown]> = [];
  const builder = () => {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: (column: string, value: unknown) => { eqCalls.push([column, value]); return b; },
      order: () => b,
      range: () => b,
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null }),
    });
    return b;
  };
  return { eqCalls, from: vi.fn(() => builder()) };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { listSalesInvoices } from './revenue';

beforeEach(() => { h.eqCalls.length = 0; });

describe('listSalesInvoices filters (#784)', () => {
  it('AC-NAR-002 the approvals queue reads only PMO drafts', async () => {
    await listSalesInvoices({ status: 'Draft', nativeOnly: true });
    expect(h.eqCalls).toEqual(expect.arrayContaining([['status', 'Draft'], ['pmo_native', true]]));
  });
  it('an unfiltered list adds no filter (the Sales Invoices page is unchanged)', async () => {
    await listSalesInvoices();
    expect(h.eqCalls).toEqual([]);
  });
});
