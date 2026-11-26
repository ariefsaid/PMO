// @e2e-isolation: self-isolated — each run creates its own disposable Foreman login (auth user, profile, workforce person) plus its own uniquely-named project, work order, crew and roster, and removes every row by its exact id; the shared seed user and the organisation setting are only read, never written.
/**
 * AC-LA-E2E — a Foreman's light account (#2710, OD-SCOPE-4). A disposable Foreman — its own login, not the shared seed Engineer —
 * leads a crew rostered on a work order today. Signing in lands on the one phone home screen; a typed project link returns to it;
 * the screen shows the four sections and the crew to tick; no navigation is offered.
 * Goal oracle: the Foreman can do their own jobs and cannot reach the project.
 *
 * Why an own actor: the role is a row on `profiles` (the authority the app and the RLS read). Two journeys that flip the one shared
 * seed Engineer's `built_in_role` race each other and every other Engineer journey in the parallel lane — the 2026-11-22 browser run
 * showed the light screen on the shared Engineer's procurement journey (AC-PFR-001) and a full Engineer shell here. A disposable
 * profile carries the same real role with a real JWT, and no other journey can read or clear it.
 */
import { jobRoleUser } from './support/jobRole';
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { requireServiceRoleKey } from './helpers';
import { inDays } from './support/jobJourney';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const PM_ID = '00000000-0000-0000-0000-0000000000a2';
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);

test.setTimeout(120_000);

let admin: SupabaseClient;
let run = '';
let email = '';
let password = '';
let foremanId = '';
let personId = '';
let projectId = '';
let workOrderId = '';
let crewId = '';

const need = <D>(step: string, r: { data: D; error: { message: string } | null }): NonNullable<D> => {
  if (r.error) throw new Error(`AC-LA-E2E ${step}: ${r.error.message}`);
  if (r.data === null || r.data === undefined) throw new Error(`AC-LA-E2E ${step}: no row returned`);
  return r.data as NonNullable<D>;
};

/**
 * Sign in the disposable Foreman through the real form (the same flow `e2e/auth.setup.ts` captures for the seed accounts).
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
  if (foremanId) {
    await attempt('remove profile', () => admin.from('profiles').delete().eq('id', foremanId));
    await attempt('remove login', () => admin.auth.admin.deleteUser(foremanId));
  }
  if (failures.length > 0) throw new Error(`AC-LA-E2E cleanup failed: ${failures.join('; ')}`);
}

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-LA-E2E needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });

  // Precondition, asserted and never written: #1670 made the organisation switch default to on and turned it on for every
  // existing row, so this journey reads it. Writing it here is what broke other journeys in the 2026-11-22 run.
  const org = need('read setting', await admin.from('organizations').select('built_in_roles_enabled').eq('id', ORG_ID).single());
  if (!org.built_in_roles_enabled) {
    throw new Error('AC-LA-E2E precondition: built_in_roles_enabled is off for this organisation (#1670 default is on)');
  }

  const suffix = crypto.randomUUID();
  run = `E2E-LA-${Date.now()}-${suffix.slice(0, 6)}`;
  email = `e2e-la-${suffix}@example.invalid`;
  password = `${crypto.randomUUID()}-Aa1!`;

  try {
    // A disposable Foreman: its own login, profile (the role lives on the profile row, as it does for every person) and
    // workforce person. The seeded Engineer keeps its own role, so no journey running beside this one can read this run's role.
    const actor = await jobRoleUser({ jobRole: 'foreman', role: 'Engineer', org: ORG_ID, service: admin, run: `e2e-la-${suffix}`, displayName: `${run} foreman` });
    foremanId = actor.id;
    email = actor.email;
    password = actor.password;
    personId = need('person', await admin.from('people').insert({
      org_id: ORG_ID, kind: 'own', code: `LA-${suffix.slice(0, 8)}`, name: `${run} foreman`, profile_id: foremanId,
    }).select('id').single()).id;
    projectId = need('project', await admin.from('projects').insert({ org_id: ORG_ID, name: run, status: 'Ongoing Project', project_manager_id: PM_ID }).select('id').single()).id;
    workOrderId = need('work order', await admin.from('work_orders').insert({
      org_id: ORG_ID, project_id: projectId, title: `${run} slab`, status: 'Issued', order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0,
    }).select('id').single()).id;
    crewId = need('crew', await admin.from('crews').insert({
      org_id: ORG_ID, code: `LA-${suffix.slice(0, 8)}`, name: `${run} crew`, kind: 'own', field_controller_id: foremanId,
    }).select('id').single()).id;
    const from = inDays(-2); // rostered two days back by the organisation's clock
    need('roster', await admin.from('work_order_crews').insert({
      org_id: ORG_ID, work_order_id: workOrderId, crew_id: crewId, valid_from: from,
    }).select('id').single());
  } catch (error) {
    try {
      await removeFixture();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'AC-LA-E2E fixture setup and partial cleanup failed', { cause: cleanupError });
    }
    throw error;
  }
});

test.afterEach(async () => {
  await removeFixture();
});

test('AC-LA-E2E a Foreman lands on the phone home screen and cannot open a project', async ({ page }) => {
  await signInAs(page, email, password);
  await page.goto('/');
  await expect(page).toHaveURL(/\/my$/);
  await expect(page.getByRole('heading', { name: 'My tasks' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Clock in' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Issues I reported' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'My crew today' })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await page.goto(`/projects/${projectId}`);
  await expect(page).toHaveURL(/\/my$/);
});

test('AC-LA-E2E-FOREMAN a Foreman clocks in himself on his crew\'s work order, and the home says so, with the time, after a reload', async ({ page }) => {
  await signInAs(page, email, password);
  // The card is this run's own work order, by its exact title: a sibling journey's work order must never match it.
  const card = page.getByRole('listitem').filter({ hasText: `${run} slab` });
  // The button is enabled, or says why it is not: never a dead grey button.
  await expect(card.getByRole('button', { name: 'Clock in' })).toBeEnabled();
  await expect(card.getByText(/Crew:/)).toBeVisible();
  await card.getByRole('button', { name: 'Clock in' }).click();
  await expect(card.getByText(/Clocked in at \d{1,2}:\d{2}/)).toBeVisible();
  await expect.poll(async () => ((await admin.from('attendance_days').select('source, crew_id').eq('work_order_id', workOrderId)).data ?? [])
    .map((r) => `${r.source}:${r.crew_id}`)).toEqual([`phone_check_in:${crewId}`]);
  // After a reload the card still says clocked in and offers no second tap that could answer "already clocked in".
  await page.reload();
  await expect(card.getByText(/Clocked in at \d{1,2}:\d{2}/)).toBeVisible();
  await expect(card.getByRole('button', { name: /Clock in/ })).toHaveCount(0);
});
