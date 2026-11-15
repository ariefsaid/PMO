// @e2e-isolation: self-isolated — creates its own two deals (service-role insert) and deletes them afterwards.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { signIn, requireServiceRoleKey } from './helpers';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const svcKey = requireServiceRoleKey();
if (!svcKey) throw new Error('AC-2379: SUPABASE_SERVICE_ROLE_KEY is required for this owning journey.');
const admin = createClient(SUPABASE_URL, svcKey, { auth: { persistSession: false } });

const RUN = randomUUID().slice(0, 8);
const QUOTED = { id: randomUUID(), name: `Stage win quoted ${RUN}` };
const PREQUAL = { id: randomUUID(), name: `Stage win prequal ${RUN}` };

async function seed(deal: { id: string; name: string }, status: string) {
  const { error } = await admin.from('projects').insert({ id: deal.id, org_id: ORG_ID, name: deal.name, status: 'Leads' });
  if (error) throw new Error(`AC-2379 seed failed: ${error.message}`);
  // Walk the legal order (Leads → Quotation → PQ) the way a user would.
  for (const step of ['Quotation Submitted', 'PQ Submitted']) {
    const { error: moveError } = await admin.from('projects').update({ status: step }).eq('id', deal.id);
    if (moveError) throw new Error(`AC-2379 seed move failed: ${moveError.message}`);
    if (step === status) break;
  }
}

test.beforeAll(async () => {
  await seed(QUOTED, 'Quotation Submitted');
  await seed(PREQUAL, 'PQ Submitted');
});
test.afterAll(async () => {
  for (const deal of [QUOTED, PREQUAL]) {
    await admin.from('record_changes').delete().eq('entity_id', deal.id);
    await admin.from('record_changes').delete().eq('parent_id', deal.id);
    await admin.from('projects').delete().eq('id', deal.id);
  }
});

test('AC-2379-2: a Quotation Submitted deal is marked won with reference and date; a PQ Submitted deal is not offered Won', async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page, 'exec@acme.test');

  // PQ Submitted: the deal page offers the next stage, never "Mark won".
  await page.goto(`/projects/${PREQUAL.id}`);
  await expect(page.getByRole('button', { name: /advance to/i }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Mark won' })).toHaveCount(0);

  // Quotation Submitted: "Mark won" is offered beside the advance; it asks for the reference and date.
  await page.goto(`/projects/${QUOTED.id}`);
  await expect(page.getByRole('button', { name: /advance to/i }).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Mark won' }).first().click();
  await page.getByLabel('Customer contract reference').fill(`CPO-${RUN}`);
  await page.getByLabel('Contract date').fill('2026-11-01');
  const won = page.waitForResponse((r) => r.url().includes('/rpc/transition_project'));
  await page.getByRole('button', { name: 'Confirm won' }).click();
  expect((await won).ok()).toBe(true);

  const { data, error } = await admin.from('projects').select('status, customer_contract_ref, contract_date').eq('id', QUOTED.id).single();
  expect(error).toBeNull();
  expect(data).toMatchObject({ status: 'Won, Pending KoM', customer_contract_ref: `CPO-${RUN}`, contract_date: '2026-11-01' });
});
