import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { login } from './helpers';
import {
  createDocument,
  documentRow,
  issueDocument,
  openDocumentsTab,
  readDownloadBytes,
} from './document-file-upload.helpers';

const PDF_FIXTURE = fileURLToPath(new URL('./fixtures/tiny-upload.pdf', import.meta.url));
const PNG_FIXTURE = fileURLToPath(new URL('./fixtures/tiny-preview.png', import.meta.url));

test.setTimeout(120_000);

test('AC-DOC-020/021/040/041: PM uploads, downloads, replaces, and previews a project document file end-to-end', async ({ page }) => {
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

  // Download the uploaded file and assert a real browser download occurred.
  await row.getByLabel(`View ${title}`).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await drawer.getByRole('button', { name: /download tiny-upload\.pdf/i }).click();
  const download = await downloadPromise;
  const originalBytes = await readDownloadBytes(download);
  expect(download.suggestedFilename()).toBe('tiny-upload.pdf');
  expect(originalBytes.byteLength).toBeGreaterThan(0);
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
