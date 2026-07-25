// @e2e-isolation: serial — shared helpers for the SAR served-fn e2e lane.
// Flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * Shared seed + cleanup for AC-SAR-040/041/010/011/042/043/050/071.
 *
 * Seeds:
 * - A Client `companies` row + `external_refs` (`Customer:<name>`).
 * - A `projects` row (PMO uuid + ERP name via binding `project_map`).
 * - A pre-activated `external_org_bindings` row with receivable-side account defaults:
 *   `default_receivable_account='Debtors - PSC'`, `default_income_account='Sales - PSC'`,
 *   `default_cash_account='Cash - PSC'`, and `project_map` (ERP project name by PMO project id).
 * - The `external_domain_ownership` flip (`domain:'revenue'`).
 *
 * Cleanup deletes the `revenue` ownership + binding rows (the "un-flip" note) + all seeded mirror
 * rows + outbox + external_refs. Uses `ORG_ID=00000000-0000-0000-0000-000000000001`.
 * `EDGE_JWT_ISSUER` lane is the served-fn JWT path (P2 FR-ENA-001..003).
 * Served-fn secrets shared between the test and the served fn (the Director exports them;
 * `scripts/serve-functions.sh` forwards them from the shell env into the fn env; the specs read the
 * SAME value from their own process env): the inbound WEBHOOK lane's HMAC `DEMO_ERP_WEBHOOK_SECRET`
 * (the binding's `webhook_secret_ref`, default 'e2e-erpnext-webhook-secret') AND the SWEEP lane's
 * dedicated bearer `ERPNEXT_SWEEP_SECRET` (`erpnext-sweep` constant-time-compares the
 * `Authorization: Bearer` to it, default 'e2e-erpnext-sweep-secret' — AC-SAR-043 uses both).
 * Bench URLs: `ERPNEXT_SITE_URL=http://host.docker.internal:8080` (Docker-reachable from served fn),
 * `ERPNEXT_BENCH_URL=http://localhost:8080` (host-reachable for test-process optional verification).
 * SEED the binding's `site_url` with `SITE_URL` (the AC-ENA-040 lesson: a localhost binding is
 * container-unreachable → external-unreachable).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const ERPNEXT_SITE_URL = process.env.ERPNEXT_SITE_URL ?? 'http://host.docker.internal:8080';
const ORG_ID = '00000000-0000-0000-0000-000000000001';

const ADMIN_EMAIL = 'admin@acme.test';
const APPROVER_EMAIL = 'finance@acme.test';
const SEED_PASSWORD = 'Passw0rd!dev';

export interface SARSeed {
  companyId: string;
  projectId: string;
  siRecordId: string;
  ipRecordId: string;
  procurementId?: string; // not used in SAR but kept for possible cross-domain cases
}

const BINDING_CONFIG = {
  company: 'PMO Smoke Co',
  default_receivable_account: 'Debtors - PSC',
  default_income_account: 'Sales - PSC',
  default_cash_account: 'Cash - PSC',
  // Project map: PMO project_id (uuid) -> ERP project name (e.g., PROJ-0001).
  // The dispatch resolves the ERP name by searching for project_name; the map is an OVERRIDE
  // for pre-existing ERP projects with mismatched names (Director ruling §5.1).
  project_map: {} as Record<string, string>,
};

/** Sign in as admin (author/creator) and return the access token. */
export async function signInAdmin(authUrl: string, anonKey: string): Promise<string> {
  const authClient = createClient(authUrl, anonKey);
  const { data, error } = await authClient.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: SEED_PASSWORD,
  });
  if (error || !data.session) throw new Error(`sign-in failed: ${error?.message}`);
  return data.session.access_token;
}

/** Sign in as finance approver (SoD: approver ≠ author) and return the access token. */
export async function signInApprover(authUrl: string, anonKey: string): Promise<string> {
  const authClient = createClient(authUrl, anonKey);
  const { data, error } = await authClient.auth.signInWithPassword({
    email: APPROVER_EMAIL,
    password: SEED_PASSWORD,
  });
  if (error || !data.session) throw new Error(`approver sign-in failed: ${error?.message}`);
  return data.session.access_token;
}

/** Seed the shared org for SAR e2e: Customer company + Project + binding + revenue flip. */
export async function seedSAR(admin: SupabaseClient, suffix: string): Promise<SARSeed> {
  const companyId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const siRecordId = crypto.randomUUID();
  const ipRecordId = crypto.randomUUID();

  // 1) Client company + external_refs mapping. The PMO `companies.type` enum is
  // 'Internal'|'Client'|'Vendor' — an ERP Customer mirrors to PMO type='Client' (FR-ENA-091), NOT the
  // ERP doctype name 'Customer'. The PMO company `name` is suffixed for per-run uniqueness, but
  // `external_refs` maps to the FIXED bench-fixture ERP Customer name 'Spike Customer' (mirrors P2's
  // `Supplier:Spike Supplier` in AC-ENA-053) — the dispatch resolves the bare Customer name from this
  // mapping (stripping the `Customer:` prefix), and that ERP Customer must pre-exist on the bench.
  const customerName = `Spike Customer ${suffix}`;
  const { error: companyErr } = await admin.from('companies').insert({
    id: companyId,
    org_id: ORG_ID,
    name: customerName,
    type: 'Client',
  });
  if (companyErr) throw new Error(`seed companies failed: ${companyErr.message}`);

  // UPSERT on (org_id, domain, external_record_id) — across serial specs the FIXED
  // external_record_id 'Customer:Spike Customer' is re-seeded each run; a plain .insert()
  // violates external_refs_org_domain_extid_key (migration 0093). The conflict updates
  // pmo_record_id to the current companyId, so cleanupSAR's delete-by-pmo_record_id still
  // lands. The goal — a Customer party ref for the dispatch to resolve — stays intact.
  const { error: refErr } = await admin.from('external_refs').upsert(
    {
      org_id: ORG_ID,
      domain: 'companies',
      pmo_record_id: companyId,
      external_tier: 'erpnext',
      external_record_id: 'Customer:Spike Customer',
    },
    { onConflict: 'org_id,domain,external_record_id' },
  );
  if (refErr) throw new Error(`seed external_refs (companies) failed: ${refErr.message}`);

  // 2) Project row (PMO uuid) — the ERP project name will be resolved via the binding's
  // project_map (if set) or by searching ERP for project_name == PMO project name.
  // For e2e we control the bench so we can seed the project_map with a known ERP name.
  const projectName = `SPIKE-PROJ-${suffix}`;
  const { error: projectErr } = await admin.from('projects').insert({
    id: projectId,
    org_id: ORG_ID,
    name: projectName,
    status: 'Ongoing Project', // project_status enum has no 'Active' — 'Ongoing Project' is the live value
  });
  if (projectErr) throw new Error(`seed projects failed: ${projectErr.message}`);

  // Update the binding config with this project's ERP name override (the e2e seeds the ERP
  // project name via the binding config project_map — matches Director ruling: search-by-name
  // + auto-create-on-miss, with project_map as an optional override).
  const bindingConfigWithProject = {
    ...BINDING_CONFIG,
    project_map: { [projectId]: `PROJ-0001` }, // ERP auto-names to PROJ-#####; override with known name
  };

  // 3.5) Pre-create the ERP Customer 'Spike Customer' so native ERP SI creation (AC-SAR-043)
  // and native PE-receive references work. The bench fixture expects 'Spike Customer' to exist.
  // We upsert via ERP API using the admin creds (best-effort; ignores 409 if exists).
  try {
    await fetch(`${ERPNEXT_SITE_URL}/api/resource/Customer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `token ${process.env.ERPNEXT_BENCH_API_KEY}:${process.env.ERPNEXT_BENCH_API_SECRET}`,
      },
      body: JSON.stringify({ customer_name: 'Spike Customer', customer_type: 'Company', customer_group: 'All Customer Groups', territory: 'All Territories' }),
    });
    // Ignore 409 (already exists) or other errors — the bench may already have it
  } catch {
    // best effort; bench may already have the fixture
  }

  // 3) Pre-activated binding with receivable-side defaults + project_map. `webhook_secret_ref` is
  //    REQUIRED for the inbound webhook lane (AC-SAR-043): `resolveEmployingOrgs` filters out any
  //    binding lacking it, so the webhook fn would 401 every event without it. It points at a
  //    function-secret env name (`DEMO_ERP_WEBHOOK_SECRET`) the served fn resolves via Deno.env —
  //    the developer sets its VALUE in `supabase/functions/.env.local` (local-only, gitignored);
  //    the test signs the webhook body with the SAME value (AC-SAR-043 reads
  //    DEMO_ERP_WEBHOOK_SECRET from its own process env, default 'e2e-erpnext-webhook-secret').
  const { error: bindingErr } = await admin.from('external_org_bindings').upsert(
    {
      org_id: ORG_ID,
      external_tier: 'erpnext',
      site_url: ERPNEXT_SITE_URL,
      secret_ref: 'local-bench',
      webhook_secret_ref: 'DEMO_ERP_WEBHOOK_SECRET',
      version_major: 15,
      config: bindingConfigWithProject,
      activated_at: new Date().toISOString(),
    },
    { onConflict: 'org_id,external_tier' },
  );
  if (bindingErr) throw new Error(`seed external_org_bindings failed: ${bindingErr.message}`);

  // 4) Revenue domain flip
  const { error: flipErr } = await admin
    .from('external_domain_ownership')
    .upsert(
      { org_id: ORG_ID, external_tier: 'erpnext', domain: 'revenue' },
      { onConflict: 'org_id,external_tier,domain' },
    );
  if (flipErr) throw new Error(`seed external_domain_ownership failed: ${flipErr.message}`);

  return { companyId, projectId, siRecordId, ipRecordId };
}

/** Cleanup the SAR seed: un-flip revenue + delete binding + mirror rows + refs + companies + project. */
export async function cleanupSAR(admin: SupabaseClient, seeded: SARSeed): Promise<void> {
  // Un-flip: delete the revenue ownership row (the "un-flip note" per plan)
  await admin
    .from('external_domain_ownership')
    .delete()
    .eq('org_id', ORG_ID)
    .eq('external_tier', 'erpnext')
    .eq('domain', 'revenue');

  // Delete the binding (created/updated by seed)
  await admin
    .from('external_org_bindings')
    .delete()
    .eq('org_id', ORG_ID)
    .eq('external_tier', 'erpnext');

  // Mirror tables (sales_invoices / incoming_payments) — delete by the procurement/case id is not
  // applicable for SAR (no procurement_id). Delete by the known record ids.
  await admin.from('sales_invoices').delete().eq('id', seeded.siRecordId);
  await admin.from('incoming_payments').delete().eq('id', seeded.ipRecordId);

  // Lineage (if any cancel/amend created them)
  await admin
    .from('external_ref_lineage')
    .delete()
    .eq('org_id', ORG_ID)
    .eq('domain', 'revenue')
    .eq('pmo_record_id', seeded.siRecordId);
  await admin
    .from('external_ref_lineage')
    .delete()
    .eq('org_id', ORG_ID)
    .eq('domain', 'revenue')
    .eq('pmo_record_id', seeded.ipRecordId);

  // Outbox rows (for the record ids we used)
  await admin
    .from('external_command_outbox')
    .delete()
    .eq('org_id', ORG_ID)
    .eq('domain', 'revenue')
    .eq('pmo_record_id', seeded.siRecordId);
  await admin
    .from('external_command_outbox')
    .delete()
    .eq('org_id', ORG_ID)
    .eq('domain', 'revenue')
    .eq('pmo_record_id', seeded.ipRecordId);

  // external_refs for revenue domain
  await admin
    .from('external_refs')
    .delete()
    .eq('org_id', ORG_ID)
    .eq('domain', 'revenue')
    .eq('pmo_record_id', seeded.siRecordId);
  await admin
    .from('external_refs')
    .delete()
    .eq('org_id', ORG_ID)
    .eq('domain', 'revenue')
    .eq('pmo_record_id', seeded.ipRecordId);

  // external_refs for companies (the Customer mapping)
  await admin
    .from('external_refs')
    .delete()
    .eq('org_id', ORG_ID)
    .eq('domain', 'companies')
    .eq('pmo_record_id', seeded.companyId);

  // Companies + Project
  await admin.from('companies').delete().eq('id', seeded.companyId);
  await admin.from('projects').delete().eq('id', seeded.projectId);
}

/** Dispatch a create command for the revenue domain. */
export async function dispatchCreateRevenue(
  functionsUrl: string,
  anonKey: string,
  accessToken: string,
  record: Record<string, unknown>,
  erpDocKind: 'sales-invoice' | 'incoming-payment',
  idempotencyKey: string,
) {
  return fetch(`${functionsUrl}/functions/v1/adapter-dispatch`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      domain: 'revenue',
      operation: 'create',
      record: { ...record, erp_doc_kind: erpDocKind },
      idempotencyKey,
    }),
  });
}

/** Dispatch a transition command (submit/cancel/amend) for the revenue domain. */
export async function dispatchTransitionRevenue(
  functionsUrl: string,
  anonKey: string,
  accessToken: string,
  record: Record<string, unknown>,
  erpDocKind: 'sales-invoice' | 'incoming-payment',
  verb: 'submit' | 'cancel' | 'amend',
  idempotencyKey: string,
) {
  return fetch(`${functionsUrl}/functions/v1/adapter-dispatch`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      domain: 'revenue',
      operation: 'transition',
      record: { ...record, erp_doc_kind: erpDocKind, verb },
      idempotencyKey,
    }),
  });
}