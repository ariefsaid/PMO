// @e2e-isolation: self-isolated — service-role inserts its own project and task and deletes them (and the proof object) afterwards; no shared seed row is touched.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signIn, requireServiceRoleKey } from './helpers';

// AC-TWOP-010 (#2531): on a phone, the assignee of a proof-required task cannot close it without evidence;
// they add a photo from the camera input and then mark the task Done, in one journey. Real browser, real DB.

test.setTimeout(120_000);
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const svcKey = requireServiceRoleKey();
if (!svcKey) {
  throw new Error('AC-TWOP-010: SUPABASE_SERVICE_ROLE_KEY is required for this owning journey (local fixture dependency) - it must not silently skip.');
}
const admin = createClient(SUPABASE_URL, svcKey, { auth: { persistSession: false } });

// 1x1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

let PROJECT_ID: string;
let TASK_ID: string;
let TASK: string;

test.beforeEach(async () => {
  PROJECT_ID = crypto.randomUUID();
  TASK_ID = crypto.randomUUID();
  TASK = `Proof task ${crypto.randomUUID().slice(0, 8)}`;
  const { data: eng, error: engError } = await admin.from('profiles').select('id').eq('email', 'engineer@acme.test').single();
  if (engError || !eng) throw new Error(`AC-TWOP-010 seed engineer lookup failed: ${engError?.message}`);
  const { error: projectError } = await admin.from('projects').insert({
    id: PROJECT_ID, org_id: ORG_ID, name: `TWOP 2531 ${TASK}`, status: 'Ongoing Project',
    currency: 'USD', contract_value: 0, tax_treatment: 'exclusive', tax_amount: 0,
  });
  if (projectError) throw new Error(`AC-TWOP-010 seed project failed: ${projectError.message}`);
  const { error } = await admin.from('tasks').insert({
    id: TASK_ID, org_id: ORG_ID, project_id: PROJECT_ID, name: TASK, status: 'In Progress',
    assignee_id: eng.id, proof_required: true,
  });
  if (error) throw new Error(`AC-TWOP-010 seed task failed: ${error.message}`);
});

test.afterEach(async () => {
  const { data: proofs } = await admin.from('task_proofs').select('file_path').eq('task_id', TASK_ID);
  const paths = (proofs ?? []).map((p) => p.file_path);
  if (paths.length) await admin.storage.from('task-proofs').remove(paths);
  await admin.from('task_proofs').delete().eq('task_id', TASK_ID);
  await admin.from('record_changes').delete().eq('entity_id', TASK_ID);
  await admin.from('tasks').delete().eq('id', TASK_ID);
  await admin.from('record_changes').delete().eq('entity_id', PROJECT_ID);
  await admin.from('projects').delete().eq('id', PROJECT_ID);
});

test('AC-TWOP-010 the assignee adds a photo and then marks the task Done', async ({ page }) => {
  await signIn(page, 'engineer@acme.test');
  await page.goto(`/projects/${PROJECT_ID}/tasks?open=${TASK_ID}`);

  // Without proof: Done is disabled and the page says why.
  const done = page.getByRole('button', { name: /mark done/i });
  await expect(done).toBeDisabled({ timeout: 20_000 });
  await expect(page.getByText(/cannot be Done without proof/i)).toBeVisible();

  // The camera input is offered on a phone, and the upload completes.
  const camera = page.getByTestId('proof-photo-input');
  await expect(camera).toHaveAttribute('capture', 'environment');
  await camera.setInputFiles({ name: 'site.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('site.png')).toBeVisible({ timeout: 20_000 });

  // With proof: Done enables and the task is Done (stored, not just shown).
  await expect(done).toBeEnabled();
  await done.click();
  await expect.poll(async () => {
    const { data } = await admin.from('tasks').select('status').eq('id', TASK_ID).single();
    return data?.status;
  }, { timeout: 15_000 }).toBe('Done');
});
