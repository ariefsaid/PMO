/**
 * AC-ENA-023-pi-cancel-amend — Slice 6 task 6.10. The PMO-initiated cancel + amend command surface
 * (FR-ENA-050/052/053, NFR-ENA-DOC-001) proven at the REAL served `adapter-dispatch` boundary — never
 * `page.route`. Two journeys:
 *
 * 1. **cancel** — a submitted PI cancelled via `verb:'cancel'`: the ERP doc flips `docstatus:2`
 *    (OQ-8 cancel-only), PMO's mirror is soft-tombstoned (`erp_docstatus=2`, `erp_cancelled_at` set),
 *    and an `external_ref_lineage` row (`reason='cancelled'`, no successor) is written — the cancelled
 *    doc keeps a read-only mirror for audit (FR-ENA-052).
 *
 * 2. **amend** — a submitted PI amended via `verb:'amend'`: the adapter cancels the old doc + creates a
 *    NEW doc carrying `amended_from` (FR-ENA-053), `external_refs` repoints to the new name for the
 *    SAME `pmo_record_id`, `erp_amended_from` is stamped on the mirror, an `external_ref_lineage` row
 *    (`reason='amended'`, successor=new name) is written, and NO duplicate `procurement_invoices` mirror
 *    row is minted (NFR-ENA-DOC-001).
 *
 * Requires (process env, same as AC-ENA-053): SUPABASE_FUNCTIONS_URL, SUPABASE_URL/VITE_SUPABASE_URL,
 * VITE_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY. The served function needs
 * ERPNEXT_API_KEY/ERPNEXT_API_SECRET (`supabase/functions/.env.local`, gitignored).
 *
 * Run: scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test AC-ENA-023
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
  throw new Error('AC-ENA-023-pi-cancel-amend: SUPABASE_FUNCTIONS_URL + SUPABASE_URL + VITE_SUPABASE_ANON_KEY are required in CI — this spec cannot silently skip');
}
if (READY && !SERVICE_KEY) {
  throw new Error('AC-ENA-023-pi-cancel-amend: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available.');
}
test.skip(!READY, 'AC-ENA-023-pi-cancel-amend: SUPABASE_FUNCTIONS_URL/SUPABASE_URL/VITE_SUPABASE_ANON_KEY not set — run via scripts/serve-functions.sh against the ERPNext bench');

test.setTimeout(120_000);

interface Seed {
  companyId: string;
  procurementId: string;
  piRecordId: string;
}

async function seed(admin: SupabaseClient, suffix: string, piRecordId: string): Promise<Seed> {
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
    .insert({ org_id: ORG_ID, title: `AC-ENA-023 case ${suffix}`, vendor_id: companyId, status: 'Ordered' })
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

  return { companyId, procurementId: (procurement as { id: string }).id, piRecordId };
}

async function cleanup(admin: SupabaseClient, seeded: Seed): Promise<void> {
  await admin.from('external_ref_lineage').delete().eq('org_id', ORG_ID).eq('domain', 'procurement').eq('pmo_record_id', seeded.piRecordId);
  await admin.from('external_command_outbox').delete().eq('org_id', ORG_ID).eq('pmo_record_id', seeded.piRecordId);
  await admin.from('procurement_invoices').delete().eq('procurement_id', seeded.procurementId);
  await admin.from('procurements').delete().eq('id', seeded.procurementId);
  await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'companies').eq('pmo_record_id', seeded.companyId);
  await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'procurement').eq('pmo_record_id', seeded.piRecordId);
  await admin.from('companies').delete().eq('id', seeded.companyId);
}

async function signIn(): Promise<string> {
  const authClient = createClient(AUTH_URL, ANON_KEY);
  const { data, error } = await authClient.auth.signInWithPassword({ email: ADMIN_EMAIL, password: SEED_PASSWORD });
  if (error || !data.session) throw new Error(`sign-in failed: ${error?.message}`);
  return data.session.access_token;
}

async function dispatchCreatePi(accessToken: string, seeded: Seed): Promise<string> {
  const res = await fetch(`${FUNCTIONS_URL}/functions/v1/adapter-dispatch`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      domain: 'procurement',
      operation: 'create',
      record: {
        id: seeded.piRecordId,
        procurementId: seeded.procurementId,
        vendorId: seeded.companyId,
        erp_doc_kind: 'purchase-invoice',
        items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 50000 }],
      },
      idempotencyKey: crypto.randomUUID(),
    }),
  });
  const body = (await res.json()) as { externalRecordId?: string; message?: string };
  expect(res.status, `PI create failed: ${body.message}`).toBe(200);
  expect(body.externalRecordId!).toMatch(/^ACC-PINV-/);
  return body.externalRecordId!;
}

test.describe('AC-ENA-023: PI cancel + amend through the real served adapter-dispatch boundary', () => {
  test('cancel: a submitted PI cancelled via verb:cancel -> soft-tombstone (erp_docstatus=2, erp_cancelled_at) + a cancelled lineage row', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const accessToken = await signIn();
    const suffix = `cancel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seed(admin, suffix, crypto.randomUUID());

    try {
      const piName = await dispatchCreatePi(accessToken, seeded);

      // Cancel the PI via verb:cancel.
      const cancelRes = await fetch(`${FUNCTIONS_URL}/functions/v1/adapter-dispatch`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'procurement',
          operation: 'transition',
          record: { id: seeded.piRecordId, erp_doc_kind: 'purchase-invoice', externalRecordId: piName, verb: 'cancel' },
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const cancelBody = (await cancelRes.json()) as { externalRecordId?: string; canonical?: { erp_docstatus?: number }; message?: string };
      expect(cancelRes.status, `PI cancel failed: ${cancelBody.message}`).toBe(200);
      expect(cancelBody.externalRecordId).toBe(piName);
      expect(cancelBody.canonical?.erp_docstatus).toBe(2);

      // PMO mirror: soft-tombstoned.
      const { data: piRow, error: piRowErr } = await admin.from('procurement_invoices').select('*').eq('id', seeded.piRecordId).maybeSingle();
      expect(piRowErr).toBeNull();
      expect(piRow).toMatchObject({ vi_number: piName, erp_docstatus: 2 });
      expect(piRow?.erp_cancelled_at, 'erp_cancelled_at must be set on a cancel tombstone').not.toBeNull();

      // Lineage row: reason='cancelled', no successor.
      const { data: lineageRows } = await admin
        .from('external_ref_lineage')
        .select('*')
        .eq('org_id', ORG_ID)
        .eq('domain', 'procurement')
        .eq('pmo_record_id', seeded.piRecordId)
        .eq('reason', 'cancelled');
      expect(lineageRows?.length).toBe(1);
      expect(lineageRows?.[0]).toMatchObject({ superseded_external_record_id: piName, successor_external_record_id: null, erp_docstatus: 2 });

      // ERP-side proof (optional): the PI is docstatus 2.
      if (ERPNEXT_ADMIN_KEY && ERPNEXT_ADMIN_SECRET) {
        const docRes = await fetch(`${ERPNEXT_BENCH_URL}/api/resource/Purchase%20Invoice/${encodeURIComponent(piName)}`, {
          headers: { Authorization: `token ${ERPNEXT_ADMIN_KEY}:${ERPNEXT_ADMIN_SECRET}` },
        });
        const doc = (await docRes.json()) as { data?: { docstatus?: number } };
        expect(doc.data?.docstatus).toBe(2);
      }
    } finally {
      await cleanup(admin, seeded);
    }
  });

  test('amend: a submitted PI amended via verb:amend -> external_refs repoints to the new name + erp_amended_from stamped + an amended lineage row + NO duplicate mirror row', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const accessToken = await signIn();
    const suffix = `amend-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seed(admin, suffix, crypto.randomUUID());

    try {
      const oldName = await dispatchCreatePi(accessToken, seeded);

      // The original external_refs mapping points at the old name.
      const { data: refBefore } = await admin
        .from('external_refs')
        .select('external_record_id')
        .eq('org_id', ORG_ID)
        .eq('domain', 'procurement')
        .eq('pmo_record_id', seeded.piRecordId)
        .maybeSingle();
      expect((refBefore as { external_record_id: string } | null)?.external_record_id).toBe(oldName);

      // Amend the PI via verb:amend (new line: 2 items @ 50000 = 100000).
      const amendRes = await fetch(`${FUNCTIONS_URL}/functions/v1/adapter-dispatch`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'procurement',
          operation: 'transition',
          record: {
            id: seeded.piRecordId,
            procurementId: seeded.procurementId,
            vendorId: seeded.companyId,
            erp_doc_kind: 'purchase-invoice',
            externalRecordId: oldName,
            verb: 'amend',
            items: [{ item_code: 'SPIKE-ITEM-1', qty: 2, rate: 50000 }],
          },
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const amendBody = (await amendRes.json()) as { externalRecordId?: string; canonical?: { erp_amended_from?: string }; message?: string };
      expect(amendRes.status, `PI amend failed: ${amendBody.message}`).toBe(200);
      const newName = amendBody.externalRecordId!;
      expect(newName, 'amend produces a NEW ERP name (ERPNext amended naming: <orig>-N)').not.toBe(oldName);
      expect(newName).toMatch(/^ACC-PINV-/);
      expect(amendBody.canonical?.erp_amended_from).toBe(oldName);

      // external_refs REPOINTS to the new name for the SAME pmo_record_id (no second mapping).
      const { data: refAfter } = await admin
        .from('external_refs')
        .select('external_record_id')
        .eq('org_id', ORG_ID)
        .eq('domain', 'procurement')
        .eq('pmo_record_id', seeded.piRecordId)
        .maybeSingle();
      expect((refAfter as { external_record_id: string } | null)?.external_record_id).toBe(newName);

      // Exactly ONE procurement_invoices mirror row (the amend reuses it — never a duplicate).
      const { data: mirrorRows } = await admin.from('procurement_invoices').select('id, vi_number, amount, erp_amended_from').eq('procurement_id', seeded.procurementId);
      expect(mirrorRows?.length, 'no duplicate mirror row — the amend repoints the SAME row').toBe(1);
      expect(mirrorRows?.[0]).toMatchObject({ id: seeded.piRecordId, vi_number: newName, erp_amended_from: oldName });
      expect(mirrorRows?.[0]?.amount).toBe(100000);

      // Lineage row: reason='amended', successor=new name, superseded=old name.
      const { data: lineageRows } = await admin
        .from('external_ref_lineage')
        .select('*')
        .eq('org_id', ORG_ID)
        .eq('domain', 'procurement')
        .eq('pmo_record_id', seeded.piRecordId)
        .eq('reason', 'amended');
      expect(lineageRows?.length).toBe(1);
      expect(lineageRows?.[0]).toMatchObject({ superseded_external_record_id: oldName, successor_external_record_id: newName });

      // ERP-side proof (optional): the new PI is docstatus 1 with amended_from = old name.
      if (ERPNEXT_ADMIN_KEY && ERPNEXT_ADMIN_SECRET) {
        const docRes = await fetch(`${ERPNEXT_BENCH_URL}/api/resource/Purchase%20Invoice/${encodeURIComponent(newName)}`, {
          headers: { Authorization: `token ${ERPNEXT_ADMIN_KEY}:${ERPNEXT_ADMIN_SECRET}` },
        });
        const doc = (await docRes.json()) as { data?: { docstatus?: number; amended_from?: string } };
        expect(doc.data?.docstatus).toBe(1);
        expect(doc.data?.amended_from).toBe(oldName);
      }
    } finally {
      await cleanup(admin, seeded);
    }
  });
});
