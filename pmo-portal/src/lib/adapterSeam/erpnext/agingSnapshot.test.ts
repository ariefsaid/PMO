/**
 * erpnext/agingSnapshot.ts (task 7.4, FR-ENA-160/161/162, AC-ENA-061): refreshAging — the report-RPC
 * PRIMARY source (frappe.desk.query_report.run with the binding's pinned report_filter_shape) mirrors
 * the returned buckets + range_labels verbatim; on a report-shape failure the ONLY permitted fallback
 * buckets MIRRORED erp_payment_ledger_mirror rows (ERP ledger truth) by due_date age — NEVER
 * procurement_invoices due_date−today math (the FR-ENA-162 / ADR-0048 prohibition).
 *
 * RED until agingSnapshot.ts exists. Every ERP call is an injected fetchImpl (no bench needed); the
 * service client (mirror read + snapshot write) is a recording structural fake.
 */
import { describe, expect, it } from 'vitest';
import { refreshAging } from './agingSnapshot.ts';
import { FakePostgrest, type FakeRow } from '@/test/postgrestFake.ts';

/** Frappe query_report.run response shape (object-typed result rows + column labels/fieldnames). */
function reportResponse(rows: Record<string, unknown>[], columns?: { label: string; fieldname: string }[]): unknown {
  const cols = columns ?? [
    { label: 'Party', fieldname: 'party' },
    { label: 'Party Type', fieldname: 'party_type' },
    { label: 'Currency', fieldname: 'currency' },
    { label: 'Current', fieldname: 'current' },
    { label: '0-30', fieldname: 'range1' },
    { label: '31-60', fieldname: 'range2' },
    { label: '61-90', fieldname: 'range3' },
    { label: '91-120', fieldname: 'range4' },
    { label: 'Total', fieldname: 'total' },
  ];
  return { message: { columns: cols, result: rows } };
}

/**
 * Builds a recording service client on the PostgREST-FAITHFUL fake (`test/postgrestFake.ts`):
 * `erp_payment_ledger_mirror` select returns the seeded rows (CAPPED at `db-max-rows` exactly as
 * PostgREST caps them — see the MEDIUM-1 sibling block at the bottom of this file);
 * the AP/AR aging snapshots are published through the ATOMIC `replace_erp_snapshot` RPC and recorded
 * there. `tables` tracks every `from()` so the test can assert procurement_invoices is NEVER touched.
 */
function makeServiceClient(pleRows: Record<string, unknown>[]): {
  client: unknown; tables: string[]; inserted: Record<string, unknown>[][];
  /** ⚑ Audit round 10: direct deletes of a snapshot table — which must now be NONE (0142). */
  deleted: Record<string, string | null>[];
  replaces: { table: unknown; orgId: unknown }[];
  mirrorReads: { orderBy: string[]; cursors: unknown[]; returned: number }[];
} {
  // `erp_payment_ledger_mirror.id` is a NOT NULL uuid PK (0101 §2) — the paged scan's stable order.
  const seeded: FakeRow[] = pleRows.map((r, i) => ({ id: `ple-${String(i).padStart(8, '0')}`, ...r }));
  const fake = new FakePostgrest({
    erp_payment_ledger_mirror: seeded,
    erp_ap_aging_snapshot: [],
    erp_ar_aging_snapshot: [],
  });
  const snapshotTables = ['erp_ap_aging_snapshot', 'erp_ar_aging_snapshot'];
  return {
    client: {
      from: (table: string) => fake.from(table),
      rpc: (fn: string, args: Record<string, unknown>) => fake.rpc(fn, args),
    },
    get tables() { return fake.tablesTouched; },
    get inserted() {
      return fake.rpcCalls
        .filter((c) => c.fn === 'replace_erp_snapshot' && snapshotTables.includes(String(c.args.p_table)))
        .map((c) => (c.args.p_rows ?? []) as Record<string, unknown>[]);
    },
    get replaces() {
      return fake.rpcCalls
        .filter((c) => c.fn === 'replace_erp_snapshot')
        .map((c) => ({ table: c.args.p_table, orgId: c.args.p_org_id }));
    },
    get deleted() {
      return snapshotTables.flatMap((t) => (fake.deletedScopes[t] ?? []))
        .map((filters) => Object.fromEntries(filters.map((f) => [f.column, f.value as string | null])));
    },
    get mirrorReads() {
      return fake.reads.filter((r) => r.table === 'erp_payment_ledger_mirror').map((r) => ({
        orderBy: r.orderBy,
        cursors: r.filters.filter((f) => f.op === 'gt').map((f) => f.value),
        returned: r.returned,
      }));
    },
  };
}

function erpClient(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>): unknown {
  return { fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.com' };
}

const AP_SCOPE = {
  reportName: 'Accounts Payable' as const,
  snapshotTable: 'erp_ap_aging_snapshot' as const,
  filters: { company: 'PMO Smoke Co', report_date: '2026-07-12', ageing_based_on: 'Due Date', range1: 30, range2: 60, range3: 90, range4: 120 },
  reportVersion: 'erpnext-15.94.3/frappe-15.96.0',
  reportDate: '2026-07-12',
  ageingBasedOn: 'Due Date',
};

describe('erpnext/agingSnapshot — refreshAging PRIMARY (report RPC)', () => {
  it('AC-ENA-060/061 aggregates the PER-VOUCHER v15 report rows per party (outstanding-summed total, range5 folded into b_90_plus) + stamps source_report/report_version/range_labels', async () => {
    // The REAL pinned v15 detail-report row shape (bench notes, probed live 2026-07-13): one row PER
    // VOUCHER with `outstanding` + `range1..range5` — NO `total`, NO `current`, NO `outstanding_amount`.
    // The earlier fixture invented a per-party summary shape and masked a total_outstanding=0 +
    // dropped-range5 bug that only the live bench exposed (AC-ENA-061 bucket-reconciliation failure).
    const voucher = (over: Record<string, unknown>) => ({
      voucher_type: 'Purchase Invoice', party: 'Spike Supplier', party_type: 'Supplier', currency: 'IDR',
      outstanding: 0, range1: 0, range2: 0, range3: 0, range4: 0, range5: 0,
      total_due: 0, invoice_grand_total: 0, paid: 0, credit_note: 0, age: 0,
      ...over,
    });
    const reportCalls: Record<string, unknown>[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      reportCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify(reportResponse([
        voucher({ voucher_no: 'PINV-1', outstanding: 50000, range1: 50000 }),
        voucher({ voucher_no: 'PINV-2', outstanding: 30000, range3: 30000 }),
        // 121-Above lands in range5 — must fold into b_90_plus, never vanish
        voucher({ voucher_no: 'PINV-3', outstanding: 20000, range5: 20000 }),
        // FUTURE-due voucher (probed live: age<0, outstanding≠0, range1..5 ALL 0) — the unbucketed
        // leftover must land in `current`, or total ≠ buckets (Luna BLOCK 3)
        voucher({ voucher_no: 'PINV-5', outstanding: 10000, age: -35 }),
        voucher({ voucher_no: 'PINV-4', party: 'Other Supplier', outstanding: 7000, range2: 7000 }),
        // same party, DIFFERENT currency — must stay a separate row, never summed (Luna SHOULD-FIX 5)
        voucher({ voucher_no: 'PINV-6', party: 'Other Supplier', currency: 'USD', outstanding: 90, range1: 90 }),
        // a summary Total row — must be EXCLUDED (party 'Total' / null)
        { party: 'Total', party_type: null, currency: null, range1: 50000, range2: 7000, range3: 30000, range4: 0, range5: 20000 },
      ])), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const svc = makeServiceClient([]);
    await refreshAging(svc.client as never, erpClient(fetchImpl) as never, 'org-1', AP_SCOPE);

    // the report RPC was POSTed with the pinned report_name + filters (no inline get_script)
    expect(reportCalls[0]?.url).toContain('/api/method/frappe.desk.query_report.run');
    expect(reportCalls[0]?.body).toMatchObject({ report_name: 'Accounts Payable', filters: { company: 'PMO Smoke Co', ageing_based_on: 'Due Date' } });

    // ONE snapshot row per (party, currency) — 4 Spike vouchers aggregated; Other Supplier splits
    // into IDR + USD rows; Total row excluded
    expect(svc.inserted).toHaveLength(1);
    const rows = svc.inserted[0]! as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    const spike = rows.find((r) => r.party === 'Spike Supplier')!;
    expect(spike).toMatchObject({
      party: 'Spike Supplier', party_type: 'Supplier', currency: 'IDR',
      total_outstanding: 110000, current: 10000,
      b_0_30: 50000, b_31_60: 0, b_61_90: 30000, b_90_plus: 20000,
      source_report: 'Accounts Payable', report_version: 'erpnext-15.94.3/frappe-15.96.0',
      ageing_based_on: 'Due Date', report_date: '2026-07-12',
    });
    // the invariant the live bench enforces (AC-ENA-061): total reconciles with the buckets
    const bucketSum = Number(spike.current) + Number(spike.b_0_30) + Number(spike.b_31_60) + Number(spike.b_61_90) + Number(spike.b_90_plus);
    expect(Math.abs(Number(spike.total_outstanding) - bucketSum)).toBeLessThanOrEqual(0.01);
    expect(rows.find((r) => r.party === 'Other Supplier' && r.currency === 'IDR')).toMatchObject({ total_outstanding: 7000, b_31_60: 7000, current: 0 });
    expect(rows.find((r) => r.party === 'Other Supplier' && r.currency === 'USD')).toMatchObject({ total_outstanding: 90, b_0_30: 90, current: 0 });
    expect(spike.range_labels).toEqual({ range1: '0-30', range2: '31-60', range3: '61-90', range4: '91-Above' });
    expect(typeof spike.snapshot_id).toBe('string');
  });

  it('on the primary path the mirrored-ledger fallback is NOT consulted (erp_payment_ledger_mirror is not read)', async () => {
    const fetchImpl = async () => new Response(JSON.stringify(reportResponse([{ party: 'X', party_type: 'Supplier', currency: 'IDR', current: 1, range1: 0, range2: 0, range3: 0, range4: 0, total: 1 }])), { status: 200 });
    const svc = makeServiceClient([]);
    await refreshAging(svc.client as never, erpClient(fetchImpl) as never, 'org-1', AP_SCOPE);
    expect(svc.tables).not.toContain('erp_payment_ledger_mirror');
    expect(svc.tables).not.toContain('procurement_invoices');
  });
});

describe('erpnext/agingSnapshot — refreshAging FALLBACK (mirrored-ledger bucketing)', () => {
  it('AC-ENA-162 when the report RPC rejects, buckets MIRRORED erp_payment_ledger_mirror rows by due_date age (NEVER procurement_invoices)', async () => {
    const today = '2026-07-12';
    const fetchImpl = async () => new Response(JSON.stringify({ exc_type: 'DoesNotExistError', _server_messages: '[]' }), { status: 404 }); // report-shape rejection
    // PLE rows: party A owes 50000 due in 10 days (current-ish, age 0-30 -> range1 since not yet due? age=-... )
    // Use due_dates that produce a clear bucket each:
    const pleRows = [
      { party: 'Supplier A', party_type: 'Supplier', account: 'Creditors - PSC', amount: 50000, due_date: '2026-07-22', posting_date: '2026-07-01' }, // age (today-due) = -10 -> not yet due -> current
      { party: 'Supplier A', party_type: 'Supplier', account: 'Creditors - PSC', amount: 30000, due_date: '2026-06-20', posting_date: '2026-06-01' }, // age 22 -> 0-30 -> range1
      { party: 'Supplier B', party_type: 'Supplier', account: 'Creditors - PSC', amount: 80000, due_date: '2026-05-10', posting_date: '2026-05-01' }, // age 63 -> 61-90 -> range3
    ];
    const svc = makeServiceClient(pleRows);
    await refreshAging(svc.client as never, erpClient(fetchImpl) as never, 'org-1', { ...AP_SCOPE, today });

    expect(svc.tables).toContain('erp_payment_ledger_mirror');
    expect(svc.tables).not.toContain('procurement_invoices'); // the prohibition
    expect(svc.inserted).toHaveLength(1);
    const byParty = Object.fromEntries(svc.inserted[0]!.map((r) => [r.party, r]));
    // Supplier A: current 50000 (not yet due), range1(b_0_30) 30000, total 80000
    expect(byParty['Supplier A']).toMatchObject({ current: 50000, b_0_30: 30000, b_31_60: 0, b_61_90: 0, b_90_plus: 0, total_outstanding: 80000 });
    // Supplier B: range3(b_61_90) 80000, total 80000
    expect(byParty['Supplier B']).toMatchObject({ current: 0, b_0_30: 0, b_31_60: 0, b_61_90: 80000, b_90_plus: 0, total_outstanding: 80000 });
    // source_report marks the fallback origin
    expect(byParty['Supplier A'].source_report).toBe('Accounts Payable (mirrored-ledger fallback)');
  });

  /**
   * ⚑ HIGH-1 (Luna audit round 10) — the aging half of the non-atomic snapshot-replace. This used to
   * be `await delete()` then `await insert()`, so two overlapping sweep passes could leave TWO
   * generations of AP/AR aging in the table, and a reader landing in between saw NONE. Publishing is
   * now one `replace_erp_snapshot` statement (0150), and the falsifier is that no direct delete of a
   * snapshot table happens at all — that being the only way to reopen the window.
   */
  it('fallback publishes the scope in ONE atomic replace (no separate delete; single snapshot_id)', async () => {
    const fetchImpl = async () => new Response('{"exc_type":"X"}', { status: 404 });
    const svc = makeServiceClient([{ party: 'S', party_type: 'Supplier', account: 'C', amount: 1, due_date: '2026-07-12', posting_date: '2026-07-12' }]);
    await refreshAging(svc.client as never, erpClient(fetchImpl) as never, 'org-1', AP_SCOPE);
    expect(svc.deleted).toEqual([]);
    expect(svc.replaces).toEqual([{ table: 'erp_ap_aging_snapshot', orgId: 'org-1' }]);
    const ids = new Set(svc.inserted[0]!.map((r) => r.snapshot_id));
    expect(ids.size).toBe(1);
  });

  it('does not send org_id on the payload rows — the definer stamps the tenant (0142)', async () => {
    const fetchImpl = async () => new Response('{"exc_type":"X"}', { status: 404 });
    const svc = makeServiceClient([{ party: 'S', party_type: 'Supplier', account: 'C', amount: 1, due_date: '2026-07-12', posting_date: '2026-07-12' }]);
    await refreshAging(svc.client as never, erpClient(fetchImpl) as never, 'org-1', AP_SCOPE);
    expect(svc.inserted[0]!.every((r) => !('org_id' in r))).toBe(true);
  });
});

describe('erpnext/agingSnapshot — refreshAging edge', () => {
  it('a report with zero party rows still snapshot-replaces (scope cleared, empty insert)', async () => {
    const fetchImpl = async () => new Response(JSON.stringify(reportResponse([])), { status: 200 });
    const svc = makeServiceClient([]);
    await refreshAging(svc.client as never, erpClient(fetchImpl) as never, 'org-1', AP_SCOPE);
    expect(svc.replaces).toHaveLength(1);
    expect(svc.inserted[0]).toEqual([]);
  });

  it('propagates when the mirrored-ledger read itself fails (fallback read error surfaces, never swallowed)', async () => {
    const fetchImpl = async () => new Response('{"exc_type":"X"}', { status: 404 });
    // A PostgREST-shaped read failure on the fallback source. It must PROPAGATE — a swallowed error
    // would bucket zero rows and then snapshot-replace real aging with an all-zero, dated figure.
    const fake = new FakePostgrest(
      { erp_payment_ledger_mirror: [], erp_ap_aging_snapshot: [{ total_outstanding: 999 }] },
      { readErrors: { erp_payment_ledger_mirror: { message: 'ple read down', code: '08006' } } },
    );
    await expect(refreshAging(fake as never, erpClient(fetchImpl) as never, 'org-1', AP_SCOPE)).rejects.toThrow('ple read down');
    // ...and the prior snapshot is untouched (fail-closed: never replace good aging with nothing).
    expect(fake.rowsOf('erp_ap_aging_snapshot')).toEqual([{ total_outstanding: 999 }]);
  });
});

/**
 * ⚑ MEDIUM-1 sibling (Luna audit round 8, 2026-07-22) — the SAME silently-truncated-read class, at
 * the aging fallback's scope. `bucketFromMirror` read the whole `erp_payment_ledger_mirror` in ONE
 * unpaged request; PostgREST caps at `db-max-rows` (1000) and says nothing, so past 1000 mirrored
 * Payment Ledger Entries the AP/AR aging buckets understated every party's open balance — and, like
 * the actuals snapshot, stored the shortfall as a dated, provenance-stamped figure that no screen
 * could tell from the truth. The class is fixed at ALL its scopes or it is not fixed.
 */
describe('erpnext/agingSnapshot — the fallback mirror read is PAGED past PostgREST max_rows', () => {
  const today = '2026-07-12';

  it('buckets EVERY mirrored PLE row, not the first 1000 PostgREST chose to return', async () => {
    const fetchImpl = async () => new Response('{"exc_type":"X"}', { status: 404 }); // force the fallback
    const rows: Record<string, unknown>[] = [];
    let expectedTotal = 0;
    for (let i = 0; i < 2500; i += 1) {
      const amount = 10 + i;
      expectedTotal += amount;
      rows.push({ party: 'Supplier A', party_type: 'Supplier', account: 'Creditors - PSC', amount, due_date: '2026-06-20', posting_date: '2026-06-01' });
    }
    const svc = makeServiceClient(rows);
    await refreshAging(svc.client as never, erpClient(fetchImpl) as never, 'org-1', { ...AP_SCOPE, today });

    const supplierA = svc.inserted[0]!.find((r) => r.party === 'Supplier A')!;
    expect(supplierA.total_outstanding).toBe(expectedTotal);
    expect(supplierA.b_0_30).toBe(expectedTotal); // age 22 ⇒ every row lands in the 0-30 bucket
    // Paged + ordered: 1000 + 1000 + 500, every request bounded, every request on a total order.
    expect(svc.mirrorReads.map((r) => r.returned)).toEqual([1000, 1000, 500]);
    expect(svc.mirrorReads.every((r) => r.orderBy.includes('id'))).toBe(true);
    expect(svc.mirrorReads.map((r) => r.cursors)).toEqual([[], ['ple-00000999'], ['ple-00001999']]);
  });
});
