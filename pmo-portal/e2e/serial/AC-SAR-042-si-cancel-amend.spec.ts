// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * AC-SAR-042-si-cancel-amend — Slice 7 task 7.6. The PMO-initiated cancel + amend command surface
 * (FR-SAR-050/052/053, NFR-SAR-DOC-001) proven at the REAL served `adapter-dispatch` boundary — never
 * `page.route`. Two journeys:
 *
 * 1. **cancel** — a submitted SI cancelled via `verb:'cancel'`: the ERP doc flips `docstatus:2`
 *    (OQ-SAR-1 #8: NOT a hard block — ERP auto-unlinks any referencing PE-receive, 200), PMO's mirror
 *    is soft-tombstoned (`erp_docstatus=2`, `erp_cancelled_at` set), and an `external_ref_lineage` row
 *    (`reason='cancelled'`, no successor) is written — the cancelled doc keeps a read-only mirror for
 *    audit (FR-SAR-052).
 *
 * 2. **amend** — a submitted SI amended via `verb:'amend'`: the adapter cancels the old doc + creates a
 *    NEW doc carrying `amended_from` (FR-SAR-053), `external_refs` repoints to the new name for the
 *    SAME `pmo_record_id`, `erp_amended_from` is stamped on the mirror, an `external_ref_lineage` row
 *    (`reason='amended'`, successor=new name) is written, and NO duplicate `sales_invoices` mirror
 *    row is minted (NFR-SAR-DOC-001).
 *
 * Requires (process env, same as AC-ENA-053): SUPABASE_FUNCTIONS_URL, SUPABASE_URL/VITE_SUPABASE_URL,
 * VITE_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY. The served function needs
 * ERPNEXT_API_KEY/ERPNEXT_API_SECRET (`supabase/functions/.env.local`, gitignored).
 *
 * Run: scripts/with-db-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test AC-SAR-042
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { seedSAR, cleanupSAR, signInAdmin, dispatchCreateRevenue, dispatchTransitionRevenue } from './_sarHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ERPNEXT_BENCH_URL = process.env.ERPNEXT_BENCH_URL ?? 'http://localhost:8080';
const ERPNEXT_ADMIN_KEY = process.env.ERPNEXT_BENCH_API_KEY ?? '';
const ERPNEXT_ADMIN_SECRET = process.env.ERPNEXT_BENCH_API_SECRET ?? '';

const ORG_ID = '00000000-0000-0000-0000-000000000001';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY);
if (!READY && process.env.CI) {
  throw new Error('AC-SAR-042-si-cancel-amend: SUPABASE_FUNCTIONS_URL + SUPABASE_URL + VITE_SUPABASE_ANON_KEY are required in CI — this spec cannot silently skip');
}
if (READY && !SERVICE_KEY) {
  throw new Error('AC-SAR-042-si-cancel-amend: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available.');
}
test.skip(!READY, 'AC-SAR-042-si-cancel-amend: SUPABASE_FUNCTIONS_URL/SUPABASE_URL/VITE_SUPABASE_ANON_KEY not set — run via scripts/serve-functions.sh against the ERPNext bench');

test.setTimeout(120_000);

async function createAndSubmitSI(admin: SupabaseClient, accessToken: string, seeded: any, idempotencyKey: string) {
  let createRes = await dispatchCreateRevenue(
    FUNCTIONS_URL,
    ANON_KEY,
    accessToken,
    {
      id: seeded.siRecordId,
      customerId: seeded.companyId,
      projectId: seeded.projectId,
      erp_doc_kind: 'sales-invoice',
      items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 50000 }],
    },
    'sales-invoice',
    idempotencyKey,
  );
  let createBody = await createRes.json();
  for (let attempt = 0; createRes.status === 502 && attempt < 2; attempt++) {
    await new Promise((r) => setTimeout(r, 750));
    createRes = await dispatchCreateRevenue(
      FUNCTIONS_URL,
      ANON_KEY,
      accessToken,
      {
        id: seeded.siRecordId,
        customerId: seeded.companyId,
        projectId: seeded.projectId,
        erp_doc_kind: 'sales-invoice',
        items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 50000 }],
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
    accessToken,
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

test.describe('AC-SAR-042: SI cancel + amend through the real served adapter-dispatch boundary', () => {
  test('cancel: a submitted SI cancelled via verb:cancel -> soft-tombstone (erp_docstatus=2, erp_cancelled_at) + a cancelled lineage row', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const accessToken = await signInAdmin(AUTH_URL, ANON_KEY);
    const suffix = `cancel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedSAR(admin, suffix);

    try {
      const siIdempotencyKey = crypto.randomUUID();
      const siName = await createAndSubmitSI(admin, accessToken, seeded, siIdempotencyKey);

      // Cancel the SI via verb:cancel.
      const cancelRes = await dispatchTransitionRevenue(
        FUNCTIONS_URL,
        ANON_KEY,
        accessToken,
        {
          id: seeded.siRecordId,
          customerId: seeded.companyId,
          projectId: seeded.projectId,
          erp_doc_kind: 'sales-invoice',
          externalRecordId: siName,
          verb: 'cancel',
        },
        'sales-invoice',
        'cancel',
        crypto.randomUUID(),
      );
      const cancelBody = (await cancelRes.json()) as { externalRecordId?: string; canonical?: { erp_docstatus?: number }; message?: string };
      expect(cancelRes.status, `SI cancel failed: ${cancelBody.message}`).toBe(200);
      expect(cancelBody.externalRecordId).toBe(siName);
      expect(cancelBody.canonical?.erp_docstatus).toBe(2);

      // PMO mirror: soft-tombstoned.
      const { data: siRow, error: siRowErr } = await admin
        .from('sales_invoices')
        .select('*')
        .eq('id', seeded.siRecordId)
        .maybeSingle();
      expect(siRowErr).toBeNull();
      expect(siRow).toMatchObject({ si_number: siName, erp_docstatus: 2 });
      expect(siRow?.erp_cancelled_at, 'erp_cancelled_at must be set on a cancel tombstone').not.toBeNull();

      // Lineage row: reason='cancelled', no successor.
      const { data: lineageRows } = await admin
        .from('external_ref_lineage')
        .select('*')
        .eq('org_id', ORG_ID)
        .eq('domain', 'revenue')
        .eq('pmo_record_id', seeded.siRecordId)
        .eq('reason', 'cancelled');
      expect(lineageRows?.length).toBe(1);
      expect(lineageRows?.[0]).toMatchObject({
        superseded_external_record_id: siName,
        successor_external_record_id: null,
        erp_docstatus: 2,
      });

      // ERP-side proof (optional): the SI is docstatus 2.
      if (ERPNEXT_ADMIN_KEY && ERPNEXT_ADMIN_SECRET) {
        const docRes = await fetch(`${ERPNEXT_BENCH_URL}/api/resource/Sales%20Invoice/${encodeURIComponent(siName)}`, {
          headers: { Authorization: `token ${ERPNEXT_ADMIN_KEY}:${ERPNEXT_ADMIN_SECRET}` },
        });
        const doc = (await docRes.json()) as { data?: { docstatus?: number } };
        expect(doc.data?.docstatus).toBe(2);
      }
    } finally {
      await cleanupSAR(admin, seeded);
    }
  });

  test('amend: a submitted SI amended via verb:amend -> external_refs repoints to the new name + erp_amended_from stamped + an amended lineage row + NO duplicate mirror row', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const accessToken = await signInAdmin(AUTH_URL, ANON_KEY);
    const suffix = `amend-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedSAR(admin, suffix);

    try {
      const siIdempotencyKey = crypto.randomUUID();
      const oldName = await createAndSubmitSI(admin, accessToken, seeded, siIdempotencyKey);

      // The original external_refs mapping points at the old name.
      const { data: refBefore } = await admin
        .from('external_refs')
        .select('external_record_id')
        .eq('org_id', ORG_ID)
        .eq('domain', 'revenue')
        .eq('pmo_record_id', seeded.siRecordId)
        .maybeSingle();
      expect((refBefore as { external_record_id: string } | null)?.external_record_id).toBe(oldName);

      // Amend the SI via verb:amend (new line: 2 items @ 50000 = 100000).
      const amendRes = await dispatchTransitionRevenue(
        FUNCTIONS_URL,
        ANON_KEY,
        accessToken,
        {
          id: seeded.siRecordId,
          customerId: seeded.companyId,
          projectId: seeded.projectId,
          erp_doc_kind: 'sales-invoice',
          externalRecordId: oldName,
          verb: 'amend',
          items: [{ item_code: 'SPIKE-ITEM-1', qty: 2, rate: 50000 }],
        },
        'sales-invoice',
        'amend',
        crypto.randomUUID(),
      );
      const amendBody = (await amendRes.json()) as { externalRecordId?: string; canonical?: { erp_amended_from?: string }; message?: string };
      expect(amendRes.status, `SI amend failed: ${amendBody.message}`).toBe(200);
      const newName = amendBody.externalRecordId!;
      expect(newName, 'amend produces a NEW ERP name (ERPNext amended naming: <orig>-N)').not.toBe(oldName);
      expect(newName).toMatch(/^ACC-SINV-/);
      expect(amendBody.canonical?.erp_amended_from).toBe(oldName);

      // external_refs REPOINTS to the new name for the SAME pmo_record_id (no second mapping).
      const { data: refAfter } = await admin
        .from('external_refs')
        .select('external_record_id')
        .eq('org_id', ORG_ID)
        .eq('domain', 'revenue')
        .eq('pmo_record_id', seeded.siRecordId)
        .maybeSingle();
      expect((refAfter as { external_record_id: string } | null)?.external_record_id).toBe(newName);

      // Exactly ONE sales_invoices mirror row (the amend reuses it — never a duplicate).
      const { data: mirrorRows } = await admin
        .from('sales_invoices')
        .select('id, si_number, amount, erp_amended_from')
        .eq('id', seeded.siRecordId);
      expect(mirrorRows?.length, 'no duplicate mirror row — the amend repoints the SAME row').toBe(1);
      expect(mirrorRows?.[0]).toMatchObject({ id: seeded.siRecordId, si_number: newName, erp_amended_from: oldName });
      expect(mirrorRows?.[0]?.amount).toBe(100000);

      // Lineage row: reason='amended', successor=new name, superseded=old name.
      const { data: lineageRows } = await admin
        .from('external_ref_lineage')
        .select('*')
        .eq('org_id', ORG_ID)
        .eq('domain', 'revenue')
        .eq('pmo_record_id', seeded.siRecordId)
        .eq('reason', 'amended');
      expect(lineageRows?.length).toBe(1);
      expect(lineageRows?.[0]).toMatchObject({ superseded_external_record_id: oldName, successor_external_record_id: newName });

      // ERP-side proof (optional): the new SI is docstatus 1 with amended_from = old name.
      if (ERPNEXT_ADMIN_KEY && ERPNEXT_ADMIN_SECRET) {
        const docRes = await fetch(`${ERPNEXT_BENCH_URL}/api/resource/Sales%20Invoice/${encodeURIComponent(newName)}`, {
          headers: { Authorization: `token ${ERPNEXT_ADMIN_KEY}:${ERPNEXT_ADMIN_SECRET}` },
        });
        const doc = (await docRes.json()) as { data?: { docstatus?: number; amended_from?: string } };
        expect(doc.data?.docstatus).toBe(1);
        expect(doc.data?.amended_from).toBe(oldName);
      }
    } finally {
      await cleanupSAR(admin, seeded);
    }
  });
});