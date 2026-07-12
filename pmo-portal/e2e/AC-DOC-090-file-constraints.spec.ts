// @e2e-isolation: self-isolated — unique doc title/code (Date.now()), tests oversize + disallowed type errors on Draft; no seed coupling.
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { login } from './helpers';
import { createDocument, openDocumentsTab } from './document-file-upload.helpers';

const ZIP_FIXTURE = fileURLToPath(new URL('./fixtures/not-allowed.zip', import.meta.url));
const FIVE_MB_PLUS_ONE = 5 * 1024 * 1024 + 1;

test.setTimeout(120_000);

test('AC-DOC-090/091: PM sees oversize and disallowed-type upload errors on a Draft document', async ({ page }) => {
  const runId = Date.now();
  const title = `Constraint Journey ${runId}`;
  const code = `FILE-${runId}`;

  await login(page, 'pm@acme.test');
  await openDocumentsTab(page);
  const row = await createDocument(page, { title, code, category: 'Drawing' });

  const [oversizeChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    row.getByLabel(`Upload file for ${title}`).click(),
  ]);
  await oversizeChooser.setFiles({
    name: 'too-large.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.alloc(FIVE_MB_PLUS_ONE, 'a'),
  });
  await expect(row.getByRole('alert')).toHaveText('File exceeds 5 MB limit');
  await row.getByLabel(`Remove failed upload for ${title}`).click();
  await expect(row.getByRole('alert')).toHaveCount(0);
  await expect(row.getByLabel(`Upload file for ${title}`)).toBeVisible();

  const [zipChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    row.getByLabel(`Upload file for ${title}`).click(),
  ]);
  await zipChooser.setFiles(ZIP_FIXTURE);
  await expect(row.getByRole('alert')).toHaveText('File type not allowed (.zip)');
});
