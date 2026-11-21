// @e2e-isolation: self-isolated — creates its own uniquely-named crew and tool line each run; the organisation's one coordinator setting is saved and restored around the journey (no other spec reads it).
/**
 * AC-CTR-012 — a field controller on a phone reports a damaged tool with a photo (#2581). The crew's tools screen shows the
 * new usable count, and the equipment coordinator has the replacement task and the notification.
 * Goal oracle: the usable count on the crew screen fell by the reported quantity, and the coordinator holds one task and
 * one notification naming the tool — nobody re-typed anything.
 *
 * Cleanup: the report, its task and the audit trail are immutable history of this run and are scoped to the run's uniquely-named
 * crew and tool; the coordinator setting row is restored to what it was.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey, visibleToast } from './helpers';
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
test.use({ viewport: { width: 390, height: 844 } }); // a phone

// A 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

let admin: SupabaseClient | undefined;
let run = '';
let crewId = '';
let toolName = '';
let previous: { coordinator_id: string | null; task_due_days: number } | null = null;

const need = <D>(step: string, r: { data: D; error: { message: string } | null }): NonNullable<D> => {
  if (r.error) throw new Error(`AC-CTR-012 ${step}: ${r.error.message}`);
  if (r.data === null || r.data === undefined) throw new Error(`AC-CTR-012 ${step}: no row returned`);
  return r.data as NonNullable<D>;
};

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-CTR-012 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  run = `E2E-CTR-${Date.now()}`;
  toolName = `${run} hammer`;
  crewId = need('crew', await admin.from('crews').insert({
    org_id: ORG_ID, code: run.slice(-18), name: `${run} crew`, kind: 'own', field_controller_id: ENGINEER_ID,
  }).select('id').single()).id;
  need('tool line', await admin.from('crew_tool_lines').insert({ org_id: ORG_ID, crew_id: crewId, name: toolName, held_qty: 6 }).select('id').single());
  const existing = await admin.from('org_crew_tool_settings').select('coordinator_id, task_due_days').eq('org_id', ORG_ID).maybeSingle();
  previous = existing.data as typeof previous;
  need('coordinator', await admin.from('org_crew_tool_settings')
    .upsert({ org_id: ORG_ID, coordinator_id: PM_ID, task_due_days: 3 }).select('org_id').single());
});

test.afterEach(async () => {
  if (!admin) return;
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`AC-CTR-012 cleanup ${step}: ${e.message}`); };
  if (previous) fail('setting', (await admin.from('org_crew_tool_settings').update(previous).eq('org_id', ORG_ID)).error);
  else fail('setting', (await admin.from('org_crew_tool_settings').delete().eq('org_id', ORG_ID)).error);
  crewId = '';
});

test('AC-CTR-012 a field controller reports a damaged tool with a photo; the crew screen shows the new usable count and the coordinator has the task and notification', async ({ page }) => {
  // 1. The field controller opens the crew's tools (their own crew is preselected) and sees 6 usable.
  await signIn(page, 'engineer@acme.test');
  await page.goto('/crews?view=tools');
  // On a phone the table is a list of cards, one per tool.
  const card = page.getByRole('listitem').filter({ hasText: toolName });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText(/Usable\s*6/);

  // 2. Tap 1: report a problem. Tap 2: the photo. Tap 3: send. Damaged is the default kind.
  await card.getByRole('button', { name: 'Report a problem' }).click();
  await page.getByLabel('Photo (required)').setInputFiles({ name: 'hammer.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(visibleToast(page, 'Reported. The equipment coordinator has a task.')).toBeVisible({ timeout: 20_000 });

  // 3. The crew screen shows 5 usable and the open report.
  await expect(card.first()).toContainText(/Damaged\s*1/, { timeout: 15_000 });
  await expect(card.first()).toContainText(/Usable\s*5/);
  await expect(page.getByRole('listitem').filter({ hasText: `${toolName} x1` })).toBeVisible();

  // 4. Goal: the coordinator holds one task and one notification naming the tool.
  if (!admin) throw new Error('AC-CTR-012: no admin client');
  const tasks = need('tasks', await admin.from('tasks').select('id, name, assignee_id').ilike('name', `%${toolName}%`));
  expect(tasks).toHaveLength(1);
  expect(tasks[0].assignee_id).toBe(PM_ID);
  const notes = need('notifications', await admin.from('notifications').select('title').eq('owner_id', PM_ID).ilike('title', `%${toolName}%`));
  expect(notes).toHaveLength(1);

  // 5. The coordinator finds the task on their list.
  await signIn(page, 'pm@acme.test');
  await page.goto('/my-tasks');
  await expect(page.getByText(`Replace: ${toolName} x1`, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
});
