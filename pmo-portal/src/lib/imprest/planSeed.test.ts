import { describe, it, expect } from 'vitest';
import { foldRequests, seedFromRequests } from './planSeed';

const row = (o: Record<string, unknown>) => ({ procurement_id: 'p1', pr_number: 'PR-1', title: 'T', status: 'Requested', budget_category: 'Materials', currency: 'IDR', request_total: 100,
  work_order_id: null, wo_number: null, wo_title: null, line_id: null, line_name: null, line_quantity: null, line_amount: null, ...o }) as never;

describe('AC-CAE-003 plan seed from open requests', () => {
  it('AC-CAE-003 folds a request line per row into one request with its lines', () => {
    const reqs = foldRequests([row({ line_id: 'a', line_name: 'X', line_quantity: 2, line_amount: 60 }), row({ line_id: 'b', line_name: 'Y', line_quantity: 1, line_amount: 40 })]);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].lines.map((l) => l.name)).toEqual(['X', 'Y']);
  });
  it('AC-CAE-003 sums per purpose in the float currency, to the cent, and counts what it leaves out', () => {
    const reqs = foldRequests([row({ procurement_id: 'a', request_total: 10.1 }), row({ procurement_id: 'b', request_total: 20.2 }),
      row({ procurement_id: 'c', currency: 'USD' }), row({ procurement_id: 'd', budget_category: null }), row({ procurement_id: 'e', request_total: null })]);
    expect(seedFromRequests(reqs, 'IDR')).toEqual({ lines: [{ category: 'Materials', amount: 30.3 }], skipped: 3 });
  });
  it('AC-CAE-003 rounds the exact purpose total to cents', () => {
    const reqs = foldRequests([row({ procurement_id: 'a', request_total: 1.005 }), row({ procurement_id: 'b', request_total: 0.005 })]);
    expect(seedFromRequests(reqs, 'IDR').lines).toEqual([{ category: 'Materials', amount: 1.01 }]);
  });
});
