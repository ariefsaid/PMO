/**
 * db/erpSnapshots.ts (task 7.7): the read-only DAL over the three slice-7 snapshot tables. RLS-scoped
 * (org_id never sent); no write path — snapshots are machine-written by the sweep. Returns the
 * current-scope rows (single as_of — snapshot-replace keeps one snapshot_id per scope).
 *
 * RED until erpSnapshots.ts exists. Asserts: each read maps to camelCase, returns the current-scope
 * rows (single as_of), and is empty for a non-employing org (no snapshot rows).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const calls = { table: '' as string };
  let nextData: Record<string, unknown>[] | null = null;
  const builder = {
    select() { return builder; },
    order() { return builder; },
    then(resolve: (v: unknown) => unknown) {
      return resolve({ data: nextData, error: null });
    },
  };
  const from = vi.fn((table: string) => { calls.table = table; return builder; });
  return { from, calls, setData: (d: Record<string, unknown>[] | null) => { nextData = d; } };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { listActualsSnapshot, listApAgingSnapshot, listArAgingSnapshot } from './erpSnapshots';

beforeEach(() => { h.calls.table = ''; h.setData(null); h.from.mockClear(); });

describe('db/erpSnapshots — read-only snapshot DAL (task 7.7)', () => {
  it('listActualsSnapshot reads erp_actuals_snapshot + maps to camelCase', async () => {
    h.setData([
      { cost_center: 'Main - PSC', account: 'Cash - PSC', fiscal_year: '2026', debit: 50000, credit: 0, net: 50000, as_of: '2026-07-12T10:00:00Z', source_report: 'GL Entry', snapshot_id: 'snap-1', project_id: null },
    ]);
    const rows = await listActualsSnapshot();
    expect(h.calls.table).toBe('erp_actuals_snapshot');
    expect(rows).toEqual([
      { projectId: null, costCenter: 'Main - PSC', account: 'Cash - PSC', fiscalYear: '2026', debit: 50000, credit: 0, net: 50000, asOf: '2026-07-12T10:00:00Z', sourceReport: 'GL Entry', snapshotId: 'snap-1' },
    ]);
  });

  it('listActualsSnapshot returns the current scope only (single as_of — snapshot-replace keeps one snapshot_id)', async () => {
    h.setData([
      { cost_center: 'A', account: 'X', fiscal_year: '2026', debit: 1, credit: 0, net: 1, as_of: '2026-07-12T10:00:00Z', source_report: 'GL Entry', snapshot_id: 'snap-current', project_id: null },
      { cost_center: 'B', account: 'Y', fiscal_year: '2026', debit: 2, credit: 0, net: 2, as_of: '2026-07-12T10:00:00Z', source_report: 'GL Entry', snapshot_id: 'snap-current', project_id: null },
    ]);
    const rows = await listActualsSnapshot();
    expect(rows.map((r) => r.snapshotId)).toEqual(['snap-current', 'snap-current']); // one coherent snapshot
    expect(new Set(rows.map((r) => r.asOf)).size).toBe(1);
  });

  it('listApAgingSnapshot reads erp_ap_aging_snapshot + maps bucket/provenance cols to camelCase', async () => {
    h.setData([
      { party: 'Spike Supplier', party_type: 'Supplier', currency: 'IDR', total_outstanding: 75000, current: 0, b_0_30: 75000, b_31_60: 0, b_61_90: 0, b_90_plus: 0, range_labels: { range1: '0-30' }, report_date: '2026-07-12', ageing_based_on: 'Due Date', as_of: '2026-07-12T10:00:00Z', source_report: 'Accounts Payable', report_version: 'erpnext-15.94.3/frappe-15.96.0', snapshot_id: 'snap-1' },
    ]);
    const rows = await listApAgingSnapshot();
    expect(h.calls.table).toBe('erp_ap_aging_snapshot');
    expect(rows[0]).toEqual({
      party: 'Spike Supplier', partyType: 'Supplier', currency: 'IDR', totalOutstanding: 75000, current: 0,
      bucket0to30: 75000, bucket31to60: 0, bucket61to90: 0, bucketOver90: 0,
      rangeLabels: { range1: '0-30' }, reportDate: '2026-07-12', ageingBasedOn: 'Due Date',
      asOf: '2026-07-12T10:00:00Z', sourceReport: 'Accounts Payable', reportVersion: 'erpnext-15.94.3/frappe-15.96.0', snapshotId: 'snap-1',
    });
  });

  it('listArAgingSnapshot reads erp_ar_aging_snapshot', async () => {
    h.setData([
      { party: 'Cust A', party_type: 'Customer', currency: 'IDR', total_outstanding: 0, current: 0, b_0_30: 0, b_31_60: 0, b_61_90: 0, b_90_plus: 0, range_labels: null, report_date: null, ageing_based_on: null, as_of: '2026-07-12T10:00:00Z', source_report: 'Accounts Receivable', report_version: 'v', snapshot_id: 's' },
    ]);
    const rows = await listArAgingSnapshot();
    expect(h.calls.table).toBe('erp_ar_aging_snapshot');
    expect(rows[0]!.party).toBe('Cust A');
  });

  // task FIX-7 (Quality MINOR 5) — the latest-snapshot_id filter hardening: a concurrent double-sweep
  // race (delete of pass 2 racing the insert of pass 1) can leave rows from TWO snapshot_ids in the
  // table simultaneously. The read must not blindly trust "one snapshot_id per scope" — it filters to
  // only the MOST RECENT snapshot_id (the first row's, since the query already orders `created_at`
  // desc) so a stale generation's rows never mix into the rendered read.
  it('listActualsSnapshot filters out a stale snapshot_id when two generations coexist (concurrent-sweep race hardening)', async () => {
    h.setData([
      // Newest first (query orders created_at desc) — the CURRENT generation.
      { cost_center: 'A', account: 'X', fiscal_year: '2026', debit: 1, credit: 0, net: 1, as_of: '2026-07-13T10:00:00Z', source_report: 'GL Entry', snapshot_id: 'snap-new', project_id: null },
      // A STALE row left behind from a prior generation that a racing delete failed to clear.
      { cost_center: 'B', account: 'Y', fiscal_year: '2026', debit: 2, credit: 0, net: 2, as_of: '2026-07-12T10:00:00Z', source_report: 'GL Entry', snapshot_id: 'snap-old', project_id: null },
    ]);
    const rows = await listActualsSnapshot();
    expect(rows).toHaveLength(1);
    expect(rows[0].snapshotId).toBe('snap-new');
  });

  it('listApAgingSnapshot filters out a stale snapshot_id when two generations coexist', async () => {
    h.setData([
      { party: 'Fresh Co', party_type: 'Supplier', currency: 'USD', total_outstanding: 100, current: 100, b_0_30: 0, b_31_60: 0, b_61_90: 0, b_90_plus: 0, range_labels: null, report_date: '2026-07-13', ageing_based_on: 'Due Date', as_of: '2026-07-13T10:00:00Z', source_report: 'Accounts Payable', report_version: '15', snapshot_id: 'snap-new' },
      { party: 'Stale Co', party_type: 'Supplier', currency: 'USD', total_outstanding: 200, current: 200, b_0_30: 0, b_31_60: 0, b_61_90: 0, b_90_plus: 0, range_labels: null, report_date: '2026-07-12', ageing_based_on: 'Due Date', as_of: '2026-07-12T10:00:00Z', source_report: 'Accounts Payable', report_version: '15', snapshot_id: 'snap-old' },
    ]);
    const rows = await listApAgingSnapshot();
    expect(rows).toHaveLength(1);
    expect(rows[0].party).toBe('Fresh Co');
  });

  it('a non-employing org (no snapshot rows yet) returns [] — empty state, never throws', async () => {
    h.setData(null); // no rows
    expect(await listActualsSnapshot()).toEqual([]);
    expect(await listApAgingSnapshot()).toEqual([]);
    expect(await listArAgingSnapshot()).toEqual([]);
  });
});
