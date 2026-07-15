// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * AC-SAR-050-ar-aging-readback — Slice 7 task 7.8. AR aging read-back (the AP twin of AC-ENA-061,
 * FR-SAR-150..152) proven at the REAL served boundary — never `page.route`.
 *
 * Given an ERPNext org owning `revenue` with an open (unpaid) Sales Invoice, when AR aging is
 * refreshed (refreshAging — the slice-7 logic — against the REAL bench report RPC
 * `POST /api/method/frappe.desk.query_report.run` + the real local-DB snapshot write, mirroring
 * AC-ENA-061's AP proof — the served sweep TRIGGER is slice 8's task 8.6, not exercised here), then:
 * `erp_ar_aging_snapshot` stores report-backed buckets verbatim with `report_date`/`range_labels`/
 * `ageing_based_on`/`as_of`/`report_version`/`source_report` provenance, snapshot-replaced per scope
 * (exactly one `snapshot_id`), and **no** bucket is computed by invoice-only local math over
 * `sales_invoices` (FR-SAR-152, ADR-0048 — the snapshot is PER-PARTY, fed from the ERP report's
 * per-voucher rows aggregated by customer; range5 folds into the b_90_plus bucket).
 *
 * Requires (process env, same family as AC-ENA-061 + the served-fn lane for the SI create):
 * SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY + ERPNEXT_BENCH_URL/ERPNEXT_BENCH_API_KEY/SECRET +
 * SUPABASE_FUNCTIONS_URL/VITE_SUPABASE_ANON_KEY.
 *
 * Run: scripts/with-db-lock.sh scripts/serve-functions.sh -- npx playwright test AC-SAR-050
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { refreshAging, type AgingScope } from '../../src/lib/adapterSeam/erpnext/agingSnapshot.ts';
import { seedSAR, cleanupSAR, signInAdmin, signInApprover, dispatchCreateRevenue, dispatchTransitionRevenue, type SARSeed } from './_sarHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ERPNEXT_BENCH_URL = process.env.ERPNEXT_BENCH_URL ?? 'http://localhost:8080';
const ERPNEXT_ADMIN_KEY = process.env.ERPNEXT_BENCH_API_KEY ?? '';
const ERPNEXT_ADMIN_SECRET = process.env.ERPNEXT_BENCH_API_SECRET ?? '';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const COMPANY = 'PMO Smoke Co';
// The open SI's customer resolves (via external_refs) to the bench-fixture ERP Customer 'Spike Customer'
// — the snapshot is PER-PARTY, so the report-backed row is found by `party === CUSTOMER`.
const CUSTOMER = 'Spike Customer';
const REPORT_VERSION = 'erpnext-15.94.3/frappe-15.96.0';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY && SERVICE_KEY && ERPNEXT_ADMIN_KEY && ERPNEXT_ADMIN_SECRET);
if (!READY && process.env.CI) {
  throw new Error('AC-SAR-050-ar-aging-readback: SUPABASE_FUNCTIONS_URL + SUPABASE_URL + VITE_SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY + ERPNEXT_BENCH_API_KEY/SECRET are required in CI — this spec cannot silently skip');
}
test.skip(!READY, 'AC-SAR-050-ar-aging-readback: required env not set — run via scripts/serve-functions.sh against the ERPNext bench');

test.setTimeout(120_000);

/** Create + submit a Sales Invoice via the real served adapter-dispatch (open AR for the customer).
 * Author creates (leaves DRAFT), Approver submits (SoD: approver ≠ author). */
async function createAndSubmitSI(seeded: SARSeed, idempotencyKey: string): Promise<string> {
  const authorToken = await signInAdmin(AUTH_URL, ANON_KEY);
  const approverToken = await signInApprover(AUTH_URL, ANON_KEY);
  let createRes = await dispatchCreateRevenue(
    FUNCTIONS_URL,
    ANON_KEY,
    authorToken, // author creates
    {
      id: seeded.siRecordId,
      customerId: seeded.companyId,
      projectId: seeded.projectId,
      erp_doc_kind: 'sales-invoice',
      items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 125000 }],
    },
    'sales-invoice',
    idempotencyKey,
  );
  let createBody = await createRes.json();
  // Retry on 502 with the SAME idempotencyKey (ADR-0058 client contract) and USE the retry's result —
  // the outbox dedupes, so a retry can never double-create; reassigning createRes means a recovered
  // 200 is what the assertion checks (a discarded retry would assert the original 502 and fail).
  for (let attempt = 0; createRes.status === 502 && attempt < 2; attempt++) {
    await new Promise((r) => setTimeout(r, 750));
    createRes = await dispatchCreateRevenue(
      FUNCTIONS_URL,
      ANON_KEY,
      authorToken, // author creates
      {
        id: seeded.siRecordId,
        customerId: seeded.companyId,
        projectId: seeded.projectId,
        erp_doc_kind: 'sales-invoice',
        items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 125000 }],
      },
      'sales-invoice',
      idempotencyKey,
    );
    createBody = await createRes.json();
  }
  expect(createRes.status, `SI create failed: ${JSON.stringify(createBody)}`).toBe(200);
  const siName = createBody.externalRecordId as string;

  const submitRes = await dispatchTransitionRevenue(
    FUNCTIONS_URL,
    ANON_KEY,
    approverToken, // approver submits (SoD: approver ≠ author)
    {
      id: seeded.siRecordId,
      customerId: seeded.companyId,
      projectId: seeded.projectId,
      erp_doc_kind: 'sales-invoice',
      externalRecordId: siName,
      verb: 'submit',
    },
    'sales-invoice',
    'submit',
    crypto.randomUUID(),
  );
  const submitBody = (await submitRes.json()) as { message?: string };
  expect(submitRes.status, `SI submit failed: ${submitBody.message}`).toBe(200);
  return siName;
}

test.describe('AC-SAR-050: AR aging read-back stores report-backed buckets', () => {
  test('an open SI + refreshAging -> erp_ar_aging_snapshot stores report metadata + buckets verbatim; no local math', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const accessToken = await signInAdmin(AUTH_URL, ANON_KEY);
    const suffix = `sar050-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedSAR(admin, suffix);
    let siName: string | undefined;

    try {
      // ── 1. Create + submit a Sales Invoice (open AR for the seeded Customer) ──
      siName = await createAndSubmitSI(seeded, crypto.randomUUID());

      // ── 2. Refresh AR aging directly against the REAL bench report RPC + the local-DB snapshot
      //      write (mirrors AC-ENA-061's AP proof — refreshAging is the slice-7 logic; the served
      //      sweep TRIGGER is slice 8's task 8.6, not exercised here). ──
      const reportDate = new Date().toISOString().slice(0, 10);
      const scope: AgingScope = {
        reportName: 'Accounts Receivable',
        snapshotTable: 'erp_ar_aging_snapshot',
        filters: { company: COMPANY, report_date: reportDate, ageing_based_on: 'Due Date', range1: 30, range2: 60, range3: 90, range4: 120 },
        reportVersion: REPORT_VERSION,
        reportDate,
        ageingBasedOn: 'Due Date',
        partyType: 'Customer',
      };
      await refreshAging(
        admin as unknown as never,
        { fetchImpl: globalThis.fetch, apiKey: ERPNEXT_ADMIN_KEY, apiSecret: ERPNEXT_ADMIN_SECRET, baseUrl: ERPNEXT_BENCH_URL },
        ORG_ID,
        scope,
      );

      // ── 3. Read back the AR snapshot ──
      const { data: rows, error: readErr } = await admin.from('erp_ar_aging_snapshot').select('*').eq('org_id', ORG_ID);
      expect(readErr).toBeNull();
      expect(Array.isArray(rows)).toBe(true);
      // The snapshot is PER-PARTY (customer); the open SI's customer is the bench-fixture 'Spike Customer'.
      const partyRow = (rows as Array<Record<string, unknown>>).find((r) => r.party === CUSTOMER);
      expect(partyRow, 'the open SI produced a report-backed aging row for the customer').toBeTruthy();

      // Provenance cols (FR-SAR-152): report-backed metadata, verbatim from the ERP report.
      expect(partyRow!.source_report).toBe('Accounts Receivable');
      expect(partyRow!.report_version).toBe(REPORT_VERSION);
      expect(partyRow!.ageing_based_on).toBe('Due Date');
      expect(partyRow!.report_date).toBe(reportDate);
      expect(partyRow!.range_labels).toBeTruthy(); // jsonb object {range1..4}, NOT an array
      expect(typeof partyRow!.as_of).toBe('string');
      expect(typeof partyRow!.snapshot_id).toBe('string');

      // Bucket cols are the report's verbatim ranges; total reconciles (current + 4 buckets).
      const total = Number(partyRow!.total_outstanding);
      const bucketSum =
        Number(partyRow!.current) + Number(partyRow!.b_0_30) + Number(partyRow!.b_31_60) + Number(partyRow!.b_61_90) + Number(partyRow!.b_90_plus);
      expect(Math.abs(total - bucketSum)).toBeLessThanOrEqual(0.01);
      expect(total).toBeGreaterThan(0); // the open SI is reflected in AR

      // Snapshot-replaced per scope: exactly ONE snapshot_id after a refresh (no append).
      const snapshotIds = new Set((rows as Array<Record<string, unknown>>).map((r) => r.snapshot_id));
      expect(snapshotIds.size).toBe(1);

      // No local math (FR-SAR-152, ADR-0048): the bucket columns are the report's ranges only — no
      // PMO-invoice column exists on the snapshot (sales_invoices is never read on the aging path).
      const bucketCols = Object.keys(partyRow!).filter((k) => ['current', 'b_0_30', 'b_31_60', 'b_61_90', 'b_90_plus'].includes(k));
      expect(bucketCols.sort()).toEqual(['b_0_30', 'b_31_60', 'b_61_90', 'b_90_plus', 'current']);
    } finally {
      // Cleanup: cancel the open SI on the bench (best-effort), clear the AR snapshot, un-seed.
      if (siName) {
        try {
          await fetch(`${ERPNEXT_BENCH_URL}/api/resource/Sales%20Invoice/${encodeURIComponent(siName)}`, {
            method: 'PUT',
            headers: { Authorization: `token ${ERPNEXT_ADMIN_KEY}:${ERPNEXT_ADMIN_SECRET}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ docstatus: 2 }),
          });
        } catch {
          // best-effort — a stray bench-side doc does not corrupt PMO's own state.
        }
      }
      await admin.from('erp_ar_aging_snapshot').delete().eq('org_id', ORG_ID);
      await cleanupSAR(admin, seeded);
    }
  });
});
