// T3 — procurement summary pure derivation helpers
import { describe, it, expect } from 'vitest';
import { summarizeProcurement, recentRequests } from './procurement-summary';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';

const makeRow = (
  id: string,
  status: string,
  total_value: number,
  created_at: string,
  currency = 'IDR',
): ProcurementWithRefs =>
  ({
    id,
    title: `Request ${id}`,
    code: `PR-${id}`,
    status,
    total_value,
    currency,
    project_id: 'proj1',
    created_at,
    vendor: null,
    requested_by: null,
    project: null,
    org_id: 'o1',
  }) as unknown as ProcurementWithRefs;

const rows: ProcurementWithRefs[] = [
  makeRow('a', 'Draft', 1000, '2026-01-01T00:00:00Z'),
  makeRow('b', 'Requested', 2000, '2026-01-02T00:00:00Z'),
  makeRow('c', 'Paid', 3000, '2026-01-03T00:00:00Z'),
  makeRow('d', 'Cancelled', 500, '2026-01-04T00:00:00Z'),
  makeRow('e', 'Rejected', 200, '2026-01-05T00:00:00Z'),
  makeRow('f', 'Ordered', 0, '2026-01-06T00:00:00Z'),
];

describe('T3 — summarizeProcurement', () => {
  it('FR-PFE-037 keeps request value separate from open commitment', () => {
    const row = { ...makeRow('g', 'Ordered', 1000, '2026-01-07T00:00:00Z'), open_commitment: 400 };
    const result = summarizeProcurement([row]);
    expect(result.requestValueByCurrency).toEqual([{ currency: 'IDR', amount: 1000 }]);
    expect(result.openCommitmentByCurrency).toEqual([{ currency: 'IDR', amount: 400 }]);
  });

  it('counts Open bucket: Draft + Requested + Approved + in-flight non-terminal statuses (T3)', () => {
    const result = summarizeProcurement(rows);
    // Open: Draft(a), Requested(b), Ordered(f) = 3
    expect(result.open).toBe(3);
  });

  it('counts Completed bucket: Paid statuses only (T3)', () => {
    const result = summarizeProcurement(rows);
    expect(result.completed).toBe(1); // Paid(c)
  });

  it('counts Closed bucket: Cancelled + Rejected (T3)', () => {
    const result = summarizeProcurement(rows);
    expect(result.closed).toBe(2); // Cancelled(d), Rejected(e)
  });

  it('request values include history while open commitments exclude Cancelled and Rejected rows (T3)', () => {
    const result = summarizeProcurement(rows);
    expect(result.requestValueByCurrency).toEqual([{ currency: 'IDR', amount: 6700 }]);
    // 1000 + 2000 + 3000 + 0 = 6000 (excludes d=500, e=200)
    expect(result.openCommitmentByCurrency).toEqual([{ currency: 'IDR', amount: 6000 }]);
  });

  it('counts every request status separately from active request count (T3 edge)', () => {
    const result = summarizeProcurement(rows);
    // 4 non-Cancelled/Rejected rows → count = 4
    expect(result.count).toBe(4);
    expect(result.totalCount).toBe(6);
  });

  it('keeps request values and commitments separated by native currency', () => {
    const mixed = [
      makeRow('idr', 'Ordered', 1_000, '2026-01-01T00:00:00Z', 'IDR'),
      { ...makeRow('usd', 'Requested', 25, '2026-01-02T00:00:00Z', 'USD'), open_commitment: 20 },
    ];
    const result = summarizeProcurement(mixed, 'IDR');
    expect(result.requestValueByCurrency).toEqual([
      { currency: 'IDR', amount: 1_000 }, { currency: 'USD', amount: 25 },
    ]);
    expect(result.openCommitmentByCurrency).toEqual([
      { currency: 'IDR', amount: 1_000 }, { currency: 'USD', amount: 20 },
    ]);
  });

  it('returns all zeros for empty rows (T3 edge)', () => {
    const result = summarizeProcurement([]);
    expect(result.open).toBe(0);
    expect(result.completed).toBe(0);
    expect(result.closed).toBe(0);
    expect(result.requestValueByCurrency).toEqual([]);
    expect(result.openCommitmentByCurrency).toEqual([]);
    expect(result.count).toBe(0);
    expect(result.totalCount).toBe(0);
  });
});

describe('T3 — recentRequests', () => {
  it('returns top N by created_at descending (T3)', () => {
    const result = recentRequests(rows, 3);
    expect(result).toHaveLength(3);
    // newest: e(2026-01-05), d(2026-01-04), f(2026-01-06)... wait — f is 06
    // order: f(06), e(05), d(04)
    expect(result[0].id).toBe('f');
    expect(result[1].id).toBe('e');
    expect(result[2].id).toBe('d');
  });

  it('caps at limit even when more rows available (T3)', () => {
    const result = recentRequests(rows, 2);
    expect(result).toHaveLength(2);
  });

  it('returns all when fewer than limit (T3 edge)', () => {
    const result = recentRequests(rows, 100);
    expect(result).toHaveLength(rows.length);
  });
});
