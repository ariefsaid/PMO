// @e2e-isolation: self-isolated — service-role seeds one uniquely named overdue task assigned to engineer@acme.test and deletes it, its ledger rows and its notification in afterAll; the sender is pm@acme.test.
/**
 * AC-RMD-024 — Given the project manager sends a reminder about an overdue task assigned to the site engineer (the exact
 * RPC an approved remind_overdue chip calls; the edge runtime does not run here, see AC-AAN-036's MECHANISM note),
 * When the site engineer signs in, Then the bell shows an unread reminder naming the task and opening it lands on My tasks.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { SEED_PASSWORD, requireServiceRoleKey, signIn } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

// House pattern: AC-IMP-090-site-imprest-journey.spec.ts.
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const URL_ = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? VITE_ENV.VITE_SUPABASE_ANON_KEY ?? '';
const TASK_NAME = `AC-RMD-024 overdue task ${Date.now()}`;
let taskId = '';
const adminClient = () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-RMD-024 needs the service-role key: run it via scripts/e2e-local.sh, which exports it');
  return createClient(URL_, key, { auth: { persistSession: false } });
};

test.beforeAll(async () => {
  const admin = adminClient();
  const { data: eng } = await admin.from('profiles').select('id, org_id').eq('email', 'engineer@acme.test').single();
  const { data: proj } = await admin.from('projects').select('id').eq('org_id', eng!.org_id).is('archived_at', null).limit(1).single();
  const due = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
  const { data: task } = await admin.from('tasks').insert({
    org_id: eng!.org_id, project_id: proj!.id, name: TASK_NAME, status: 'In Progress', end_date: due, assignee_id: eng!.id,
  }).select('id').single();
  taskId = task!.id;
});

test.afterAll(async () => {
  if (!taskId) return;
  const admin = adminClient();
  await admin.from('notifications').delete().eq('metadata->entity->>id', taskId);
  await admin.from('task_reminders').delete().eq('task_id', taskId);
  await admin.from('tasks').delete().eq('id', taskId);
});

test('AC-RMD-024 a confirmed reminder reaches the assignee and opens My tasks', async ({ page }) => {
  if (!ANON_KEY) throw new Error('AC-RMD-024 needs the anon key: run it via scripts/e2e-local.sh');
  const pm = createClient(URL_, ANON_KEY, { auth: { persistSession: false } });
  const signedIn = await pm.auth.signInWithPassword({ email: 'pm@acme.test', password: SEED_PASSWORD });
  expect(signedIn.error).toBeNull();
  const { data, error } = await pm.rpc('send_task_reminders', { p_task_ids: [taskId] });
  expect(error).toBeNull();
  expect((data as { items: Array<{ outcome: string }> }).items[0].outcome).toBe('sent');

  await signIn(page, 'engineer@acme.test');
  const bell = page.getByRole('button', { name: /notifications, [1-9]\d* unread/i });
  await expect(bell).toBeVisible({ timeout: 10_000 });
  await bell.click();
  const item = page.getByRole('list', { name: 'Notifications' }).getByText(new RegExp(TASK_NAME));
  await expect(item).toBeVisible();
  await item.click();
  await expect(page).toHaveURL(/\/my-tasks/);
});
