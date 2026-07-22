// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state)
// AND creates/removes a second organization + its member for the cross-tenancy arms.
/**
 * AC-TSP-031 — cross-org links are rejected BEFORE the external write (FR-TSP-050, FR-TSP-054).
 *
 * Three ways a week of hours could cross a tenant boundary, all driven at the REAL served
 * `adapter-dispatch`:
 *   (a) a caller in org B dispatches the push for org A's approved sheet;
 *   (b) an org A sheet whose entry references ANOTHER org's project;
 *   (c) an author whose resolved `erp_employees` row belongs to another org.
 *
 * Then each is rejected before any ERP call and before any outbox claim — never after the commit. The
 * oracle is the bench itself: its Timesheet count is byte-identical across all three attempts. A
 * rejection that happens AFTER the write is not a rejection, it is a leak plus an error message.
 *
 * Run: scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test e2e/serial/AC-TSP-031
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  ORG_ID,
  ADMIN_EMAIL,
  SEED_PASSWORD,
  cleanupTsp,
  countErpTimesheets,
  dispatchTimesheetPush,
  readApprovedAt,
  runWeek,
  seedTimesheet,
  seedTsp,
  signInAs,
  timesheetPushKeyFor,
} from './_tspHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY);
if (!READY && process.env.CI) {
  throw new Error('AC-TSP-031: SUPABASE_FUNCTIONS_URL + SUPABASE_URL + VITE_SUPABASE_ANON_KEY are required in CI — this spec cannot silently skip');
}
if (READY && !SERVICE_KEY) throw new Error('AC-TSP-031: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available.');
test.skip(!READY, 'AC-TSP-031: served-fn lane not configured — run via scripts/serve-functions.sh against the ERPNext bench');

test.setTimeout(240_000);

interface OrgB {
  orgId: string;
  projectId: string;
  userId: string;
  email: string;
}

/** A genuinely separate tenant: its own organization row, its own project, its own member. */
async function createOrgB(admin: SupabaseClient, suffix: string): Promise<OrgB> {
  const orgId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const email = `tsp031-orgb-${suffix}@acme.test`;

  const { error: orgErr } = await admin.from('organizations').insert({ id: orgId, name: `TSP-031 Other Org ${suffix}` });
  if (orgErr) throw new Error(`seed organizations failed: ${orgErr.message}`);

  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email,
    password: SEED_PASSWORD,
    email_confirm: true,
  });
  if (userErr || !created.user) throw new Error(`create org-B user failed: ${userErr?.message}`);
  const userId = created.user.id;

  // The profile is the org seam the served fn resolves the caller's tenancy from.
  const { error: profileErr } = await admin
    .from('profiles')
    .upsert({ id: userId, org_id: orgId, email, full_name: 'Org B Admin', role: 'Admin', status: 'active' }, { onConflict: 'id' });
  if (profileErr) throw new Error(`seed org-B profile failed: ${profileErr.message}`);

  const { error: projErr } = await admin
    .from('projects')
    .insert({ id: projectId, org_id: orgId, name: `TSP-031 Other Org Project ${suffix}`, status: 'Ongoing Project' });
  if (projErr) throw new Error(`seed org-B project failed: ${projErr.message}`);

  return { orgId, projectId, userId, email };
}

async function cleanupOrgB(admin: SupabaseClient, orgB: OrgB): Promise<void> {
  await admin.from('projects').delete().eq('id', orgB.projectId);
  await admin.from('profiles').delete().eq('id', orgB.userId);
  await admin.auth.admin.deleteUser(orgB.userId).catch(() => undefined);
  await admin.from('organizations').delete().eq('id', orgB.orgId);
}

/** Every arm asserts the same GOAL: refused before the external write, no outbox claim, bench untouched. */
async function assertRefusedBeforeAnyWrite(
  admin: SupabaseClient,
  timesheetId: string,
  erpCountBefore: number,
  label: string,
): Promise<void> {
  const { data: outboxRows } = await admin
    .from('external_command_outbox')
    .select('id, state')
    .eq('domain', 'timesheets')
    .eq('pmo_record_id', timesheetId);
  expect(outboxRows ?? [], `${label}: no outbox claim was ever made — the refusal precedes the claim`).toHaveLength(0);
  // A side-mirror row is ALLOWED here and is not a leak: FR-TSP-085 requires a rejected push to leave
  // durable, operator-visible state (the user has moved on; nothing else would ever surface it). What it
  // must never say is that the push succeeded.
  const { data: mirrorRows } = await admin
    .from('timesheet_erp_mirror')
    .select('push_state, push_error, ts_number')
    .eq('timesheet_id', timesheetId);
  for (const row of (mirrorRows ?? []) as Array<{ push_state: string; push_error: string | null; ts_number: string | null }>) {
    expect(row.push_state, `${label}: a refused push is never recorded as pushed`).not.toBe('pushed');
    expect(row.ts_number, `${label}: no ERP document name is ever recorded for a refused push`).toBeNull();
    expect(row.push_error, `${label}: the refusal reason is recorded, not swallowed`).toBeTruthy();
  }
  expect(await countErpTimesheets(), `${label}: NOTHING reached the client ledger`).toBe(erpCountBefore);
}

test.describe('AC-TSP-031: a week of hours never crosses a tenant boundary', () => {
  test('AC-TSP-031 (a) a caller in another org cannot push this org\'s approved sheet — refused before any ERP call', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedTsp(admin, suffix);
    const orgB = await createOrgB(admin, suffix);
    try {
      const erpCountBefore = await countErpTimesheets();
      const week = runWeek();
      const sheet = await seedTimesheet(admin, seeded, {
        status: 'Approved',
        weekStartDate: week.weekStartDate,
        entries: [{ projectId: seeded.projectAId, entryDate: week.day1, hours: '4.00' }],
      });
      const key = timesheetPushKeyFor(sheet, await readApprovedAt(admin, sheet));
      const orgBToken = await signInAs(AUTH_URL, ANON_KEY, orgB.email);
      const res = await dispatchTimesheetPush(FUNCTIONS_URL, ANON_KEY, orgBToken, { id: sheet }, key);
      const body = (await res.json()) as { error?: string; message?: string };
      expect(res.status >= 400 && res.status < 500, `a caller from another org must be refused, got ${res.status} ${JSON.stringify(body)}`).toBe(true);
      expect(String(body.message ?? ''), 'the refusal names the tenancy/authorization failure').toMatch(/cross-org|not-authorized|not authorized|domain/i);
      await assertRefusedBeforeAnyWrite(admin, sheet, erpCountBefore, '(a) cross-org caller');
    } finally {
      // ⚑ ORDER MATTERS: this run's `timesheet_entries` FK-reference org B's project, so org B can only
      // be torn down AFTER `cleanupTsp` has removed them — otherwise the project delete is silently
      // FK-blocked and every run leaks an org-B project into the shared DB (which then fails the
      // seed-invariant pgTAP, `0012_budget_seed_invariant`: every project must have one Active budget).
      await cleanupTsp(admin, seeded);
      await cleanupOrgB(admin, orgB);
    }
  });

  test('AC-TSP-031 (b) an entry referencing ANOTHER org\'s project is rejected 422 cross-org-link-rejected before any ERP call', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedTsp(admin, suffix);
    const orgB = await createOrgB(admin, suffix);
    try {
      const erpCountBefore = await countErpTimesheets();
      const week = runWeek();
      const sheet = await seedTimesheet(admin, seeded, {
        status: 'Approved',
        weekStartDate: week.weekStartDate,
        entries: [{ projectId: orgB.projectId, entryDate: week.day1, hours: '3.00' }],
      });
      const key = timesheetPushKeyFor(sheet, await readApprovedAt(admin, sheet));
      const adminToken = await signInAs(AUTH_URL, ANON_KEY, ADMIN_EMAIL);
      const res = await dispatchTimesheetPush(FUNCTIONS_URL, ANON_KEY, adminToken, { id: sheet }, key);
      const body = (await res.json()) as { error?: string; message?: string };
      expect(String(body.error ?? body.message ?? ''), 'classified as a cross-org link rejection').toMatch(/cross-org-link-rejected/);
      await assertRefusedBeforeAnyWrite(admin, sheet, erpCountBefore, "(b) cross-org project");
      // The AC pins the classified refusal to 422 (the class every other pre-flight rejection uses);
      // a 4xx that says "malformed request" for a business rule is a different contract to the client.
      expect(res.status, `a cross-org project entry must be refused 422, got ${res.status} ${JSON.stringify(body)}`).toBe(422);
    } finally {
      // ⚑ ORDER MATTERS: this run's `timesheet_entries` FK-reference org B's project, so org B can only
      // be torn down AFTER `cleanupTsp` has removed them — otherwise the project delete is silently
      // FK-blocked and every run leaks an org-B project into the shared DB (which then fails the
      // seed-invariant pgTAP, `0012_budget_seed_invariant`: every project must have one Active budget).
      await cleanupTsp(admin, seeded);
      await cleanupOrgB(admin, orgB);
    }
  });

  test('AC-TSP-031 (c) an author whose resolved Employee row belongs to another org fails closed before any ERP call', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedTsp(admin, suffix);
    const orgB = await createOrgB(admin, suffix);
    try {
      const erpCountBefore = await countErpTimesheets();
      const { error: moveErr } = await admin.from('erp_employees').update({ org_id: orgB.orgId }).eq('id', seeded.employeeRowId);
      expect(moveErr).toBeNull();
      const week = runWeek();
      const sheet = await seedTimesheet(admin, seeded, {
        status: 'Approved',
        weekStartDate: week.weekStartDate,
        entries: [{ projectId: seeded.projectAId, entryDate: week.day1, hours: '2.00' }],
      });
      const key = timesheetPushKeyFor(sheet, await readApprovedAt(admin, sheet));
      const adminToken = await signInAs(AUTH_URL, ANON_KEY, ADMIN_EMAIL);
      const res = await dispatchTimesheetPush(FUNCTIONS_URL, ANON_KEY, adminToken, { id: sheet }, key);
      const body = (await res.json()) as { error?: string; message?: string };
      expect(String(body.error ?? body.message ?? ''), "another org's Employee row is not resolvable — the push fails closed").toMatch(
        /cross-org-link-rejected|employee-unlinked/,
      );
      await admin.from('erp_employees').update({ org_id: ORG_ID }).eq('id', seeded.employeeRowId);
      await assertRefusedBeforeAnyWrite(admin, sheet, erpCountBefore, '(c) cross-org employee');
      expect(res.status, `a cross-org employee link must be refused 422, got ${res.status} ${JSON.stringify(body)}`).toBe(422);
    } finally {
      await admin.from('erp_employees').update({ org_id: ORG_ID }).eq('id', seeded.employeeRowId);
      // ⚑ ORDER MATTERS: this run's `timesheet_entries` FK-reference org B's project, so org B can only
      // be torn down AFTER `cleanupTsp` has removed them — otherwise the project delete is silently
      // FK-blocked and every run leaks an org-B project into the shared DB (which then fails the
      // seed-invariant pgTAP, `0012_budget_seed_invariant`: every project must have one Active budget).
      await cleanupTsp(admin, seeded);
      await cleanupOrgB(admin, orgB);
    }
  });
});
