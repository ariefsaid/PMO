/**
 * AC-ENA-051 — Request for Quotation + Supplier Quotation at the real served `adapter-dispatch`
 * boundary (FR-ENA-111, FR-ENA-112, FR-ENA-130; plan design decision 5 — never `page.route`). Pushes
 * one RFQ + two Supplier Quotations (ERPNext holds the native docs); selects ONE quotation in PMO
 * (`is_selected`, a PMO-only enhancement — never sent to ERP, FR-ENA-112); asserts
 * `procurement_quotations.total_amount` mirrors the ERP `grand_total` and EXACTLY one `is_selected`
 * row exists per `procurement_id` (`procurement_quotations_one_selected_idx` intact under the flip).
 *
 * LOCAL-ONLY — same lane/bench discipline as AC-ENA-050-purchase-request.spec.ts (see that file's
 * header for the full rationale). Requires the same env vars, plus ERPNEXT_SITE_URL to seed the
 * binding row.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ERPNEXT_SITE_URL = process.env.ERPNEXT_SITE_URL ?? '';

const ADMIN_EMAIL = 'admin@acme.test';
const SEED_PASSWORD = 'Passw0rd!dev';
const ORG_ID = '00000000-0000-0000-0000-000000000001';

const LANE_READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY);
if (!LANE_READY && process.env.CI) {
  throw new Error('AC-ENA-051: the served-fn lane vars are required whenever CI runs this spec — this spec cannot silently skip in CI');
}
if (LANE_READY && !SERVICE_KEY) {
  throw new Error('AC-ENA-051: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available — this spec seeds/cleans up via the service-role client');
}
test.skip(!LANE_READY, 'AC-ENA-051: served-fn lane not up — run via scripts/with-db-lock.sh scripts/serve-functions.sh');
test.skip(!ERPNEXT_SITE_URL, 'AC-ENA-051: ERPNEXT_SITE_URL not set — this spec needs the local ERPNext v15 dev bench (docs/environments.md)');

test.setTimeout(90_000);

async function dispatch(functionsUrl: string, anonKey: string, accessToken: string, body: unknown) {
  const res = await fetch(`${functionsUrl}/functions/v1/adapter-dispatch`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { externalRecordId?: string; canonical?: Record<string, unknown>; message?: string };
  return { status: res.status, ...json };
}

test.describe('AC-ENA-051: RFQ + Supplier Quotation — served adapter-dispatch boundary', () => {
  test('one RFQ + two Supplier Quotations pushed; selecting one in PMO preserves the one-selected invariant + mirrors total_amount', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const authClient = createClient(AUTH_URL, ANON_KEY);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const procurementId = crypto.randomUUID();
    const companyId = crypto.randomUUID();
    const rfqPmoId = crypto.randomUUID();
    const quoteAPmoId = crypto.randomUUID();
    const quoteBPmoId = crypto.randomUUID();

    await admin.from('external_org_bindings').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
    const { error: bindingError } = await admin.from('external_org_bindings').insert({
      org_id: ORG_ID,
      external_tier: 'erpnext',
      site_url: ERPNEXT_SITE_URL,
      secret_ref: 'ac-ena-051-test-only',
      version_major: 15,
      config: { company: 'PMO Smoke Co' },
      activated_at: new Date().toISOString(),
    });
    expect(bindingError).toBeNull();

    const { error: procError } = await admin
      .from('procurements')
      .insert({ id: procurementId, org_id: ORG_ID, code: `ENA051-${suffix}`, title: 'AC-ENA-051 RFQ/SQ case', status: 'Draft' });
    expect(procError).toBeNull();

    // A PMO company + the external_refs mapping to the bench's pre-existing "Spike Supplier"
    // (docs/spikes/2026-07-11-erpnext-pe-mandatory-fields.md — the R9 spike's own fixture).
    const { error: companyError } = await admin.from('companies').insert({ id: companyId, org_id: ORG_ID, name: 'Spike Supplier (AC-ENA-051)', type: 'Vendor' });
    expect(companyError).toBeNull();
    const { error: refError } = await admin
      .from('external_refs')
      .insert({ org_id: ORG_ID, domain: 'companies', pmo_record_id: companyId, external_tier: 'erpnext', external_record_id: 'Supplier:Spike Supplier' });
    expect(refError).toBeNull();

    try {
      const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({ email: ADMIN_EMAIL, password: SEED_PASSWORD });
      if (signInError || !signInData.session) throw new Error(`AC-ENA-051: sign-in failed: ${signInError?.message}`);
      const accessToken = signInData.session.access_token;

      // 1. RFQ (ERPNext Request for Quotation) — supplier + item rows.
      const rfqResult = await dispatch(FUNCTIONS_URL, ANON_KEY, accessToken, {
        domain: 'procurement',
        operation: 'create',
        record: {
          id: rfqPmoId,
          procurementId,
          vendorId: companyId,
          erp_doc_kind: 'rfq',
          items: [{ item_code: 'SPIKE-ITEM-1', qty: 5, schedule_date: '2026-08-05' }],
        },
        idempotencyKey: `ac-ena-051-rfq-${suffix}`,
      });
      expect(rfqResult.status, `RFQ create failed: ${rfqResult.message ?? ''}`).toBe(200);

      // 2. Two Supplier Quotations, different rates -> different grand_total.
      const quoteAResult = await dispatch(FUNCTIONS_URL, ANON_KEY, accessToken, {
        domain: 'procurement',
        operation: 'create',
        record: { id: quoteAPmoId, procurementId, vendorId: companyId, erp_doc_kind: 'quotation', items: [{ item_code: 'SPIKE-ITEM-1', qty: 5, rate: 42000 }] },
        idempotencyKey: `ac-ena-051-sq-a-${suffix}`,
      });
      expect(quoteAResult.status, `Quotation A create failed: ${quoteAResult.message ?? ''}`).toBe(200);

      const quoteBResult = await dispatch(FUNCTIONS_URL, ANON_KEY, accessToken, {
        domain: 'procurement',
        operation: 'create',
        record: { id: quoteBPmoId, procurementId, vendorId: companyId, erp_doc_kind: 'quotation', items: [{ item_code: 'SPIKE-ITEM-1', qty: 5, rate: 39000 }] },
        idempotencyKey: `ac-ena-051-sq-b-${suffix}`,
      });
      expect(quoteBResult.status, `Quotation B create failed: ${quoteBResult.message ?? ''}`).toBe(200);

      // The read-model mirror upserted both procurement_quotations rows via the service role — assert
      // total_amount mirrors each ERP grand_total exactly (the money oracle, FR-ENA-071).
      const { data: mirroredQuotes } = await admin
        .from('procurement_quotations')
        .select('id, total_amount, is_selected')
        .in('id', [quoteAPmoId, quoteBPmoId]);
      const rowA = mirroredQuotes?.find((r) => r.id === quoteAPmoId);
      const rowB = mirroredQuotes?.find((r) => r.id === quoteBPmoId);
      expect(rowA?.total_amount).toBe('210000.00'); // 5 * 42000
      expect(rowB?.total_amount).toBe('195000.00'); // 5 * 39000
      expect(rowA?.is_selected).toBe(false);
      expect(rowB?.is_selected).toBe(false);

      // 3. Select ONE quotation in PMO (is_selected — a PMO-only enhancement, never sent to ERP;
      // stays user-writable even while `procurement` is externally-owned, FR-ENA-112/130).
      const { error: selectError } = await admin.from('procurement_quotations').update({ is_selected: true }).eq('id', quoteBPmoId);
      expect(selectError).toBeNull();

      const { data: selectedRows } = await admin.from('procurement_quotations').select('id, is_selected').eq('procurement_id', procurementId);
      const selected = selectedRows?.filter((r) => r.is_selected) ?? [];
      expect(selected).toHaveLength(1); // procurement_quotations_one_selected_idx holds under the flip
      expect(selected[0]?.id).toBe(quoteBPmoId);
    } finally {
      await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'procurement').in('pmo_record_id', [rfqPmoId, quoteAPmoId, quoteBPmoId]);
      await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'companies').eq('pmo_record_id', companyId);
      await admin.from('procurement_quotations').delete().in('id', [quoteAPmoId, quoteBPmoId]);
      await admin.from('rfqs').delete().eq('id', rfqPmoId);
      await admin.from('companies').delete().eq('id', companyId);
      await admin.from('procurements').delete().eq('id', procurementId);
      await admin.from('external_org_bindings').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
    }
  });
});
