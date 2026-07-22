// @e2e-isolation: serial — shared helpers for the P3b timesheets served-fn e2e lane.
// Flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * Shared seed + cleanup for AC-TSP-010/011/020/022/031/040/041 (P3b, ADR-0059 Posture B).
 *
 * Seeds, per run (everything suffixed so two runs never collide):
 *  - TWO PMO `projects` rows + TWO freshly-created ERPNext `Project` docs, mapped to each other via
 *    the binding's `project_map` (the ONE project resolution `resolveTimesheetRefs` uses).
 *  - A pre-activated `external_org_bindings` row whose config carries `company`,
 *    `default_activity_type` and `timesheet_day_start` — all three are FAIL-CLOSED inputs of the
 *    timesheet push (`bodies/timesheet.ts` throws without them), plus `webhook_secret_ref` (the
 *    inbound lane's HMAC name; `resolveEmployingOrgs` filters out any binding lacking it).
 *  - The `external_domain_ownership` flip (`domain:'timesheets'`).
 *  - An `erp_employees` row for the sheet's AUTHOR with `link_state='confirmed'` + its
 *    `external_refs('timesheets')` mapping to the bench's real `Employee` — the ONLY thing that
 *    authorizes a push (FR-TSP-051); a 'proposed' link is deliberately not enough.
 *  - A `timesheets` row (status caller-chosen) + its `timesheet_entries`.
 *
 * The ERP is the ORACLE everywhere: a run-scoped ERPNext `Project` per test means "which documents
 * does this run own" is answerable from the bench itself, never from PMO state.
 *
 * Requires (process env — the same lane as `_sarHelpers.ts`): SUPABASE_FUNCTIONS_URL, SUPABASE_URL /
 * VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY / SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
 * ERPNEXT_BENCH_API_KEY / ERPNEXT_BENCH_API_SECRET (host-side bench calls), ERPNEXT_SITE_URL
 * (`http://host.docker.internal:8080`, Docker-reachable FROM the served fn), ERPNEXT_BENCH_URL
 * (`http://localhost:8080`, host-reachable from the test process), ERPNEXT_SWEEP_SECRET +
 * DEMO_ERP_WEBHOOK_SECRET (forwarded into the fn env by scripts/serve-functions.sh).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const ORG_ID = '00000000-0000-0000-0000-000000000001';
export const ERPNEXT_SITE_URL = process.env.ERPNEXT_SITE_URL ?? 'http://host.docker.internal:8080';
export const BENCH_URL = process.env.ERPNEXT_BENCH_URL ?? 'http://localhost:8080';
export const BENCH_KEY = process.env.ERPNEXT_BENCH_API_KEY ?? '';
export const BENCH_SECRET = process.env.ERPNEXT_BENCH_API_SECRET ?? '';
export const SWEEP_SECRET = process.env.ERPNEXT_SWEEP_SECRET ?? 'e2e-erpnext-sweep-secret';
export const WEBHOOK_SECRET = process.env.DEMO_ERP_WEBHOOK_SECRET ?? 'e2e-erpnext-webhook-secret';

export const ERP_COMPANY = 'PMO Smoke Co';
export const ERP_ACTIVITY_TYPE = 'Execution';
export const ERP_EMPLOYEE = 'HR-EMP-00001';

/** Seed actors (the AC-911 dedicated pair): Grace authors the week, Heidi is her line manager. */
export const AUTHOR_EMAIL = 'ts-approve-eng@acme.test';
export const AUTHOR_ID = '00000000-0000-0000-0000-0000000000b1';
export const MANAGER_EMAIL = 'ts-approve-mgr@acme.test';
export const MANAGER_ID = '00000000-0000-0000-0000-0000000000b2';
export const ADMIN_EMAIL = 'admin@acme.test';
export const ADMIN_ID = '00000000-0000-0000-0000-0000000000a5';
export const SEED_PASSWORD = 'Passw0rd!dev';

const benchHeaders = (): Record<string, string> => ({
  Authorization: `token ${BENCH_KEY}:${BENCH_SECRET}`,
  'Content-Type': 'application/json',
});

/** A live-bench GET (never a mock). Returns the parsed `data` payload. */
export async function benchGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${BENCH_URL}${path}`, { headers: benchHeaders() });
  const body = (await res.json()) as { data?: T };
  if (!res.ok) throw new Error(`bench GET ${path} -> ${res.status} ${JSON.stringify(body)}`);
  return body.data as T;
}

export async function benchPost<T = unknown>(doctype: string, body: unknown): Promise<T> {
  // Frappe's naming-series counter (`tabSeries`) can raise a QueryDeadlockError under back-to-back
  // inserts. That is bench plumbing, not product behaviour — retry it rather than let it masquerade as
  // a failed AC. Any other non-2xx throws immediately.
  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${BENCH_URL}/api/resource/${encodeURIComponent(doctype)}`, {
      method: 'POST',
      headers: benchHeaders(),
      body: JSON.stringify(body),
    });
    const parsed = (await res.json()) as { data?: T; exc_type?: string };
    if (res.ok) return parsed.data as T;
    last = `bench POST ${doctype} -> ${res.status} ${JSON.stringify(parsed).slice(0, 400)}`;
    if (parsed.exc_type !== 'QueryDeadlockError') throw new Error(last);
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  throw new Error(last);
}

export async function benchPut<T = unknown>(doctype: string, name: string, body: unknown): Promise<T> {
  const res = await fetch(`${BENCH_URL}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: benchHeaders(),
    body: JSON.stringify(body),
  });
  const parsed = (await res.json()) as { data?: T };
  if (!res.ok) throw new Error(`bench PUT ${doctype}/${name} -> ${res.status} ${JSON.stringify(parsed)}`);
  return parsed.data as T;
}

/** Every ERPNext `Timesheet` whose recovery ANCHOR (`note`, doctypeRegistry) carries this run's key.
 *  The run-scoped duplicate oracle: two originators minting two documents is visible HERE, in ERP,
 *  and nowhere in PMO. */
export async function listErpTimesheetsByAnchor(idempotencyKey: string): Promise<Array<{ name: string; docstatus: number }>> {
  const filters = encodeURIComponent(JSON.stringify([['note', 'like', `%${idempotencyKey}%`]]));
  const fields = encodeURIComponent(JSON.stringify(['name', 'docstatus']));
  return (await benchGet(`/api/resource/Timesheet?limit_page_length=0&filters=${filters}&fields=${fields}`)) as Array<{
    name: string;
    docstatus: number;
  }>;
}

/** The bench's total Timesheet count — the "no ERP request was ever issued" oracle for the gate tests. */
export async function countErpTimesheets(): Promise<number> {
  const rows = (await benchGet('/api/resource/Timesheet?limit_page_length=0&fields=%5B%22name%22%5D')) as unknown[];
  return rows.length;
}

/** Create a run-scoped ERPNext `Project` and return its ERP `name` (PROJ-#####). */
export async function createErpProject(label: string): Promise<string> {
  const doc = (await benchPost('Project', { project_name: label, company: ERP_COMPANY })) as { name: string };
  return doc.name;
}

export interface TspSeed {
  suffix: string;
  projectAId: string;
  projectBId: string;
  erpProjectA: string;
  erpProjectB: string;
  /** The `erp_employees` row id (the `external_refs` pmo_record_id for the Employee mapping). */
  employeeRowId: string;
  /** Every `timesheets.id` this run created — cleanup deletes each. */
  timesheetIds: string[];
}

export interface SeedTimesheetInput {
  status: 'Draft' | 'Submitted' | 'Approved' | 'Rejected';
  weekStartDate: string;
  entries: Array<{ projectId: string; entryDate: string; hours: string }>;
  approvedBy?: string | null;
  approvedAt?: string | null;
  userId?: string;
}

/** Seed the shared org for a timesheets e2e: 2 PMO+ERP projects, the binding, the flip, the confirmed
 *  Employee link. */
export async function seedTsp(admin: SupabaseClient, suffix: string): Promise<TspSeed> {
  const projectAId = crypto.randomUUID();
  const projectBId = crypto.randomUUID();
  const erpProjectA = await createErpProject(`PMO-E2E-TSP-A-${suffix}`);
  const erpProjectB = await createErpProject(`PMO-E2E-TSP-B-${suffix}`);

  const { error: projErr } = await admin.from('projects').insert([
    { id: projectAId, org_id: ORG_ID, name: `TSP-PROJ-A-${suffix}`, status: 'Ongoing Project' },
    { id: projectBId, org_id: ORG_ID, name: `TSP-PROJ-B-${suffix}`, status: 'Ongoing Project' },
  ]);
  if (projErr) throw new Error(`seed projects failed: ${projErr.message}`);

  await upsertTspBinding(admin, { [projectAId]: erpProjectA, [projectBId]: erpProjectB });

  const { error: flipErr } = await admin
    .from('external_domain_ownership')
    .upsert({ org_id: ORG_ID, external_tier: 'erpnext', domain: 'timesheets' }, { onConflict: 'org_id,external_tier,domain' });
  if (flipErr) throw new Error(`seed external_domain_ownership failed: ${flipErr.message}`);

  // Residue from a run that died between seed and cleanup would violate
  // `erp_employees_confirmed_profile_uq` (one CONFIRMED Employee per PMO user) and fail every later run
  // at seed time — a self-inflicted red that says nothing about the product.
  await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'timesheets').eq('external_record_id', `Employee:${ERP_EMPLOYEE}`);
  await admin.from('erp_employees').delete().eq('org_id', ORG_ID).eq('profile_id', AUTHOR_ID);

  const employeeRowId = crypto.randomUUID();
  const { error: empErr } = await admin.from('erp_employees').insert({
    id: employeeRowId,
    org_id: ORG_ID,
    employee_number: ERP_EMPLOYEE,
    employee_name: 'Grace TSApprove',
    work_email: AUTHOR_EMAIL,
    profile_id: AUTHOR_ID,
    link_state: 'confirmed',
    linked_by: ADMIN_ID,
    linked_at: new Date().toISOString(),
  });
  if (empErr) throw new Error(`seed erp_employees failed: ${empErr.message}`);

  // The ERP target comes from external_refs, never from the mirrored display column.
  const { error: refErr } = await admin.from('external_refs').upsert(
    {
      org_id: ORG_ID,
      domain: 'timesheets',
      pmo_record_id: employeeRowId,
      external_tier: 'erpnext',
      external_record_id: `Employee:${ERP_EMPLOYEE}`,
    },
    { onConflict: 'org_id,domain,external_record_id' },
  );
  if (refErr) throw new Error(`seed external_refs (employee) failed: ${refErr.message}`);

  return { suffix, projectAId, projectBId, erpProjectA, erpProjectB, employeeRowId, timesheetIds: [] };
}

/**
 * Add this run's timesheet config to the org's erpnext binding.
 *
 * ⚑ MERGE, never clobber. An org has exactly ONE `(org_id, external_tier)` binding row and several
 * domains share it, so a plain upsert of "my" config silently deletes the other lane's
 * `project_map`/account defaults — which surfaces as a bogus `activity-type-unconfigured` /
 * `project-unmapped` failure in a completely different spec. Merging keeps the row honest about the
 * whole org, which is also what production looks like.
 */
export async function upsertTspBinding(admin: SupabaseClient, projectMap: Record<string, string>): Promise<void> {
  const { data: existing } = await admin
    .from('external_org_bindings')
    .select('config')
    .eq('org_id', ORG_ID)
    .eq('external_tier', 'erpnext')
    .maybeSingle();
  const priorConfig = ((existing as { config?: Record<string, unknown> } | null)?.config ?? {}) as Record<string, unknown>;
  const priorMap = (priorConfig.project_map as Record<string, string> | undefined) ?? {};
  const { error } = await admin.from('external_org_bindings').upsert(
    {
      org_id: ORG_ID,
      external_tier: 'erpnext',
      site_url: ERPNEXT_SITE_URL,
      secret_ref: 'local-bench',
      webhook_secret_ref: 'DEMO_ERP_WEBHOOK_SECRET',
      version_major: 15,
      config: {
        ...priorConfig,
        company: ERP_COMPANY,
        default_activity_type: ERP_ACTIVITY_TYPE,
        timesheet_day_start: '09:00:00',
        project_map: { ...priorMap, ...projectMap },
      },
      activated_at: new Date().toISOString(),
    },
    { onConflict: 'org_id,external_tier' },
  );
  if (error) throw new Error(`seed external_org_bindings failed: ${error.message}`);
}

/** Seed one timesheet + its entries in the requested state. Records the id on the seed for cleanup. */
export async function seedTimesheet(admin: SupabaseClient, seed: TspSeed, input: SeedTimesheetInput): Promise<string> {
  const timesheetId = crypto.randomUUID();
  const { error } = await admin.from('timesheets').insert({
    id: timesheetId,
    org_id: ORG_ID,
    user_id: input.userId ?? AUTHOR_ID,
    week_start_date: input.weekStartDate,
    status: input.status,
    submitted_at: input.status === 'Draft' ? null : new Date().toISOString(),
    approved_by: input.approvedBy === undefined ? (input.status === 'Approved' ? MANAGER_ID : null) : input.approvedBy,
    approved_at:
      input.approvedAt === undefined ? (input.status === 'Approved' ? new Date().toISOString() : null) : input.approvedAt,
  });
  if (error) throw new Error(`seed timesheets failed: ${error.message}`);
  if (input.entries.length > 0) {
    const { error: entryErr } = await admin.from('timesheet_entries').insert(
      input.entries.map((e) => ({
        org_id: ORG_ID,
        timesheet_id: timesheetId,
        project_id: e.projectId,
        entry_date: e.entryDate,
        hours: e.hours,
      })),
    );
    if (entryErr) throw new Error(`seed timesheet_entries failed: ${entryErr.message}`);
  }
  seed.timesheetIds.push(timesheetId);
  return timesheetId;
}

/** Read the server's own `approved_at` witness — the input the deterministic key is derived from. */
export async function readApprovedAt(admin: SupabaseClient, timesheetId: string): Promise<string> {
  const { data, error } = await admin.from('timesheets').select('approved_at').eq('id', timesheetId).maybeSingle();
  if (error) throw new Error(`read approved_at failed: ${error.message}`);
  const approvedAt = (data as { approved_at: string | null } | null)?.approved_at;
  if (!approvedAt) throw new Error(`timesheet ${timesheetId} has no approved_at witness`);
  return approvedAt;
}

/**
 * Cancel every ERPNext Timesheet this run pushed.
 *
 * ⚑ ERP's `validate_overlap_for('employee')` considers every NON-cancelled Timesheet on the bench, for
 * all time. A run that leaves its documents submitted therefore poisons later runs with `OverlapError`
 * — a self-inflicted red that says nothing about the product. The anchor (`note` = the deterministic
 * push key `ts:<timesheet_id>:<approved_at>`) identifies exactly this run's documents.
 */
async function cancelErpTimesheetsFor(timesheetId: string): Promise<void> {
  try {
    const docs = await listErpTimesheetsByAnchor(timesheetId);
    for (const doc of docs) {
      if (doc.docstatus === 1) await benchPut('Timesheet', doc.name, { docstatus: 2 });
    }
  } catch {
    // Best effort: teardown must never mask the test's own result.
  }
}

/** Un-flip + delete everything this run created. Never touches another run's rows. */
export async function cleanupTsp(admin: SupabaseClient, seed: TspSeed): Promise<void> {
  for (const timesheetId of seed.timesheetIds) {
    await cancelErpTimesheetsFor(timesheetId);
    await admin.from('external_command_outbox').delete().eq('org_id', ORG_ID).eq('domain', 'timesheets').eq('pmo_record_id', timesheetId);
    await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'timesheets').eq('pmo_record_id', timesheetId);
    await admin.from('external_ref_lineage').delete().eq('org_id', ORG_ID).eq('domain', 'timesheets').eq('pmo_record_id', timesheetId);
    await admin.from('timesheet_erp_mirror').delete().eq('timesheet_id', timesheetId);
    // The action-required surface this run raised (dedupe is keyed on unread rows — leaving them behind
    // would suppress the NEXT run's own notification and quietly gut its assertion).
    await admin.from('notifications').delete().eq('org_id', ORG_ID).contains('metadata', { timesheetId });
    await admin.from('notifications').delete().eq('org_id', ORG_ID).contains('metadata', { pmoRecordId: timesheetId });
    await admin.from('timesheet_entries').delete().eq('timesheet_id', timesheetId);
    await admin.from('timesheets').delete().eq('id', timesheetId);
  }
  await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'timesheets').eq('pmo_record_id', seed.employeeRowId);
  await admin.from('erp_employees').delete().eq('id', seed.employeeRowId);
  await admin.from('projects').delete().in('id', [seed.projectAId, seed.projectBId]);
  await admin.from('external_domain_ownership').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext').eq('domain', 'timesheets');
  await admin.from('external_org_bindings').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
}

/**
 * A Monday no other run (or other test in this run) has used.
 *
 * ⚑ Not a nicety: ERPNext's `validate_overlap_for('employee')` refuses a Timesheet whose `time_logs`
 * overlap ANY other non-cancelled Timesheet for the same Employee, across the whole bench and across
 * every previous run. Fixed calendar dates therefore make a spec pass exactly once and then fail with
 * `OverlapError` forever — which would look like a product defect and is not one. The base slot varies
 * per run (wall clock) and the cursor guarantees distinctness within a run.
 */
let weekCursor = 0;
const RUN_WEEK_EPOCH_MONDAY = Date.UTC(2027, 0, 4); // a Monday
/** A random per-process base so two runs minutes apart cannot land on the same week either. */
const RUN_WEEK_BASE = Math.floor(Math.random() * 3000);

export function runWeek(): { weekStartDate: string; day1: string; day2: string } {
  const slot = RUN_WEEK_BASE + ((Math.floor(Date.now() / 1000) % 500) * 3) + weekCursor++;
  const monday = RUN_WEEK_EPOCH_MONDAY + slot * 7 * 86_400_000;
  const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
  return { weekStartDate: iso(monday), day1: iso(monday), day2: iso(monday + 86_400_000) };
}

/** Sign in as a seed user and return the access token (the served-fn caller JWT). */
export async function signInAs(authUrl: string, anonKey: string, email: string): Promise<string> {
  const authClient = createClient(authUrl, anonKey);
  const { data, error } = await authClient.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error || !data.session) throw new Error(`sign-in failed for ${email}: ${error?.message}`);
  return data.session.access_token;
}

/** The DETERMINISTIC timesheet push key — the ONE derivation both originators use
 *  (`src/lib/adapterSeam/erpnext/timesheetPushKey.ts`); restated here so a spec can predict it. */
export function timesheetPushKeyFor(timesheetId: string, approvedAt: string): string {
  return `ts:${timesheetId}:${approvedAt}`;
}

/** POST a timesheet push command at the REAL served `adapter-dispatch` (never `page.route`). */
export async function dispatchTimesheetPush(
  functionsUrl: string,
  anonKey: string,
  accessToken: string,
  record: Record<string, unknown>,
  idempotencyKey: string,
  faultSeam?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
  if (faultSeam) headers['x-erpnext-test-fault'] = faultSeam;
  return fetch(`${functionsUrl}/functions/v1/adapter-dispatch`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      domain: 'timesheets',
      operation: 'create',
      record: { erp_doc_kind: 'timesheet', ...record },
      idempotencyKey,
    }),
  });
}

/** Drive the REAL `erpnext-sweep` tick (the push's SECOND originator). */
export async function runSweep(functionsUrl: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${functionsUrl}/functions/v1/erpnext-sweep`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SWEEP_SECRET}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  return { status: res.status, body: await res.json() };
}

/** The `action-required` operator surface: `notifications` whose metadata carries this reason. */
export async function actionRequiredNotifications(
  admin: SupabaseClient,
  reason: string,
  detail: Record<string, unknown> = {},
): Promise<Array<{ id: string; body: string; metadata: Record<string, unknown> }>> {
  const { data, error } = await admin
    .from('notifications')
    .select('id, body, metadata')
    .eq('org_id', ORG_ID)
    .contains('metadata', { action_required: reason, ...detail });
  if (error) throw new Error(`notifications read failed: ${error.message}`);
  return (data ?? []) as Array<{ id: string; body: string; metadata: Record<string, unknown> }>;
}

/** Read the run's side-mirror row (ADR-0059 §6). */
export async function readTsMirror(
  admin: SupabaseClient,
  timesheetId: string,
): Promise<{
  push_state: string;
  push_error: string | null;
  ts_number: string | null;
  erp_total_hours: string | number | null;
  erp_docstatus: number | null;
  erp_cancelled_at: string | null;
  approved_at_pushed: string | null;
} | null> {
  const { data, error } = await admin
    .from('timesheet_erp_mirror')
    .select('push_state, push_error, ts_number, erp_total_hours, erp_docstatus, erp_cancelled_at, approved_at_pushed')
    .eq('org_id', ORG_ID)
    .eq('timesheet_id', timesheetId)
    .maybeSingle();
  if (error) throw new Error(`mirror read failed: ${error.message}`);
  return data as never;
}
