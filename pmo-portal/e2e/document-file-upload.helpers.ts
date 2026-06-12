import { expect, type Download, type Locator, type Page } from '@playwright/test';

export const PROJECT_ID = '40000000-0000-0000-0000-000000000001';

export async function openDocumentsTab(page: Page) {
  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole('tab', { name: 'Documents' }).click();
  await expect(page.getByTestId('liststate-loading')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Document register' })).toBeVisible();
}

export function documentRow(page: Page, title: string): Locator {
  return page.locator('table tbody tr').filter({ hasText: title }).first();
}

export async function createDocument(
  page: Page,
  args: { title: string; code: string; category?: string; revision?: string },
) {
  await page.getByRole('button', { name: /add document/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/title/i).fill(args.title);
  await dialog.getByLabel(/code/i).fill(args.code);
  await dialog.getByLabel(/category/i).selectOption(args.category ?? 'Drawing');
  if (args.revision !== undefined) {
    await dialog.getByLabel(/revision/i).fill(args.revision);
  }
  await dialog.getByRole('button', { name: /^add document$/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 15_000 });

  const row = documentRow(page, args.title);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByText('Draft')).toBeVisible();
  return row;
}

export async function openRowMenu(page: Page, row: Locator) {
  await row.hover();
  await row.getByRole('button', { name: 'Row actions' }).click();
}

export async function issueDocument(page: Page, row: Locator) {
  await openRowMenu(page, row);
  await page.getByRole('menuitem', { name: /^issue$/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /issue document/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 15_000 });
}

export async function approveDocument(page: Page, row: Locator) {
  await openRowMenu(page, row);
  await page.getByRole('menuitem', { name: /^approve$/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /approve document/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 15_000 });
}

export async function readDownloadBytes(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  if (!stream) throw new Error('Download stream was not available');

  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
