// @e2e-isolation: serial - it sets the organisation-wide checkpoint list (one list per org, read by every site report); it restores the list and deletes its own rows.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signIn, requireServiceRoleKey, pinEnglishLocale } from '../helpers';

// AC-STC-013 (timed checkpoints, #2594): the field controller of a rostered crew records the work-start checkpoint with a photo on
// the daily site report, then the crews view lists that crew's day as on time.
//
// Journey: the organisation's list holds one work-start checkpoint; a crew whose field controller is the signed-in user is rostered
// on an Issued work order; the day's checkpoint exists (the job's output, inserted by the test hook as the incident journey does);
// a draft site report exists for the day. The controller opens the report, sees the checkpoint as due, records it with a photo, and
// sees it on time with their name. The crews view then shows the crew with "1 of 1 days on time".
//
// ISOLATION: unique project, work order, crew and report per run; the org's checkpoint list is cleared first and restored after.

test.setTimeout(180_000);

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const ADMIN_ID = '00000000-0000-0000-0000-0000000000a5';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const svcKey = requireServiceRoleKey();
if (!svcKey) throw new Error('AC-STC-013: SUPABASE_SERVICE_ROLE_KEY is required for this owning journey - it must not silently skip.');
const admin = createClient(SUPABASE_URL, svcKey, { auth: { persistSession: false } });

const ids = { project: '', wo: '', crew: '', report: '', checkpoint: '' };
let crewName = '';
let savedList: Record<string, unknown>[] = [];
let today = '';

// A 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function must<T>(what: string, p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`AC-STC-013 ${what} failed: ${error.message}`);
  return data;
}

test.beforeEach(async () => {
  const run = crypto.randomUUID();
  ids.project = crypto.randomUUID(); ids.wo = crypto.randomUUID(); ids.crew = crypto.randomUUID();
  ids.report = crypto.randomUUID(); ids.checkpoint = crypto.randomUUID();
  crewName = `STC crew ${run.slice(0, 8)}`;
  const org = await must('org', admin.from('organizations').select('default_timezone').eq('id', ORG_ID).single());
  if (!org) throw new Error('AC-STC-013 org not found');
  const tz = org.default_timezone ?? 'UTC';
  today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  const saved = await must('save list', admin.from('site_checkpoint_templates').select('*').eq('org_id', ORG_ID));
  if (!saved) throw new Error('AC-STC-013 could not read the current checkpoint list');
  savedList = saved;
  await must('clear list', admin.from('site_checkpoint_templates').delete().eq('org_id', ORG_ID));
  await must('list', admin.from('site_checkpoint_templates').insert({
    org_id: ORG_ID, position: 1, name: 'Work start', marks_work_start: true, due_time: '23:59', grace_minutes: 0, photo_required: true,
  }));
  await must('project', admin.from('projects').insert({
    id: ids.project, org_id: ORG_ID, name: `STC ${run}`, status: 'Ongoing Project', currency: 'USD', project_manager_id: ADMIN_ID,
  }));
  await must('work order', admin.from('work_orders').insert({
    id: ids.wo, org_id: ORG_ID, project_id: ids.project, title: `STC WO ${run}`, status: 'Issued', order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0,
  }));
  await must('crew', admin.from('crews').insert({ id: ids.crew, org_id: ORG_ID, code: `STC-${run.slice(0, 8)}`, name: crewName, field_controller_id: ADMIN_ID }));
  await must('roster', admin.from('work_order_crews').insert({ org_id: ORG_ID, work_order_id: ids.wo, crew_id: ids.crew, valid_from: today }));
  await must('checkpoint', admin.from('site_checkpoints').insert({
    id: ids.checkpoint, org_id: ORG_ID, work_order_id: ids.wo, crew_id: ids.crew, work_date: today, position: 1, name: 'Work start',
    marks_work_start: true, due_at: new Date(Date.now() + 3 * 3600_000).toISOString(), grace_minutes: 0, photo_required: true,
  }));
  await must('report', admin.from('daily_site_reports').insert({
    id: ids.report, org_id: ORG_ID, project_id: ids.project, work_order_id: ids.wo, work_date: today, status: 'draft', author_id: ADMIN_ID,
  }));
});

test.afterEach(async () => {
  const { data: files } = await admin.storage.from('site-checkpoint-photos').list(`${ORG_ID}/${ids.wo}/${ids.crew}/${today}`);
  if (files?.length) await admin.storage.from('site-checkpoint-photos').remove(files.map((f) => `${ORG_ID}/${ids.wo}/${ids.crew}/${today}/${f.name}`));
  await admin.from('audit_events').delete().eq('entity_id', ids.checkpoint);
  await admin.from('site_checkpoints').delete().eq('work_order_id', ids.wo);
  await admin.from('daily_site_reports').delete().eq('id', ids.report);
  await admin.from('work_order_crews').delete().eq('work_order_id', ids.wo);
  await admin.from('crews').delete().eq('id', ids.crew);
  await admin.from('work_orders').delete().eq('id', ids.wo);
  await admin.from('projects').delete().eq('id', ids.project);
  await admin.from('site_checkpoint_templates').delete().eq('org_id', ORG_ID);
  if (savedList.length) await admin.from('site_checkpoint_templates').insert(savedList);
});

test('AC-STC-013: the field controller records the work-start checkpoint with a photo, then the crews view shows the crew on time', async ({ page }) => {
  await pinEnglishLocale(page);
  await signIn(page, 'admin@acme.test');

  await page.goto(`/site-reports/${ids.report}`);
  const row = page.getByTestId(`checkpoint-${ids.checkpoint}`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText('Work start');
  await row.getByRole('button', { name: 'Record', exact: true }).click();
  const confirm = row.getByRole('button', { name: 'Record now' });
  await expect(confirm).toBeDisabled();
  await row.getByTestId('checkpoint-photo-input').setInputFiles({ name: 'start.png', mimeType: 'image/png', buffer: PNG });
  await row.getByRole('textbox', { name: /note/i }).fill('crew at the gate');
  await confirm.click();

  await expect(row.getByText('On time')).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText('Recorded');
  await expect(row.getByRole('button', { name: 'View photo' })).toBeVisible();

  await page.goto('/site-reports/crews');
  const crew = page.getByTestId(`crew-${ids.crew}`);
  await expect(crew).toBeVisible({ timeout: 30_000 });
  await expect(crew).toContainText(crewName);
  await expect(crew).toContainText('1 of 1 days on time');
});
