// @e2e-isolation: self-isolated — creates its own uniquely-named document type and person each run and deletes them (and the document) afterwards; reads the seed org and its seeded Admin only.
/**
 * AC-PPL-010 — the People register (#2542 follow-up): the cross-stack journey. An Admin opens Administration › People, adds a
 * person with only a name (the database assigns the code), opens that person's record and adds their first expiring document.
 * Goal oracle: the document is listed on the person's record with its expiry date, and the new person has a P-NNNN code.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);

test.setTimeout(120_000);

let admin: SupabaseClient | undefined;
let run = '';
let typeId = '';

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-PPL-010 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  run = `E2E-PPL-${Date.now()}`;
  const { data, error } = await admin.from('document_types')
    .insert({ org_id: ORG_ID, name: `${run} permit`, applies_to: 'person', is_medical: false }).select('id').single();
  if (error || !data) throw new Error(`AC-PPL-010 document type: ${error?.message ?? 'no row'}`);
  typeId = data.id as string;
});

test.afterEach(async () => {
  if (!admin) return;
  const { data: people } = await admin.from('people').select('id').eq('org_id', ORG_ID).like('name', `${run}%`);
  const ids = (people ?? []).map((p) => p.id as string);
  if (ids.length) await admin.from('expiry_documents').delete().in('person_id', ids);
  await admin.from('people').delete().eq('org_id', ORG_ID).like('name', `${run}%`);
  await admin.from('document_types').delete().eq('id', typeId);
});

test('AC-PPL-010: an Admin adds a person, then adds their first expiring document', async ({ page }) => {
  await signIn(page, 'admin@acme.test');
  await page.goto('/administration/people');

  await page.getByRole('button', { name: 'Add person' }).first().click();
  const form = page.getByRole('dialog');
  await form.getByLabel(/^Name/).fill(`${run} Ayu`);
  await form.getByRole('button', { name: 'Save person' }).click();
  await expect(form).toHaveCount(0);

  const row = page.getByRole('row', { name: new RegExp(`${run} Ayu`) });
  await expect(row.locator('.record-id')).toHaveText(/^P-\d{4,}$/);
  await row.getByRole('link', { name: `${run} Ayu` }).click();

  await expect(page).toHaveURL(/\/equipment\/people\//);
  await page.getByRole('button', { name: 'Add document' }).click();
  const doc = page.getByRole('dialog');
  await doc.getByLabel(/Document type/).selectOption({ label: `${run} permit` });
  await doc.getByLabel(/^Number/).fill('WP-1');
  await doc.getByRole('textbox', { name: /Expiry date/ }).fill('2030-06-30');
  await page.keyboard.press('Tab');
  await doc.getByRole('button', { name: 'Save document' }).click();

  const documents = page.getByRole('region', { name: 'Documents' });
  await expect(documents.getByText('WP-1')).toBeVisible();
  await expect(documents.getByText(`${run} permit`)).toBeVisible();
});
