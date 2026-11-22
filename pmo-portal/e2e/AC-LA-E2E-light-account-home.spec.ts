// @e2e-isolation: self-isolated — creates its own uniquely-named project, work order and crew each run; turns the seeded Engineer into a Foreman for the run and clears it after; the organization setting is restored to its prior value.
/**
 * AC-LA-E2E — a Foreman's light account (#2710, OD-SCOPE-4). The seeded Engineer is given the Foreman role, leads a crew
 * rostered on a work order today. Signing in lands on the one phone home screen; a typed project link returns to it; the
 * screen shows the four sections and the crew to tick; no navigation is offered.
 * Goal oracle: the Foreman can do their own jobs and cannot reach the project.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const PM_ID = '00000000-0000-0000-0000-0000000000a2';
const ENGINEER_ID = '00000000-0000-0000-0000-0000000000a4';
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);

test.setTimeout(120_000);

let admin: SupabaseClient;
let projectId = '';
let priorSetting = false;
let crewId = '';
let workOrderId = '';
let hadPerson = false;

const need = <D>(step: string, r: { data: D; error: { message: string } | null }): NonNullable<D> => {
  if (r.error) throw new Error(`AC-LA-E2E ${step}: ${r.error.message}`);
  if (r.data === null || r.data === undefined) throw new Error(`AC-LA-E2E ${step}: no row returned`);
  return r.data as NonNullable<D>;
};

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-LA-E2E needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  const run = `E2E-LA-${Date.now()}`;
  priorSetting = need('read setting', await admin.from('organizations').select('built_in_roles_enabled').eq('id', ORG_ID).single()).built_in_roles_enabled;
  need('enable', await admin.from('organizations').update({ built_in_roles_enabled: true }).eq('id', ORG_ID).select('id').single());
  projectId = need('project', await admin.from('projects').insert({ org_id: ORG_ID, name: run, status: 'Ongoing Project', project_manager_id: PM_ID }).select('id').single()).id;
  workOrderId = need('work order', await admin.from('work_orders').insert({
    org_id: ORG_ID, project_id: projectId, title: `${run} slab`, status: 'Issued', order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0,
  }).select('id').single()).id;
  crewId = need('crew', await admin.from('crews').insert({
    org_id: ORG_ID, code: run.slice(-18), name: `${run} crew`, kind: 'own', field_controller_id: ENGINEER_ID,
  }).select('id').single()).id;
  const from = new Date(); from.setDate(from.getDate() - 2);
  need('roster', await admin.from('work_order_crews').insert({
    org_id: ORG_ID, work_order_id: workOrderId, crew_id: crewId, valid_from: from.toISOString().slice(0, 10),
  }).select('id').single());
  // The Foreman clocks in himself: his first clock-in enters him in the workforce register when he is not there, and the journey removes that entry again.
  hadPerson = Boolean((await admin.from('people').select('id').eq('org_id', ORG_ID).eq('profile_id', ENGINEER_ID).is('archived_at', null).maybeSingle()).data);
  need('role', await admin.from('profiles').update({ built_in_role: 'foreman' }).eq('id', ENGINEER_ID).select('id').single());
});

test.afterEach(async () => {
  await admin.from('profiles').update({ built_in_role: null }).eq('id', ENGINEER_ID);
  await admin.from('phone_check_ins').delete().eq('work_order_id', workOrderId);
  await admin.from('attendance_days').delete().eq('work_order_id', workOrderId);
  await admin.from('work_order_crews').delete().eq('crew_id', crewId);
  if (!hadPerson) await admin.from('people').delete().eq('org_id', ORG_ID).eq('profile_id', ENGINEER_ID);
  await admin.from('organizations').update({ built_in_roles_enabled: priorSetting }).eq('id', ORG_ID);
});

test('AC-LA-E2E a Foreman lands on the phone home screen and cannot open a project', async ({ page }) => {
  await signIn(page, 'engineer@acme.test', { home: '/my' });
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
  await signIn(page, 'engineer@acme.test', { home: '/my' });
  const card = page.getByRole('listitem').filter({ hasText: 'slab' });
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
