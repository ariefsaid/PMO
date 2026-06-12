import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { login } from './helpers';
import {
  approveDocument,
  createDocument,
  documentRow,
  issueDocument,
  openDocumentsTab,
  readDownloadBytes,
} from './document-file-upload.helpers';

const PDF_FIXTURE = fileURLToPath(new URL('./fixtures/tiny-upload.pdf', import.meta.url));

test.setTimeout(180_000);

test('AC-DOC-051/060/062: PM creates a new revision, a different reviewer approves it, the parent becomes Superseded, and the superseded parent stays downloadable but read-only', async ({ page }) => {
  const runId = Date.now();
  const title = `Revision Journey ${runId}`;
  const code = `REV-${runId}`;

  // Author creates the parent document, uploads its file, and gets it Approved.
  await login(page, 'pm@acme.test');
  await openDocumentsTab(page);
  const parentDraftRow = await createDocument(page, { title, code, category: 'Drawing', revision: 'A' });

  const [uploadChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    parentDraftRow.getByLabel(`Upload file for ${title}`).click(),
  ]);
  await uploadChooser.setFiles(PDF_FIXTURE);
  await expect(parentDraftRow.getByText('tiny-upload.pdf')).toBeVisible({ timeout: 15_000 });

  await issueDocument(page, documentRow(page, title));
  const issuedParentRow = documentRow(page, title);
  await expect(issuedParentRow.getByText('Issued')).toBeVisible({ timeout: 15_000 });

  await login(page, 'finance@acme.test');
  await openDocumentsTab(page);
  await approveDocument(page, documentRow(page, title));
  const approvedParentRow = documentRow(page, title);
  await expect(approvedParentRow.getByText('Approved')).toBeVisible({ timeout: 15_000 });

  // Author creates the new revision from the Approved parent.
  await login(page, 'pm@acme.test');
  await openDocumentsTab(page);
  const newRevisionButton = documentRow(page, title).getByRole('button', { name: `Create new revision for ${title}` });
  await expect(newRevisionButton).toBeVisible();
  await newRevisionButton.click();

  const revisionDialog = page.getByRole('dialog', { name: 'New revision' });
  await expect(revisionDialog).toBeVisible();
  await expect(revisionDialog.getByLabel(/title/i)).toHaveValue(title);
  await expect(revisionDialog.getByLabel(/code/i)).toHaveValue(code);
  await expect(revisionDialog.getByLabel(/revision/i)).toHaveValue('B');
  await revisionDialog.getByRole('button', { name: /create revision/i }).click();
  await expect(revisionDialog).not.toBeVisible({ timeout: 15_000 });

  const childDraftRow = page
    .locator('table tbody tr')
    .filter({ hasText: title })
    .filter({ has: page.getByRole('button', { name: new RegExp(`View revision A of ${title}`) }) });
  await expect(childDraftRow).toHaveCount(1, { timeout: 15_000 });
  await expect(childDraftRow.getByText('Draft')).toBeVisible();
  await expect(childDraftRow.getByText(code)).toBeVisible();
  await expect(childDraftRow.getByText('Drawing')).toBeVisible();
  await expect(childDraftRow.getByRole('button', { name: /view revision a of/i })).toBeVisible();

  await issueDocument(page, childDraftRow);
  await expect(childDraftRow.getByText('Issued')).toBeVisible({ timeout: 15_000 });

  // A different user approves the child; the parent must auto-supersede.
  await login(page, 'finance@acme.test');
  await openDocumentsTab(page);
  const childIssuedRow = page
    .locator('table tbody tr')
    .filter({ hasText: title })
    .filter({ has: page.getByRole('button', { name: new RegExp(`View revision A of ${title}`) }) });
  await expect(childIssuedRow).toHaveCount(1, { timeout: 15_000 });
  await approveDocument(page, childIssuedRow);
  await expect(childIssuedRow.getByText('Approved')).toBeVisible({ timeout: 15_000 });

  const supersededParentRow = page
    .locator('table tbody tr')
    .filter({ hasText: title })
    .filter({ has: page.getByRole('button', { name: new RegExp(`View revision B of ${title}`) }) });
  await expect(supersededParentRow).toHaveCount(1, { timeout: 15_000 });
  await expect(supersededParentRow.getByText('Superseded')).toBeVisible({ timeout: 15_000 });
  await expect(supersededParentRow.getByRole('button', { name: `Create new revision for ${title}` })).toHaveCount(0);
  await expect(supersededParentRow.getByLabel(`Upload file for ${title}`)).toHaveCount(0);
  await expect(supersededParentRow.getByLabel(`Replace file for ${title}`)).toHaveCount(0);

  await supersededParentRow.getByLabel(`View ${title}`).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText(/superseded by/i)).toBeVisible();
  await expect(drawer.getByRole('button', { name: /^edit$/i })).toHaveCount(0);
  await expect(drawer.getByText(/update status/i)).toHaveCount(0);

  const downloadPromise = page.waitForEvent('download');
  await drawer.getByRole('button', { name: /download tiny-upload\.pdf/i }).click();
  const download = await downloadPromise;
  const bytes = await readDownloadBytes(download);
  expect(download.suggestedFilename()).toBe('tiny-upload.pdf');
  expect(bytes.byteLength).toBeGreaterThan(0);
});
