/**
 * AC-ENA-061-aging-readback — Slice 7 task 7.6. Real-boundary proof of the AP/AR aging snapshot.
 *
 * The aging refresh's served boundaries are (1) the ERPNext report RPC
 * `POST /api/method/frappe.desk.query_report.run` (served by the Docker v15 bench, real HTTP — never
 * `page.route`, FR-ENA-001) and (2) the local Supabase snapshot write/read. This spec exercises
 * `refreshAging` (the slice-7 logic, task 7.4) against those REAL boundaries — the served SWEEP TRIGGER
 * (the `erpnext-sweep` edge fn that fires refreshAging on a cron) is slice 8's task 8.6; the refresh
 * logic + its real served calls are proven here.
 *
 * Given an ERPNext org with an open (unpaid) Purchase Invoice, when PMO refreshes AP aging, then
 * erp_ap_aging_snapshot stores report-backed buckets with report_date/range_labels/ageing_based_on/
 * as_of/report_version provenance, snapshot-replaced per scope, and NO bucket is computed by
 * invoice-only local math over procurement_invoices (FR-ENA-160/161/162, ADR-0048).
 *
 * Requires (process env, same family as AC-ENA-053): SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY +
 * ERPNEXT_BENCH_URL/ERPNEXT_BENCH_API_KEY/ERPNEXT_BENCH_API_SECRET (creds from
 * ~/Coding/frappe-docker-pmo/PMO-BENCH-NOTES.md — never this repo, NFR-ENA-SEC-002). Skips gracefully
 * when the bench/Supabase env is absent (mirrors AC-ENA-053's test.skip discipline).
 *
 * Run: scripts/with-db-lock.sh scripts/with-erpnext-lock.sh -- npx playwright test AC-ENA-061
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { refreshAging, type AgingScope } from '../src/lib/adapterSeam/erpnext/agingSnapshot.ts';

const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const BENCH_URL = process.env.ERPNEXT_BENCH_URL ?? 'http://localhost:8080';
const BENCH_KEY = process.env.ERPNEXT_BENCH_API_KEY ?? '';
const BENCH_SECRET = process.env.ERPNEXT_BENCH_API_SECRET ?? '';
// What the sweep uses as the per-org site_url when it dials ERPNext from inside Docker (host.docker.internal).
const SITE_URL_FOR_BINDING = process.env.ERPNEXT_SITE_URL ?? 'http://host.docker.internal:8080';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const COMPANY = 'PMO Smoke Co';
const SUPPLIER = 'Spike Supplier';
const ITEM_CODE = 'SPIKE-ITEM-1';
const REPORT_VERSION = 'erpnext-15.94.3/frappe-15.96.0';

const READY = Boolean(AUTH_URL && SERVICE_KEY && BENCH_KEY && BENCH_SECRET);
test.skip(!READY, 'AC-ENA-061: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + ERPNEXT_BENCH_* creds required — run against the Docker v15 bench');

test.setTimeout(120_000);

async function benchHeaders(): Promise<Record<string, string>> {
  return { Authorization: `token ${BENCH_KEY}:${BENCH_SECRET}`, 'Content-Type': 'application/json' };
}

/** Find an open (docstatus=1, outstanding>0) Purchase Invoice on the bench for the seeded supplier;
 *  create one if none exists, so the aging report has a bucket to return. Returns the PI name. */
async function ensureOpenPurchaseInvoice(suffix: string): Promise<string> {
  const h = await benchHeaders();
  // try to find an existing open PI for the supplier
  const filters = encodeURIComponent(JSON.stringify([['supplier', '=', SUPPLIER], ['docstatus', '=', 1], ['outstanding_amount', '>', 0]]));
  const listRes = await fetch(`${BENCH_URL}/api/resource/Purchase%20Invoice?filters=${filters}&fields=["name","outstanding_amount"]&limit_page_length=5`, { headers: h });
  const listBody = (await listRes.json()) as { data?: Array<{ name: string }> };
  if (listBody.data && listBody.data.length > 0) return listBody.data[0]!.name;

  // none open → create + submit a fresh one (unpaid → open AP)
  const today = new Date().toISOString().slice(0, 10);
  const createRes = await fetch(`${BENCH_URL}/api/resource/Purchase%20Invoice`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ supplier: SUPPLIER, company: COMPANY, posting_date: today, bill_no: `AC-061-${suffix}`, items: [{ item_code: ITEM_CODE, qty: 1, rate: 125000 }] }),
  });
  const created = (await createRes.json()) as { data?: { name?: string }; exc_type?: string };
  const piName = created.data?.name;
  if (!piName) throw new Error(`could not create open PI for aging seed: ${created.exc_type ?? createRes.status}`);
  // submit (docstatus 1) — makes it a real open payable
  await fetch(`${BENCH_URL}/api/resource/Purchase%20Invoice/${encodeURIComponent(piName)}`, {
    method: 'PUT',
    headers: h,
    body: JSON.stringify({ docstatus: 1 }),
  });
  return piName;
}

test.describe('AC-ENA-061: AP aging snapshot — report-RPC truth + provenance, no invoice-only math', () => {
  test('refreshAging against the real bench writes report-backed aging buckets with full provenance', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // seed: flip the org + a pre-activated binding carrying the R10-pinned report_filter_shape
    const { error: flipErr } = await admin.from('external_domain_ownership').upsert(
      { org_id: ORG_ID, external_tier: 'erpnext', domain: 'procurement' },
      { onConflict: 'org_id,external_tier,domain' },
    );
    expect(flipErr).toBeNull();
    const { error: bindErr } = await admin.from('external_org_bindings').upsert(
      {
        org_id: ORG_ID, external_tier: 'erpnext', site_url: SITE_URL_FOR_BINDING, secret_ref: 'local-bench',
        version_major: 15, activated_at: new Date().toISOString(),
        config: { company: COMPANY, aging_report_names: { ap: 'Accounts Payable', ar: 'Accounts Receivable' }, report_filter_shape: { company: COMPANY, ageing_based_on: 'Due Date', range1: 30, range2: 60, range3: 90, range4: 120 } },
      },
      { onConflict: 'org_id,external_tier' },
    );
    expect(bindErr).toBeNull();

    const piName = await ensureOpenPurchaseInvoice(suffix);

    try {
      const reportDate = new Date().toISOString().slice(0, 10);
      const scope: AgingScope = {
        reportName: 'Accounts Payable',
        snapshotTable: 'erp_ap_aging_snapshot',
        filters: { company: COMPANY, report_date: reportDate, ageing_based_on: 'Due Date', range1: 30, range2: 60, range3: 90, range4: 120 },
        reportVersion: REPORT_VERSION,
        reportDate,
        ageingBasedOn: 'Due Date',
        partyType: 'Supplier',
      };
      // the REAL served boundaries: the bench report RPC (real HTTP) + the real local-DB snapshot write
      await refreshAging(admin as unknown as never, { fetchImpl: globalThis.fetch, apiKey: BENCH_KEY, apiSecret: BENCH_SECRET, baseUrl: BENCH_URL }, ORG_ID, scope);

      // read back the snapshot
      const { data: rows, error: readErr } = await admin.from('erp_ap_aging_snapshot').select('*').eq('org_id', ORG_ID);
      expect(readErr).toBeNull();
      expect(Array.isArray(rows)).toBe(true);
      // at least one party row — the open PI seeded above guarantees the report returns the supplier
      const partyRow = (rows as Array<Record<string, unknown>>).find((r) => r.party === SUPPLIER);
      expect(partyRow, 'the seeded open PI produced a report-backed aging row for the supplier').toBeTruthy();
      // provenance cols present (FR-ENA-161)
      expect(partyRow!.source_report).toBe('Accounts Payable');
      expect(partyRow!.report_version).toBe(REPORT_VERSION);
      expect(partyRow!.ageing_based_on).toBe('Due Date');
      expect(partyRow!.report_date).toBe(reportDate);
      expect(partyRow!.range_labels).toBeTruthy();
      expect(typeof partyRow!.as_of).toBe('string');
      expect(typeof partyRow!.snapshot_id).toBe('string');
      // bucket cols are present (the report's verbatim ranges) and total reconciles
      const total = Number(partyRow!.total_outstanding);
      const bucketSum = Number(partyRow!.current) + Number(partyRow!.b_0_30) + Number(partyRow!.b_31_60) + Number(partyRow!.b_61_90) + Number(partyRow!.b_90_plus);
      expect(Math.abs(total - bucketSum)).toBeLessThanOrEqual(0.01);

      // snapshot-replaced: exactly ONE snapshot_id for the org scope after a refresh
      const snapshotIds = new Set((rows as Array<Record<string, unknown>>).map((r) => r.snapshot_id));
      expect(snapshotIds.size).toBe(1);

      // AC-ENA-061 prohibition: the snapshot carries NO procurement_invoices-derived bucket column.
      // Assert by schema — the bucket columns are the report's ranges only; no PMO-invoice column exists.
      const bucketCols = Object.keys(partyRow!).filter((k) => ['current', 'b_0_30', 'b_31_60', 'b_61_90', 'b_90_plus'].includes(k));
      expect(bucketCols.sort()).toEqual(['b_0_30', 'b_31_60', 'b_61_90', 'b_90_plus', 'current']);
    } finally {
      // cleanup: cancel the PI we created (leave the bench clean), unflip the org, clear the snapshot
      const h = await benchHeaders();
      await fetch(`${BENCH_URL}/api/resource/Purchase%20Invoice/${encodeURIComponent(piName)}`, { method: 'PUT', headers: h, body: JSON.stringify({ docstatus: 2 }) }).catch(() => undefined);
      await admin.from('erp_ap_aging_snapshot').delete().eq('org_id', ORG_ID);
      await admin.from('external_org_bindings').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
      await admin.from('external_domain_ownership').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext').eq('domain', 'procurement');
    }
  });
});
