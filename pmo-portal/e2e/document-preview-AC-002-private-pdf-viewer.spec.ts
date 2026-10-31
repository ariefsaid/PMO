// @e2e-isolation: self-isolated — unique doc title/code (Date.now()); PM uploads and previews own PDF; no seed coupling.
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { login, waitForFonts } from './helpers';
import { createDocument, documentRow, issueDocument, openDocumentsTab } from './document-file-upload.helpers';

const PDF_FIXTURE = fileURLToPath(new URL('./fixtures/tiny-upload.pdf', import.meta.url));

test.setTimeout(120_000);

test('document-preview AC-002: a private project PDF opens inside PMO and closing returns to the same project', async ({ page, context }) => {
  const runId = Date.now();
  const title = `Viewer Journey ${runId}`;
  const code = `VW-${runId}`;

  await login(page, 'pm@acme.test');
  await openDocumentsTab(page);
  const row = await createDocument(page, { title, code, category: 'Drawing' });
  const dismissNotification = page.getByRole('button', { name: 'Dismiss notification' });
  if (await dismissNotification.isVisible()) await dismissNotification.click();

  // The local seed organisation has no Microsoft library, so this is the private flow.
  await row.getByLabel(`View ${title}`).click();
  const drawer = page.getByRole('complementary', { name: title });
  await expect(drawer).toBeVisible();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), drawer.getByLabel(`Upload file for ${title}`).click()]);
  await chooser.setFiles(PDF_FIXTURE);
  await expect(row.getByText('tiny-upload.pdf')).toBeVisible({ timeout: 15_000 });
  await drawer.getByRole('button', { name: 'Close preview' }).click();
  await expect(drawer).not.toBeVisible({ timeout: 10_000 });

  await issueDocument(page, documentRow(page, title));
  const issuedRow = documentRow(page, title);
  await expect(issuedRow.getByText('Issued')).toBeVisible({ timeout: 15_000 });
  if (await dismissNotification.isVisible()) await dismissNotification.click();
  await waitForFonts(page);

  const projectUrl = page.url();
  for (const closeWith of ['button', 'escape'] as const) {
    await issuedRow.getByLabel(`Preview file for ${title}`).click();
    const viewer = page.getByRole('dialog', { name: title });
    await expect(viewer).toBeVisible({ timeout: 15_000 });
    const frame = viewer.locator('iframe');
    await expect(frame).toHaveAttribute('title', title, { timeout: 15_000 });
    const src = await frame.getAttribute('src');
    expect(src).toContain('/storage/v1/object/sign/project-documents/');
    // The goal: a real PDF is served to the viewer, not an iframe-load event.
    const served = await page.request.get(src!);
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toContain('application/pdf');
    // And it can be framed: no frame-blocking header on the Storage response (the viewer is an iframe).
    expect(served.headers()['x-frame-options']).toBeUndefined();
    expect(served.headers()['content-security-policy'] ?? '').not.toContain('frame-ancestors');

    // Route intact: same URL, no popup, nothing opened.
    expect(page.url()).toBe(projectUrl);
    expect(context.pages()).toHaveLength(1);

    if (closeWith === 'button') await viewer.getByRole('button', { name: 'Close' }).click();
    else await page.keyboard.press('Escape');
    await expect(viewer).not.toBeVisible();

    // Back on the same project: tab, header and the document row are still there.
    await expect(page.getByRole('heading', { name: 'Document register' })).toBeVisible();
    await expect(documentRow(page, title)).toBeVisible();
    expect(page.url()).toBe(projectUrl);
  }

  // A 320 px phone: the open panel fits the screen and the page does not scroll sideways.
  await page.setViewportSize({ width: 320, height: 700 });
  await page.getByLabel(`Preview file for ${title}`).first().click(); // the list is not a table at this width
  const narrow = page.getByRole('dialog', { name: title });
  await expect(narrow).toBeVisible({ timeout: 15_000 });
  // The drawer slides in: wait for it to settle, then it must sit inside the 320 px screen.
  await expect.poll(async () => {
    const box = await narrow.boundingBox();
    return box ? box.x + box.width : Number.POSITIVE_INFINITY;
  }, { timeout: 5_000 }).toBeLessThanOrEqual(320);
  expect((await narrow.boundingBox())!.x).toBeGreaterThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
