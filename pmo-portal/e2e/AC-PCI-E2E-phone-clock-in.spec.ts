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

test('AC-PCI-E2E inside the area records attendance; outside goes to the supervisor who approves', async ({ browser }) => {
  // Outside first: about 1.1 km north of the area centre.
  const worker = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: -6.19, longitude: 106.8, accuracy: 10 } });
  const page = await worker.newPage();
  await signIn(page, 'engineer@acme.test', { home: '/my' });
  await page.goto('/my');
  await expect(page.getByRole('heading', { name: 'Clock in' })).toBeVisible();
  await page.getByRole('listitem').filter({ hasText: `${run} slab` }).getByRole('button', { name: 'Clock in' }).click();
  await expect(page.getByText(/outside the work area/i)).toBeVisible();
  const before = await admin.from('attendance_days').select('id').eq('work_order_id', workOrderId);
  expect(before.data ?? []).toHaveLength(0);

  // The Admin sees the request in Crews and approves it.
  const supervisor = await browser.newContext();
  const adminPage = await supervisor.newPage();
  await signIn(adminPage, 'admin@acme.test');
  await adminPage.goto('/crews');
  await expect(adminPage.getByRole('heading', { name: 'Check-ins waiting for you' })).toBeVisible();
  await adminPage.getByRole('button', { name: 'Approve' }).click();
  await expect(adminPage.getByLabel('Notifications alt+T').getByText('Check-in approved')).toBeVisible();
  await expect.poll(async () => ((await admin.from('attendance_days').select('id').eq('work_order_id', workOrderId)).data ?? []).length).toBe(1);

  // Inside the area on the next day's tap is covered by pgTAP; here a fresh work order position inside records straight away.
  await worker.setGeolocation({ latitude: -6.2, longitude: 106.8, accuracy: 10 });
  await admin.from('attendance_days').delete().eq('work_order_id', workOrderId);
  await page.goto('/my');
  await page.getByRole('listitem').filter({ hasText: `${run} slab` }).getByRole('button', { name: 'Clock in' }).click();
  await expect(page.getByRole('button', { name: 'Clocked in' })).toBeVisible();
  await expect.poll(async () => ((await admin.from('attendance_days').select('source').eq('work_order_id', workOrderId)).data ?? []).map((r) => r.source)).toEqual(['phone_check_in']);
  await worker.close();
  await supervisor.close();
});
