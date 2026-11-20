// @e2e-isolation: self-isolated — a uniquely named category (Date.now()) and one uniquely titled document; the three seeded users only read or write their own rows.
import { test, expect, type Browser, type TestInfo } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { login, ownedContextOptions, SEED_PASSWORD } from './helpers';
import { createDocument, documentRow, openDocumentsTab, readDownloadBytes } from './document-file-upload.helpers';

/**
 * AC-DCV-022 (#2579): an Admin creates a category for Finance and Executive only; Finance files a document in it and uploads a
 * file; an Engineer opens the same Documents tab and sees no trace of it, and a direct request for the row and the file fails.
 * The rule is the database's (a restrictive policy on the register and on the project-documents bucket), so the direct
 * request goes around the screen with the Engineer's own session.
 */
const PDF_FIXTURE = fileURLToPath(new URL('./fixtures/tiny-upload.pdf', import.meta.url));
const PDF_BYTES = await import('node:fs/promises').then((fs) => fs.readFile(PDF_FIXTURE));

function supabaseEnv(name: string): string {
  const match = execSync('supabase status -o env', { encoding: 'utf8' }).match(new RegExp(`^${name}="([^"]+)"$`, 'm'));
  if (!match) throw new Error(`Missing ${name} from supabase status -o env`);
  return match[1];
}
async function sessionClient(email: string) {
  const client = createClient(supabaseEnv('API_URL'), supabaseEnv('ANON_KEY'), { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error) throw error;
  return client;
}
async function pageFor(browser: Browser, testInfo: TestInfo, email: string) {
  const context = await browser.newContext(ownedContextOptions(testInfo));
  const page = await context.newPage();
  await login(page, email);
  return { context, page };
}

test.setTimeout(180_000);

test('AC-DCV-022: a category visible to Finance and Executive keeps its document and file from an Engineer', async ({ browser }, testInfo) => {
  const runId = Date.now();
  const category = `Commercial approval ${runId}`;
  const title = `Pay claim ${runId}`;
  const code = `DCV-${runId}`;

  // 1. The Admin creates the category and chooses Finance and Executive.
  const admin = await pageFor(browser, testInfo, 'admin@acme.test');
  await admin.page.goto('/administration/document-categories');
  const form = admin.page.getByTestId('document-category-new');
  await form.getByLabel(/category name/i).fill(category);
  await form.getByRole('checkbox', { name: /Finance/ }).click();
  await form.getByRole('checkbox', { name: /Executive/ }).click();
  await expect(form.getByRole('checkbox', { name: /Admin/ })).toBeDisabled();
  await form.getByRole('button', { name: /create category/i }).click();
  const card = admin.page.locator('[data-testid^="document-category-"]').filter({ has: admin.page.getByRole('heading', { name: category }) });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByRole('checkbox', { name: /Finance/ })).toBeChecked();
  await expect(card.getByRole('checkbox', { name: /Engineer/ })).not.toBeChecked();
  await admin.context.close();

  // 2. Finance files a document in it, uploads a file, and downloads it back.
  const finance = await pageFor(browser, testInfo, 'finance@acme.test');
  await openDocumentsTab(finance.page);
  const row = await createDocument(finance.page, { title, code, category });
  await row.getByLabel(`View ${title}`).click();
  const drawer = finance.page.getByRole('dialog', { name: title });
  await expect(drawer).toBeVisible();
  const [chooser] = await Promise.all([
    finance.page.waitForEvent('filechooser'),
    drawer.getByLabel(`Upload file for ${title}`).click(),
  ]);
  await chooser.setFiles(PDF_FIXTURE);
  await expect(row.getByText('tiny-upload.pdf')).toBeVisible({ timeout: 15_000 });
  await row.getByLabel(`View ${title}`).click();
  const downloadPromise = finance.page.waitForEvent('download');
  await finance.page.getByRole('dialog', { name: title }).getByRole('button', { name: /^download$/i }).click();
  expect((await readDownloadBytes(await downloadPromise)).equals(PDF_BYTES)).toBe(true);

  const financeApi = await sessionClient('finance@acme.test');
  const { data: seen } = await financeApi.from('project_documents').select('id, file_path').eq('code', code).single();
  expect(seen?.file_path).toBeTruthy();
  await finance.context.close();

  // 3. The Engineer sees nothing of it on the screen ...
  const engineer = await pageFor(browser, testInfo, 'engineer@acme.test');
  await openDocumentsTab(engineer.page);
  await expect(documentRow(engineer.page, title)).toHaveCount(0);
  await expect(engineer.page.getByText(title)).toHaveCount(0);
  await expect(engineer.page.getByText(category)).toHaveCount(0);
  await expect(engineer.page.getByText(/hidden|restricted|withheld/i)).toHaveCount(0);
  await engineer.context.close();

  // ... and cannot fetch the row or the file directly.
  const engineerApi = await sessionClient('engineer@acme.test');
  const { data: rows } = await engineerApi.from('project_documents').select('id').eq('id', seen!.id);
  expect(rows).toEqual([]);
  const signed = await engineerApi.storage.from('project-documents').createSignedUrl(seen!.file_path!, 60);
  expect(signed.data).toBeNull();
  expect(signed.error).not.toBeNull();
  const download = await engineerApi.storage.from('project-documents').download(seen!.file_path!);
  expect(download.data).toBeNull();
});
