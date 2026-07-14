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

/** Builds a recording service client: erp_payment_ledger_mirror select returns the seeded rows;
 *  erp_ap_aging_snapshot / erp_ar_aging_snapshot record delete + insert. Tables list tracks every
 *  from() so the test can assert procurement_invoices is NEVER touched. */
function makeServiceClient(pleRows: Record<string, unknown>[]): { client: unknown; tables: string[]; inserted: Record<string, unknown>[][]; deleted: Record<string, string|null>[] } {
  const tables: string[] = [];
  const inserted: Record<string, unknown>[][] = [];
  const deleted: Record<string, string | null>[] = [];
  /** A typed chainable-thenable mock builder: `.eq()` returns self; `await` resolves to `value`. */
  interface Chain<T> { eq(): Chain<T>; then<U>(onfulfilled: (v: T) => U | PromiseLike<U>): Promise<U>; }
  const chain = <T>(value: T): Chain<T> => {
    const self: Chain<T> = {
      eq: () => self,
      then: (onfulfilled) => Promise.resolve(value).then(onfulfilled),
    };
    return self;
  };
  /** Delete-chain: `.eq(c,v)` records the filter into `scope` and returns self; `await` records the scope. */
  interface DelChain { eq(c: string, v: string | null): DelChain; then<U>(onfulfilled: (v: { error: null }) => U | PromiseLike<U>): Promise<U>; }
  const from = (table: string) => {
    tables.push(table);
    if (table === 'erp_payment_ledger_mirror') {
      return { select: () => chain({ data: [...pleRows] as unknown[], error: null }) };
    }
    if (table === 'erp_ap_aging_snapshot' || table === 'erp_ar_aging_snapshot') {
      return {
        delete: () => {
          const scope: Record<string, string | null> = {};
          const resolve = <U>(onfulfilled: (v: { error: null }) => U | PromiseLike<U>) =>
            Promise.resolve({ error: null } as { error: null }).then((r) => { deleted.push(scope); return onfulfilled(r); });
          const builder: DelChain = {
            eq: (c, v) => { scope[c] = v; return builder; },
            then: resolve,
          };
          return builder;
        },
        insert: async (rows: Record<string, unknown>[]) => { inserted.push(rows); return { error: null }; },
      };
    }
    throw new Error(`unexpected table: ${table}`);
  };
  return { client: { from }, tables, inserted, deleted };
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

  it('fallback snapshot-replaces the scope (delete prior + single snapshot_id)', async () => {
    const fetchImpl = async () => new Response('{"exc_type":"X"}', { status: 404 });
    const svc = makeServiceClient([{ party: 'S', party_type: 'Supplier', account: 'C', amount: 1, due_date: '2026-07-12', posting_date: '2026-07-12' }]);
    await refreshAging(svc.client as never, erpClient(fetchImpl) as never, 'org-1', AP_SCOPE);
    expect(svc.deleted).toHaveLength(1);
    expect(svc.deleted[0]).toMatchObject({ org_id: 'org-1' });
    const ids = new Set(svc.inserted[0]!.map((r) => r.snapshot_id));
    expect(ids.size).toBe(1);
  });
});

describe('erpnext/agingSnapshot — refreshAging edge', () => {
  it('a report with zero party rows still snapshot-replaces (scope cleared, empty insert)', async () => {
    const fetchImpl = async () => new Response(JSON.stringify(reportResponse([])), { status: 200 });
    const svc = makeServiceClient([]);
    await refreshAging(svc.client as never, erpClient(fetchImpl) as never, 'org-1', AP_SCOPE);
    expect(svc.deleted).toHaveLength(1);
    expect(svc.inserted[0]).toEqual([]);
  });

  it('propagates when the mirrored-ledger read itself fails (fallback read error surfaces, never swallowed)', async () => {
    const fetchImpl = async () => new Response('{"exc_type":"X"}', { status: 404 });
    // a service client whose PLE read rejects — the fallback read error must propagate (no silent empty)
    const from = (table: string) => {
      if (table === 'erp_payment_ledger_mirror') {
        // a chainable thenable that rejects on await (mirrors supabase-js's eq-chain shape).
        // `then` forwards to a rejected promise so the await assimilation actually settles.
        interface RejChain { eq(): RejChain; then(onf?: ((v: unknown) => unknown) | null, onr?: ((e: unknown) => unknown) | null): Promise<unknown>; }
        const err = new Error('ple read down');
        const rej: RejChain = {
          eq: () => rej,
          then: (onf, onr) => Promise.reject(err).then(onf ?? undefined, onr ?? undefined),
        };
        return { select: () => rej };
      }
      throw new Error(`unexpected table: ${table}`);
    };
    await expect(refreshAging({ from } as never, erpClient(fetchImpl) as never, 'org-1', AP_SCOPE)).rejects.toThrow('ple read down');
  });
});
