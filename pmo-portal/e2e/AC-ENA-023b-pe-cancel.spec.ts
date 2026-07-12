/**
 * AC-ENA-023b-pe-cancel — Slice 6 task 6.11. The PMO-initiated Payment Entry cancel (FR-ENA-050/052,
 * OQ-7 — PE amend is desk-only in P2; cancel is the PE correction path) proven at the REAL served
 * `adapter-dispatch` boundary — never `page.route`.
 *
 * Given a submitted PE (created+submitted via the adapter, referencing a PI in the same case), when it
 * is cancelled via `verb:'cancel'`, then: the ERP PE flips `docstatus:2` (OQ-8 cancel-only — a once-
 * submitted money doc cannot be REST-deleted), PMO's `payments` mirror is soft-tombstoned
 * (`erp_docstatus=2`, `erp_cancelled_at` set), and an `external_ref_lineage` row (`reason='cancelled'`,
 * no successor) is written. Cancelling the downstream PE needs no chain (the referenced PI stays
 * submitted); a PI cancel with a submitted PE against it would surface ERPNext's `LinkExistsError`
 * (chain-reverse is the caller's concern, AC-ENA-023 unit).
 *
 * Requires (process env, same as AC-ENA-053): SUPABASE_FUNCTIONS_URL, SUPABASE_URL/VITE_SUPABASE_URL,
 * VITE_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY. The served function needs
 * ERPNEXT_API_KEY/ERPNEXT_API_SECRET (`supabase/functions/.env.local`, gitignored).
 *
 * Run: scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test AC-ENA-023b
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ERPNEXT_SITE_URL = process.env.ERPNEXT_SITE_URL ?? 'http://host.docker.internal:8080';
const ERPNEXT_BENCH_URL = process.env.ERPNEXT_BENCH_URL ?? 'http://localhost:8080';
const ERPNEXT_ADMIN_KEY = process.env.ERPNEXT_BENCH_API_KEY ?? '';
const ERPNEXT_ADMIN_SECRET = process.env.ERPNEXT_BENCH_API_SECRET ?? '';

const ADMIN_EMAIL = 'admin@acme.test';
const SEED_PASSWORD = 'Passw0rd!dev';
const ORG_ID = '00000000-0000-0000-0000-000000000001';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY);
if (!READY && process.env.CI) {
  throw new Error('AC-ENA-023b-pe-cancel: SUPABASE_FUNCTIONS_URL + SUPABASE_URL + VITE_SUPABASE_ANON_KEY are required in CI — this spec cannot silently skip');
}
if (READY && !SERVICE_KEY) {
  throw new Error('AC-ENA-023b-pe-cancel: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available.');
}
test.skip(!READY, 'AC-ENA-023b-pe-cancel: SUPABASE_FUNCTIONS_URL/SUPABASE_URL/VITE_SUPABASE_ANON_KEY not set — run via scripts/serve-functions.sh against the ERPNext bench');

test.setTimeout(120_000);

interface Seed {
  companyId: string;
  procurementId: string;
  piRecordId: string;
  peRecordId: string;
}

async function seed(admin: SupabaseClient, suffix: string): Promise<Seed> {
  const companyId = crypto.randomUUID();
  const { error: companyErr } = await admin.from('companies').insert({ id: companyId, org_id: ORG_ID, name: `Spike Supplier ${suffix}`, type: 'Vendor' });
  if (companyErr) throw new Error(`seed companies failed: ${companyErr.message}`);

  const { error: refErr } = await admin.from('external_refs').insert({
    org_id: ORG_ID,
    domain: 'companies',
    pmo_record_id: companyId,
    external_tier: 'erpnext',
    external_record_id: 'Supplier:Spike Supplier',
  });
  if (refErr) throw new Error(`seed external_refs (companies) failed: ${refErr.message}`);

  const { data: procurement, error: procErr } = await admin
    .from('procurements')
    .insert({ org_id: ORG_ID, title: `AC-ENA-023b case ${suffix}`, vendor_id: companyId, status: 'Ordered' })
    .select('id')
    .single();
  if (procErr || !procurement) throw new Error(`seed procurements failed: ${procErr?.message}`);

  const { error: bindingErr } = await admin.from('external_org_bindings').upsert(
    {
      org_id: ORG_ID,
      external_tier: 'erpnext',
      site_url: ERPNEXT_SITE_URL,
      secret_ref: 'local-bench',
      version_major: 15,
      config: { company: 'PMO Smoke Co', default_cash_account: 'Cash - PSC', default_payable_account: 'Creditors - PSC' },
      activated_at: new Date().toISOString(),
    },
    { onConflict: 'org_id,external_tier' },
  );
  if (bindingErr) throw new Error(`seed external_org_bindings failed: ${bindingErr.message}`);

  const { error: flipErr } = await admin
    .from('external_domain_ownership')
    .upsert({ org_id: ORG_ID, external_tier: 'erpnext', domain: 'procurement' }, { onConflict: 'org_id,external_tier,domain' });
  if (flipErr) throw new Error(`seed external_domain_ownership failed: ${flipErr.message}`);

  return { companyId, procurementId: (procurement as { id: string }).id, piRecordId: crypto.randomUUID(), peRecordId: crypto.randomUUID() };
}

async function cleanup(admin: SupabaseClient, seeded: Seed): Promise<void> {
  await admin.from('external_ref_lineage').delete().eq('org_id', ORG_ID).eq('domain', 'procurement').eq('pmo_record_id', seeded.peRecordId);
  await admin.from('external_command_outbox').delete().eq('org_id', ORG_ID).eq('pmo_record_id', seeded.peRecordId);
  await admin.from('payments').delete().eq('procurement_id', seeded.procurementId);
  await admin.from('procurement_invoices').delete().eq('procurement_id', seeded.procurementId);
  await admin.from('procurements').delete().eq('id', seeded.procurementId);
  await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'companies').eq('pmo_record_id', seeded.companyId);
  await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'procurement').eq('pmo_record_id', seeded.piRecordId);
  await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'procurement').eq('pmo_record_id', seeded.peRecordId);
  await admin.from('companies').delete().eq('id', seeded.companyId);
}

test.describe('AC-ENA-023b: PE cancel through the real served adapter-dispatch boundary', () => {
  test('a submitted PE cancelled via verb:cancel -> soft-tombstone (erp_docstatus=2, erp_cancelled_at) + a cancelled lineage row', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const authClient = createClient(AUTH_URL, ANON_KEY);
    const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({ email: ADMIN_EMAIL, password: SEED_PASSWORD });
    if (signInError || !signInData.session) throw new Error(`sign-in failed: ${signInError?.message}`);
    const accessToken = signInData.session.access_token;

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seed(admin, suffix);

    try {
      // Create + submit the PI first (the PE references it in the same case).
      const piRes = await fetch(`${FUNCTIONS_URL}/functions/v1/adapter-dispatch`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'procurement',
          operation: 'create',
          record: { id: seeded.piRecordId, procurementId: seeded.procurementId, vendorId: seeded.companyId, erp_doc_kind: 'purchase-invoice', items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 60000 }] },
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const piBody = (await piRes.json()) as { externalRecordId?: string; message?: string };
      expect(piRes.status, `PI create failed: ${piBody.message}`).toBe(200);
      const piName = piBody.externalRecordId!;

      // Create + submit the PE referencing the PI.
      const peRes = await fetch(`${FUNCTIONS_URL}/functions/v1/adapter-dispatch`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'procurement',
          operation: 'create',
          record: {
            id: seeded.peRecordId,
            procurementId: seeded.procurementId,
            vendorId: seeded.companyId,
            invoiceId: seeded.piRecordId,
            erp_doc_kind: 'payment',
            paid_amount: 60000,
            references: [{ reference_doctype: 'Purchase Invoice', reference_name: piName, allocated_amount: 60000 }],
          },
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const peBody = (await peRes.json()) as { externalRecordId?: string; message?: string };
      expect(peRes.status, `PE create failed: ${peBody.message}`).toBe(200);
      const peName = peBody.externalRecordId!;

      // Cancel the PE via verb:cancel.
      const cancelRes = await fetch(`${FUNCTIONS_URL}/functions/v1/adapter-dispatch`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'procurement',
          operation: 'transition',
          record: { id: seeded.peRecordId, erp_doc_kind: 'payment', externalRecordId: peName, verb: 'cancel' },
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const cancelBody = (await cancelRes.json()) as { externalRecordId?: string; canonical?: { erp_docstatus?: number }; message?: string };
      expect(cancelRes.status, `PE cancel failed: ${cancelBody.message}`).toBe(200);
      expect(cancelBody.externalRecordId).toBe(peName);
      expect(cancelBody.canonical?.erp_docstatus).toBe(2);

      // PMO mirror: soft-tombstoned.
      const { data: peRow, error: peRowErr } = await admin.from('payments').select('*').eq('id', seeded.peRecordId).maybeSingle();
      expect(peRowErr).toBeNull();
      expect(peRow).toMatchObject({ pay_number: peName, erp_docstatus: 2, invoice_id: seeded.piRecordId });
      expect(peRow?.erp_cancelled_at, 'erp_cancelled_at must be set on a PE cancel tombstone').not.toBeNull();

      // Lineage row: reason='cancelled', no successor.
      const { data: lineageRows } = await admin
        .from('external_ref_lineage')
        .select('*')
        .eq('org_id', ORG_ID)
        .eq('domain', 'procurement')
        .eq('pmo_record_id', seeded.peRecordId)
        .eq('reason', 'cancelled');
      expect(lineageRows?.length).toBe(1);
      expect(lineageRows?.[0]).toMatchObject({ superseded_external_record_id: peName, successor_external_record_id: null, erp_docstatus: 2 });

      // ERP-side proof (optional): the PE is docstatus 2; the referenced PI is untouched (still 1).
      if (ERPNEXT_ADMIN_KEY && ERPNEXT_ADMIN_SECRET) {
        const peDocRes = await fetch(`${ERPNEXT_BENCH_URL}/api/resource/Payment%20Entry/${encodeURIComponent(peName)}`, {
          headers: { Authorization: `token ${ERPNEXT_ADMIN_KEY}:${ERPNEXT_ADMIN_SECRET}` },
        });
        const peDoc = (await peDocRes.json()) as { data?: { docstatus?: number } };
        expect(peDoc.data?.docstatus).toBe(2);

        const piDocRes = await fetch(`${ERPNEXT_BENCH_URL}/api/resource/Purchase%20Invoice/${encodeURIComponent(piName)}`, {
          headers: { Authorization: `token ${ERPNEXT_ADMIN_KEY}:${ERPNEXT_ADMIN_SECRET}` },
        });
        const piDoc = (await piDocRes.json()) as { data?: { docstatus?: number } };
        expect(piDoc.data?.docstatus, 'the referenced PI stays submitted — cancelling the downstream PE needs no chain').toBe(1);
      }
    } finally {
      await cleanup(admin, seeded);
    }
  });
});
