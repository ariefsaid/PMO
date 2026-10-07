// @e2e-isolation: serial — drives the shared ERPNext bench and the served erpnext-sweep (which ticks every activated org).
/**
 * AC-ENA-062 (#901) — a cancel in ERPNext leaves actuals as if the document never posted.
 *
 * The user's goal: a project's actuals show what ERPNext says was spent on it. A Purchase Invoice charged
 * to the project raises them; cancelling it in ERPNext must bring them back down. ERPNext keeps a cancelled
 * document's ledger rows and flips them (`GL Entry.is_cancelled = 1`, bumping `modified`) plus adds
 * reversal rows; before #901 the sweep's incremental ledger fetch filtered those rows out, so the mirror
 * kept the originals live and actuals stayed overstated.
 *
 * Real boundaries only: the Docker v15 bench (real HTTP) and the served `erpnext-sweep` (ledger feed →
 * actuals refresh). Runs in a THROWAWAY org with its own activated binding and project map — the seed
 * org is never written by this spec.
 *
 * Run: scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *        scripts/e2e-local.sh --project=serial --workers=1 e2e/serial/AC-ENA-062
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SAR_CURRENCY } from './_sarHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const BENCH_URL = process.env.ERPNEXT_BENCH_URL ?? 'http://localhost:8080';
const BENCH_KEY = process.env.ERPNEXT_BENCH_API_KEY ?? '';
const BENCH_SECRET = process.env.ERPNEXT_BENCH_API_SECRET ?? '';
const SITE_URL_FOR_BINDING = process.env.ERPNEXT_SITE_URL ?? 'http://host.docker.internal:8080';
const SWEEP_SECRET = process.env.ERPNEXT_SWEEP_SECRET ?? 'e2e-erpnext-sweep-secret';

const COMPANY = 'PMO Smoke Co';
const SUPPLIER = 'Spike Supplier';
const ITEM_CODE = 'SPIKE-ITEM-1';
const AMOUNT = 125_000;

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && SERVICE_KEY && BENCH_KEY && BENCH_SECRET);
if (FUNCTIONS_URL && !READY) throw new Error('AC-ENA-062: the served lane is up but SUPABASE_SERVICE_ROLE_KEY / ERPNEXT_BENCH_* are missing — never a silent skip.');
test.skip(!READY, 'AC-ENA-062 requires the local served-functions lane and the throwaway ERPNext bench.');
test.setTimeout(240_000);

const benchHeaders = () => ({ Authorization: `token ${BENCH_KEY}:${BENCH_SECRET}`, 'Content-Type': 'application/json' });

async function bench(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${BENCH_URL}${path}`, { method, headers: benchHeaders(), body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (await res.json()) as { data?: Record<string, unknown>; exc_type?: string; _server_messages?: string };
  expect(res.status, `bench ${method} ${path}: ${json.exc_type ?? ''} ${json._server_messages ?? ''}`).toBe(200);
  return json.data ?? {};
}

/** One served sweep tick; returns THIS org's per-org result (the sweep ticks every activated org). */
async function sweep(orgId: string): Promise<{ errors: string[]; ledger?: { gl: number; ple: number } }> {
  type SweepBody = { perOrg?: Array<{ orgId: string; errors: string[]; ledger?: { gl: number; ple: number } }> };
  let res: Response;
  let text: string;
  // The local edge runtime kills a tick that exceeds its CPU budget (546 WORKER_LIMIT, or a dropped
  // response) — a host-load transient on the first, full-ledger tick (docs/environments.md). A killed tick
  // advances nothing, and re-ticking is what the cron does; the goal oracles below are unchanged.
  for (let attempt = 0; ; attempt += 1) {
    res = await fetch(`${FUNCTIONS_URL}/functions/v1/erpnext-sweep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SWEEP_SECRET}` },
      body: JSON.stringify({}),
    });
    text = await res.text();
    const killed = res.status === 546 || text.trim() === '';
    if (!killed || attempt >= 2) break;
  }
  const body = (text ? JSON.parse(text) : {}) as SweepBody;
  expect(res.status, text.slice(0, 500)).toBe(200);
  const mine = body.perOrg?.find((o) => o.orgId === orgId);
  expect(mine, 'the sweep ticked the throwaway org').toBeTruthy();
  return mine!;
}

/** The project's actuals as the budget screen reads them: Σ net over its erp_actuals_snapshot rows. */
async function projectActuals(admin: SupabaseClient, orgId: string, projectId: string): Promise<{ net: number; debit: number }> {
  const { data, error } = await admin.from('erp_actuals_snapshot').select('net, debit').eq('org_id', orgId).eq('project_id', projectId);
  expect(error).toBeNull();
  const rows = (data ?? []) as Array<{ net: number | string | null; debit: number | string | null }>;
  return {
    net: rows.reduce((s, r) => s + Number(r.net ?? 0), 0),
    debit: rows.reduce((s, r) => s + Number(r.debit ?? 0), 0),
  };
}

test('AC-ENA-062: cancelling a Purchase Invoice in ERPNext brings the project actuals back down after the sweep', async () => {
  const admin = createClient(AUTH_URL, SERVICE_KEY);
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const orgId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  let piName: string | null = null;

  // A throwaway tenant: org + project + an activated binding mapping the project to a fresh ERP Project.
  const erpProject = String((await bench('POST', '/api/resource/Project', { project_name: `AC-ENA-062 ${suffix}`, company: COMPANY })).name);
  expect((await admin.from('organizations').insert({ id: orgId, name: `AC-ENA-062 ${suffix}` })).error).toBeNull();
  try {
    expect((await admin.from('projects').insert({
      id: projectId, org_id: orgId, name: `AC-ENA-062 Project ${suffix}`, status: 'Ongoing Project',
      currency: SAR_CURRENCY, subject_to_vat: false,
    })).error).toBeNull();
    expect((await admin.from('external_org_bindings').insert({
      org_id: orgId, external_tier: 'erpnext', site_url: SITE_URL_FOR_BINDING, secret_ref: 'local-bench',
      version_major: 15, status: 'active', connected_at: new Date().toISOString(), activated_at: new Date().toISOString(),
      config: {
        company: COMPANY,
        project_map: { [projectId]: erpProject },
        report_filter_shape: { company: COMPANY, ageing_based_on: 'Due Date', range1: 30, range2: 60, range3: 90, range4: 120 },
      },
    })).error).toBeNull();

    // Baseline: the first tick mirrors the company's ledger; nothing is charged to the new project yet.
    const first = await sweep(orgId);
    expect(first.errors.filter((e) => e.startsWith('ledger:'))).toEqual([]);
    expect(await projectActuals(admin, orgId, projectId)).toEqual({ net: 0, debit: 0 });

    // Post: a submitted Purchase Invoice charged to the project → actuals rise by its amount.
    const today = new Date().toISOString().slice(0, 10);
    piName = String((await bench('POST', '/api/resource/Purchase%20Invoice', {
      supplier: SUPPLIER, company: COMPANY, posting_date: today, bill_no: `AC-062-${suffix}`,
      items: [{ item_code: ITEM_CODE, qty: 1, rate: AMOUNT, project: erpProject }],
    })).name);
    await bench('PUT', `/api/resource/Purchase%20Invoice/${encodeURIComponent(piName)}`, { docstatus: 1 });
    const posted = await sweep(orgId);
    expect(posted.errors.filter((e) => e.startsWith('ledger:'))).toEqual([]);
    expect(await projectActuals(admin, orgId, projectId)).toEqual({ net: AMOUNT, debit: AMOUNT });

    // A further tick with nothing new still succeeds: the `modified >=` cursor re-sends the row it stopped
    // on, which must update in place (it used to 23505 on the mirror's (org_id, erp_name) key and freeze
    // the cursor, so nothing after the first tick ever arrived).
    const idle = await sweep(orgId);
    expect(idle.errors.filter((e) => e.startsWith('ledger:'))).toEqual([]);
    expect(idle.ledger?.gl, 'the boundary row was re-applied, not rejected').toBeGreaterThanOrEqual(1);
    expect(await projectActuals(admin, orgId, projectId)).toEqual({ net: AMOUNT, debit: AMOUNT });

    // Cancel in ERPNext → the next tick brings the project's actuals back to where they started.
    await bench('PUT', `/api/resource/Purchase%20Invoice/${encodeURIComponent(piName)}`, { docstatus: 2 });
    const cancelled = await sweep(orgId);
    expect(cancelled.errors.filter((e) => e.startsWith('ledger:'))).toEqual([]);
    expect(await projectActuals(admin, orgId, projectId)).toEqual({ net: 0, debit: 0 });

    // The mirror itself agrees with ERPNext: every GL row of the cancelled invoice is flagged cancelled.
    const { data: mirrored, error: mirrorErr } = await admin.from('erp_gl_entry_mirror')
      .select('erp_name, is_cancelled').eq('org_id', orgId).eq('voucher_no', piName);
    expect(mirrorErr).toBeNull();
    expect((mirrored ?? []).length).toBeGreaterThanOrEqual(4); // originals + reversals
    expect((mirrored ?? []).every((r) => r.is_cancelled === true)).toBe(true);
  } finally {
    if (piName) {
      const doc = await fetch(`${BENCH_URL}/api/resource/Purchase%20Invoice/${encodeURIComponent(piName)}`, { headers: benchHeaders() })
        .then((r) => r.json() as Promise<{ data?: { docstatus?: number } }>).catch(() => ({ data: undefined }));
      if (doc.data?.docstatus === 1) {
        await fetch(`${BENCH_URL}/api/resource/Purchase%20Invoice/${encodeURIComponent(piName)}`, { method: 'PUT', headers: benchHeaders(), body: JSON.stringify({ docstatus: 2 }) }).catch(() => undefined);
      }
    }
    for (const table of ['external_org_bindings', 'external_sync_watermarks', 'erp_gl_entry_mirror', 'erp_payment_ledger_mirror',
      'erp_actuals_snapshot', 'erp_ap_aging_snapshot', 'erp_ar_aging_snapshot', 'notifications', 'projects']) {
      await admin.from(table).delete().eq('org_id', orgId);
    }
    const { error: orgDelErr } = await admin.from('organizations').delete().eq('id', orgId);
    if (orgDelErr) console.warn(`AC-ENA-062 cleanup: organizations delete failed: ${orgDelErr.message}`);
  }
});
