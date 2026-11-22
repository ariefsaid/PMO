// @e2e-isolation: self-isolated — creates its own uniquely-named project, work order (with an area), crew, person and roster each run; turns the seeded Engineer into a Field user for the run and clears it after; the organization setting is restored to its prior value.
/**
 * AC-PCI-E2E — clock in by phone at the work location (#2705). A Field user (light account) is rostered on a work order that has an
 * area. Inside the area the check-in is recorded; outside it becomes a request, and the Admin approves it from Crews so attendance
 * exists. Geolocation is mocked through the browser context (never a real position).
 * Goal oracle: attendance is recorded where the work is; off-area goes to the supervisor, not straight into attendance.
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

test.setTimeout(150_000);

let admin: SupabaseClient;
let projectId = '';
let workOrderId = '';
let crewId = '';
let personId = '';
let createdPerson = false;
let priorSetting = false;
const run = `E2E-PCI-${Date.now()}`;

const need = <D>(step: string, r: { data: D; error: { message: string } | null }): NonNullable<D> => {
  if (r.error) throw new Error(`AC-PCI-E2E ${step}: ${r.error.message}`);
  if (r.data === null || r.data === undefined) throw new Error(`AC-PCI-E2E ${step}: no row returned`);
  return r.data as NonNullable<D>;
};

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-PCI-E2E needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  priorSetting = need('read setting', await admin.from('organizations').select('built_in_roles_enabled').eq('id', ORG_ID).single()).built_in_roles_enabled;
  need('enable', await admin.from('organizations').update({ built_in_roles_enabled: true }).eq('id', ORG_ID).select('id').single());
  projectId = need('project', await admin.from('projects').insert({ org_id: ORG_ID, name: run, status: 'Ongoing Project', project_manager_id: PM_ID }).select('id').single()).id;
  workOrderId = need('work order', await admin.from('work_orders').insert({
    org_id: ORG_ID, project_id: projectId, title: `${run} slab`, status: 'Issued', order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0,
    area_lat: -6.2, area_lng: 106.8, area_radius_m: 150,
  }).select('id').single()).id;
  crewId = need('crew', await admin.from('crews').insert({
    org_id: ORG_ID, code: run.slice(-18), name: `${run} crew`, kind: 'own',
  }).select('id').single()).id;
  // One live person per profile: reuse one another journey left, create only when none exists, and remember which.
  const live = await admin.from('people').select('id').eq('org_id', ORG_ID).eq('profile_id', ENGINEER_ID).is('archived_at', null).maybeSingle();
  if (live.error) throw new Error(`AC-PCI-E2E live person: ${live.error.message}`);
  createdPerson = !live.data;
  personId = live.data?.id ?? need('person', await admin.from('people').insert({ org_id: ORG_ID, kind: 'own', name: `${run} person`, profile_id: ENGINEER_ID }).select('id').single()).id;
  const from = new Date(); from.setDate(from.getDate() - 2);
  const day = from.toISOString().slice(0, 10);
  need('member', await admin.from('crew_members').insert({ org_id: ORG_ID, crew_id: crewId, worker_id: personId, valid_from: day }).select('id').single());
  need('roster', await admin.from('work_order_crews').insert({ org_id: ORG_ID, work_order_id: workOrderId, crew_id: crewId, valid_from: day }).select('id').single());
  need('role', await admin.from('profiles').update({ built_in_role: 'field_user' }).eq('id', ENGINEER_ID).select('id').single());
});

test.afterEach(async () => {
  await admin.from('profiles').update({ built_in_role: null }).eq('id', ENGINEER_ID);
  await admin.from('phone_check_ins').delete().eq('work_order_id', workOrderId);
  await admin.from('attendance_days').delete().eq('work_order_id', workOrderId);
  await admin.from('work_order_crews').delete().eq('crew_id', crewId);
  await admin.from('crew_members').delete().eq('crew_id', crewId);
  if (createdPerson) await admin.from('people').delete().eq('id', personId);
  await admin.from('organizations').update({ built_in_roles_enabled: priorSetting }).eq('id', ORG_ID);
});

test('AC-PCI-E2E inside the area records attendance; outside goes to the supervisor who approves or refuses, and the worker is told each time', async ({ browser }) => {
  const mine = (p: import('@playwright/test').Page) => p.getByRole('listitem').filter({ hasText: `${run} slab` });
  // Outside first: about 1.1 km north of the area centre.
  const worker = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: -6.19, longitude: 106.8, accuracy: 10 } });
  const page = await worker.newPage();
  await signIn(page, 'engineer@acme.test', { home: '/my' });
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
  const supervisor = await browser.newContext();
  const adminPage = await supervisor.newPage();
  await signIn(adminPage, 'admin@acme.test');
  await adminPage.goto('/');
  await adminPage.getByText(/check-ins? waiting for your decision/).first().click();
  await expect(adminPage).toHaveURL(/\/crews/);
  await expect(adminPage.getByRole('heading', { name: 'Check-ins waiting for you' })).toBeVisible();
  // The area they judge against is on the request.
  await expect(adminPage.getByText(/Work area: centre -6\.2, 106\.8, radius 150 m/)).toBeVisible();
  // First decision: refuse with a reason; the worker sees the reason and can try again.
  await adminPage.getByRole('button', { name: 'Reject' }).first().click();
  await adminPage.getByRole('textbox').fill('too far from the gate');
  await adminPage.getByRole('button', { name: /reject/i }).last().click();
  await expect(adminPage.getByLabel('Notifications alt+T').getByText('Check-in rejected')).toBeVisible();
  await page.reload();
  await expect(mine(page).getByText(/refused this check-in: too far from the gate/)).toBeVisible();
  await expect(mine(page).getByRole('button', { name: 'Clock in again' })).toBeVisible();

  // Second try, still outside: approve this time; the worker's home says clocked in, with the time.
  await mine(page).getByRole('button', { name: 'Clock in again' }).click();
  await expect(mine(page).getByText(/Waiting for .+ to approve/)).toBeVisible();
  await adminPage.goto('/crews');
  await expect(adminPage.getByRole('heading', { name: 'Check-ins waiting for you' })).toBeVisible();
  await adminPage.getByRole('button', { name: 'Approve' }).click();
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
  await worker.close();
  await supervisor.close();
});
