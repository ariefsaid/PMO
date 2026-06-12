import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { login, SEED_PASSWORD } from './helpers';
import {
  createDocument,
  documentRow,
  issueDocument,
  openDocumentsTab,
  readDownloadBytes,
} from './document-file-upload.helpers';

const PDF_FIXTURE = fileURLToPath(new URL('./fixtures/tiny-upload.pdf', import.meta.url));
const PNG_FIXTURE = fileURLToPath(new URL('./fixtures/tiny-preview.png', import.meta.url));
const PDF_BYTES = await import('node:fs/promises').then((fs) => fs.readFile(PDF_FIXTURE));
const PNG_BYTES = await import('node:fs/promises').then((fs) => fs.readFile(PNG_FIXTURE));

function readSupabaseEnv(name: string): string {
  const output = execSync('supabase status -o env', { encoding: 'utf8' });
  const match = output.match(new RegExp(`^${name}="([^"]+)"$`, 'm'));
  if (!match) throw new Error(`Missing ${name} from supabase status -o env`);
  return match[1];
}

async function createAuthedSupabaseClient(email: string) {
  const client = createClient(readSupabaseEnv('API_URL'), readSupabaseEnv('ANON_KEY'), {
    auth: { persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error) throw error;
  return client;
}

test.setTimeout(120_000);

test('AC-DOC-020/021/040/041: PM uploads, downloads, replaces, and previews a project document file end-to-end', async ({ page }) => {
  const supabase = await createAuthedSupabaseClient('pm@acme.test');
  const runId = Date.now();
  const title = `Upload Journey ${runId}`;
  const code = `UP-${runId}`;

  await login(page, 'pm@acme.test');
  await openDocumentsTab(page);
  const row = await createDocument(page, { title, code, category: 'Drawing' });

  // Upload a valid small file to the Draft document.
  const [uploadChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    row.getByLabel(`Upload file for ${title}`).click(),
  ]);
  await uploadChooser.setFiles(PDF_FIXTURE);
  await expect(row.getByText('tiny-upload.pdf')).toBeVisible({ timeout: 15_000 });

  const { data: uploadedDoc } = await supabase
    .from('project_documents')
    .select('file_path')
    .eq('code', code)
    .single();
  expect(uploadedDoc?.file_path?.endsWith('/tiny-upload.pdf')).toBe(true);
  const oldPath = uploadedDoc?.file_path;

  // Download the uploaded file and assert a real browser download occurred.
  await row.getByLabel(`View ${title}`).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await drawer.getByRole('button', { name: /download tiny-upload\.pdf/i }).click();
  const download = await downloadPromise;
  const originalBytes = await readDownloadBytes(download);
  expect(download.suggestedFilename()).toBe('tiny-upload.pdf');
  expect(originalBytes.equals(PDF_BYTES)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(drawer).not.toBeVisible({ timeout: 10_000 });

  // Replace it with a previewable image.
  const [replaceChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    row.getByLabel(`Replace file for ${title}`).click(),
  ]);
  await replaceChooser.setFiles(PNG_FIXTURE);
  await expect(row.getByText('tiny-preview.png')).toBeVisible({ timeout: 15_000 });
  await expect(row.getByText('tiny-upload.pdf')).toHaveCount(0);

  const { data: replacedDoc } = await supabase
    .from('project_documents')
    .select('file_path')
    .eq('code', code)
    .single();
  expect(replacedDoc?.file_path?.endsWith('/tiny-preview.png')).toBe(true);
  expect(replacedDoc?.file_path).not.toBe(oldPath);

  const { data: oldObject, error: oldObjectError } = await supabase.storage
    .from('project-documents')
    .download(oldPath!);
  expect(oldObject).toBeNull();
  expect(oldObjectError?.message.toLowerCase()).toContain('not found');

  // Download the replacement and prove the new bytes/name are the replacement file.
  await row.getByLabel(`View ${title}`).click();
  const replacementDrawer = page.getByRole('dialog');
  await expect(replacementDrawer).toBeVisible();
  const replacementDownloadPromise = page.waitForEvent('download');
  await replacementDrawer.getByRole('button', { name: /download tiny-preview\.png/i }).click();
  const replacementDownload = await replacementDownloadPromise;
  const replacementBytes = await readDownloadBytes(replacementDownload);
  expect(replacementDownload.suggestedFilename()).toBe('tiny-preview.png');
  expect(replacementBytes.equals(PNG_BYTES)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(replacementDrawer).not.toBeVisible({ timeout: 10_000 });

  // Move the document into its read state, then preview the previewable file in a new tab.
  await issueDocument(page, documentRow(page, title));
  const issuedRow = documentRow(page, title);
  await expect(issuedRow.getByText('Issued')).toBeVisible({ timeout: 15_000 });

  const popupPromise = page.waitForEvent('popup');
  await issuedRow.getByLabel(`Preview file for ${title}`).click();
  const previewPage = await popupPromise;
  await expect.poll(() => previewPage.url(), { timeout: 15_000 }).toContain('/storage/v1/object/sign/project-documents/');
  await previewPage.close();
});
