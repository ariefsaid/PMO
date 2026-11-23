// @e2e-isolation: self-isolated — each run creates its own disposable Field-user login (auth user, profile, workforce person) plus its own uniquely-named project, work order with an area, crew, crew member and roster, and removes every row by its exact id; the shared seed user and the organisation setting are only read, never written.
/**
 * AC-PCI-E2E — clock in by phone at the work location (#2705). A disposable Field user (light account) — its own login, not the
 * shared seed Engineer — is rostered on a work order that has an area. Inside the area the check-in is recorded; outside it becomes
 * a request, and the Admin approves it from Crews so attendance exists. Geolocation is mocked through the browser context (never a
 * real position).
 * Goal oracle: attendance is recorded where the work is; off-area goes to the supervisor, not straight into attendance.
 *
 * Why an own actor: the role is a row on `profiles` (the authority the app and the RLS read). Flipping the one shared seed Engineer's
 * `built_in_role` here leaked into the journey that ran beside it in the 2026-11-22 browser run: AC-PFR-001, signed in as that same
 * Engineer, rendered this journey's light home (and this journey's slab) instead of the project procurement page. A disposable profile
 * carries the same real role with a real JWT, and no other journey can read or clear it.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const PM_ID = '00000000-0000-0000-0000-0000000000a2';
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);

test.setTimeout(150_000);

let admin: SupabaseClient;
let run = '';
let email = '';
let password = '';
let workerId = '';
let projectId = '';
let workOrderId = '';
let crewId = '';
let personId = '';

const need = <D>(step: string, r: { data: D; error: { message: string } | null }): NonNullable<D> => {
  if (r.error) throw new Error(`AC-PCI-E2E ${step}: ${r.error.message}`);
  if (r.data === null || r.data === undefined) throw new Error(`AC-PCI-E2E ${step}: no row returned`);
  return r.data as NonNullable<D>;
};

/**
 * Sign in the disposable Field user through the real form (the same flow `e2e/auth.setup.ts` captures for the seed accounts).
 * `signIn()` replays a captured storage state, which exists only for the seed emails — a user created mid-run has none, and
 * signing this one in for real is what gives the journey a genuine JWT and lets the database and the shell read the profile row.
 */
async function signInAs(page: Page, as: string, secret: string) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(as);
  await page.getByLabel(/password/i).fill(secret);
  await page.getByRole('button', { name: /sign in/i }).click();
  // A light account lands on its one phone home screen instead of the full shell.
  await expect(page).toHaveURL(/\/my$/, { timeout: 20_000 });
}

/** Remove every row this run created, by its own exact id; nothing shared and nothing another journey owns is touched. */
async function removeFixture() {
  const failures: string[] = [];
  const attempt = async (step: string, operation: () => PromiseLike<{ error: { message: string } | null }>) => {
    try {
      const { error } = await operation();
      if (error) failures.push(`${step}: ${error.message}`);
    } catch (error) {
      failures.push(`${step}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  if (workOrderId) {
    await attempt('remove check-ins', () => admin.from('phone_check_ins').delete().eq('work_order_id', workOrderId));
    await attempt('remove attendance', () => admin.from('attendance_days').delete().eq('work_order_id', workOrderId));
  }
  if (crewId) {
    await attempt('remove roster', () => admin.from('work_order_crews').delete().eq('crew_id', crewId));
    await attempt('remove crew members', () => admin.from('crew_members').delete().eq('crew_id', crewId));
  }
  if (personId) await attempt('remove person', () => admin.from('people').delete().eq('id', personId));
  if (crewId) await attempt('remove crew', () => admin.from('crews').delete().eq('id', crewId));
  if (workOrderId) await attempt('remove work order', () => admin.from('work_orders').delete().eq('id', workOrderId));
  if (projectId) await attempt('remove project', () => admin.from('projects').delete().eq('id', projectId));
  if (workerId) {
    await attempt('remove profile', () => admin.from('profiles').delete().eq('id', workerId));
    await attempt('remove login', () => admin.auth.admin.deleteUser(workerId));
  }
  if (failures.length > 0) throw new Error(`AC-PCI-E2E cleanup failed: ${failures.join('; ')}`);
}

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-PCI-E2E needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });

  // Precondition, asserted and never written: #1670 made the organisation switch default to on and turned it on for every
  // existing row, so this journey reads it. Writing it here is what broke other journeys in the 2026-11-22 run.
  const org = need('read setting', await admin.from('organizations').select('built_in_roles_enabled').eq('id', ORG_ID).single());
  if (!org.built_in_roles_enabled) {
    throw new Error('AC-PCI-E2E precondition: built_in_roles_enabled is off for this organisation (#1670 default is on)');
  }

  const suffix = crypto.randomUUID();
  run = `E2E-PCI-${Date.now()}-${suffix.slice(0, 6)}`;
  email = `e2e-pci-${suffix}@example.invalid`;
  password = `${crypto.randomUUID()}-Aa1!`;

  try {
    // A disposable Field user: its own login, profile (the role lives on the profile row, as it does for every person) and
    // workforce person. The seeded Engineer keeps its own role, so no journey running beside this one can read this run's role.
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) {
      throw new Error(`AC-PCI-E2E login: ${created.error?.message ?? 'no user returned'}`);
    }
    workerId = created.data.user.id;
    need('profile', await admin.from('profiles').insert({
      id: workerId, org_id: ORG_ID, email, full_name: `${run} field user`, role: 'Engineer', built_in_role: 'field_user',
    }).select('id').single());
    personId = need('person', await admin.from('people').insert({
      org_id: ORG_ID, kind: 'own', code: `PCI-${suffix.slice(0, 8)}`, name: `${run} person`, profile_id: workerId,
    }).select('id').single()).id;
    projectId = need('project', await admin.from('projects').insert({ org_id: ORG_ID, name: run, status: 'Ongoing Project', project_manager_id: PM_ID }).select('id').single()).id;
    workOrderId = need('work order', await admin.from('work_orders').insert({
      org_id: ORG_ID, project_id: projectId, title: `${run} slab`, status: 'Issued', order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0,
      area_lat: -6.2, area_lng: 106.8, area_radius_m: 150,
    }).select('id').single()).id;
    crewId = need('crew', await admin.from('crews').insert({
      org_id: ORG_ID, code: `PCI-${suffix.slice(0, 8)}`, name: `${run} crew`, kind: 'own',
    }).select('id').single()).id;
    const from = new Date(); from.setDate(from.getDate() - 2);
    const day = from.toISOString().slice(0, 10);
    need('member', await admin.from('crew_members').insert({ org_id: ORG_ID, crew_id: crewId, worker_id: personId, valid_from: day }).select('id').single());
    need('roster', await admin.from('work_order_crews').insert({ org_id: ORG_ID, work_order_id: workOrderId, crew_id: crewId, valid_from: day }).select('id').single());
  } catch (error) {
    try {
      await removeFixture();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'AC-PCI-E2E fixture setup and partial cleanup failed', { cause: cleanupError });
    }
    throw error;
  }
});

test.afterEach(async () => {
  await removeFixture();
});

test('AC-PCI-E2E inside the area records attendance; outside goes to the supervisor who approves or refuses, and the worker is told each time', async ({ browser }) => {
  // This run's own work order, by its exact title: a sibling journey's work order must never match it.
  const mine = (p: Page) => p.getByRole('listitem').filter({ hasText: `${run} slab` });
  // Outside first: about 1.1 km north of the area centre.
  const worker = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: -6.19, longitude: 106.8, accuracy: 10 } });
  // The supervisor's context is only opened mid-journey, so it stays nullable: a failure before it opens — or the failure to
  // open it — must still tear down the worker context that was opened first.
  let supervisor: BrowserContext | undefined;
  // Both contexts are this test's own and are closed whatever the outcome — a failed assertion, a timeout, or the
  // failure to open the supervisor's context at all. A close failure is collected here, never thrown from the
  // teardown itself: a failed journey must propagate as itself, so a collected failure is surfaced after a
  // successful journey instead.
  const closeFailures: string[] = [];
  try {
    const page = await worker.newPage();
    await signInAs(page, email, password);
    await page.goto('/my');
    await expect(page.getByRole('heading', { name: 'Clock in' })).toBeVisible();
    await mine(page).getByRole('button', { name: 'Clock in' }).click();
    // Waiting state: says it is waiting and who decides; it survives a reload; no second tap is offered.
    await expect(mine(page).getByText(/outside the work area/i)).toBeVisible();
    await expect(mine(page).getByText(/Waiting for .+ to approve/)).toBeVisible();
    await page.reload();
    await expect(mine(page).getByText(/Waiting for .+ to approve/)).toBeVisible();
    await expect(mine(page).getByRole('button', { name: /Clock in/ })).toHaveCount(0);
    const before = await admin.from('attendance_days').select('id').eq('work_order_id', workOrderId);
    expect(before.data ?? []).toHaveLength(0);

    // The supervisor is told where they already look: the home list of things needing them; one tap opens the request.
    supervisor = await browser.newContext();
    const adminPage = await supervisor.newPage();
    await signIn(adminPage, 'admin@acme.test');
    await adminPage.goto('/');
    await adminPage.getByText(/check-ins? waiting for your decision/).first().click();
    await expect(adminPage).toHaveURL(/\/crews/);
    await expect(adminPage.getByRole('heading', { name: 'Check-ins waiting for you' })).toBeVisible();
    // The decision is made on this run's own request, not on whatever else the organisation happens to be waiting for.
    const request = adminPage.getByRole('listitem').filter({ hasText: `${run} slab` });
    // The area they judge against is on the request.
    await expect(request.getByText(/Work area: centre -6\.2, 106\.8, radius 150 m/)).toBeVisible();
    // First decision: refuse with a reason; the worker sees the reason and can try again.
    await request.getByRole('button', { name: 'Reject' }).click();
    const reason = adminPage.getByRole('dialog');
    await reason.getByRole('textbox').fill('too far from the gate');
    await reason.getByRole('button', { name: /^reject$/i }).click();
    await expect(adminPage.getByLabel('Notifications alt+T').getByText('Check-in rejected')).toBeVisible();
    await page.reload();
    await expect(mine(page).getByText(/refused this check-in: too far from the gate/)).toBeVisible();
    await expect(mine(page).getByRole('button', { name: 'Clock in again' })).toBeVisible();

    // Second try, still outside: approve this time; the worker's home says clocked in, with the time.
    await mine(page).getByRole('button', { name: 'Clock in again' }).click();
    await expect(mine(page).getByText(/Waiting for .+ to approve/)).toBeVisible();
    await adminPage.goto('/crews');
    await expect(adminPage.getByRole('heading', { name: 'Check-ins waiting for you' })).toBeVisible();
    await request.getByRole('button', { name: 'Approve' }).click();
    await expect(adminPage.getByLabel('Notifications alt+T').getByText('Check-in approved')).toBeVisible();
    await expect.poll(async () => ((await admin.from('attendance_days').select('id').eq('work_order_id', workOrderId)).data ?? []).length).toBe(1);
    await page.reload();
    await expect(mine(page).getByText(/Clocked in at \d{1,2}:\d{2}/)).toBeVisible();

    // Inside the area on a fresh day records straight away (the records are cleared to stand in for the next day).
    await admin.from('attendance_days').delete().eq('work_order_id', workOrderId);
    await admin.from('phone_check_ins').delete().eq('work_order_id', workOrderId);
    await worker.setGeolocation({ latitude: -6.2, longitude: 106.8, accuracy: 10 });
    await page.goto('/my');
    await mine(page).getByRole('button', { name: 'Clock in' }).click();
    await expect(mine(page).getByText(/Clocked in at \d{1,2}:\d{2}/)).toBeVisible();
    await expect.poll(async () => ((await admin.from('attendance_days').select('source').eq('work_order_id', workOrderId)).data ?? []).map((r) => r.source)).toEqual(['phone_check_in']);
  } finally {
    // Teardown never throws: a throw here would mask the journey's own failure (and ESLint rejects it). Each context
    // that fails to close is recorded as an occurrence in the list, which is read by count, so a falsy thrown value is
    // still a failure — an error occurrence is never confused with truthiness.
    for (const [name, context] of [['worker', worker], ['supervisor', supervisor]] as const) {
      if (!context) continue;
      try {
        await context.close();
      } catch (error) {
        closeFailures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // Reached only when the journey itself succeeded: a journey failure has already propagated untouched from the try
  // above. The collected close failure is surfaced here, after the teardown, instead of being thrown from inside it.
  if (closeFailures.length > 0) {
    throw new Error(`AC-PCI-E2E context close failed: ${closeFailures.join('; ')}`);
  }
});
