// @e2e-isolation: self-isolated — unique overhead request title (Date.now()), no project; the Microsoft connection and Graph reads are page.route-mocked, no shared-row writes.
import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * #1020 AC-M365DOC-058/059 — a Project Manager links a SharePoint folder to an OVERHEAD
 * procurement case (no PMO project), and the reference survives reload and stage/tab navigation.
 *
 * Goal oracle: the linked folder is listed under "SharePoint links for this case" on the Documents tab and its
 * "Open folder in SharePoint" action is enabled — after a full reload and after leaving and
 * re-entering the tab. Microsoft is mocked at the edge-function boundary (connection status +
 * read-only Graph GETs); nothing is written to Microsoft.
 */

test.setTimeout(120_000);

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const FOLDER_NAME = 'Synthetic folder';
const DRIVE = { id: 'synthetic-drive', name: 'Synthetic OneDrive', webUrl: 'https://example.invalid/personal/synthetic' };
const FOLDER = {
  id: 'synthetic-folder-item',
  name: FOLDER_NAME,
  webUrl: 'https://example.invalid/personal/synthetic/Synthetic%20folder',
  folder: { childCount: 0 },
  parentReference: { driveId: DRIVE.id, path: '/drive/root:' },
};

/** Connection status and read-only Graph reads, answered at the custody edge function. */
async function mockMicrosoft(page: Page) {
  await page.route('**/functions/v1/m365-token-custody', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    const body = route.request().postDataJSON() as { action?: string; path?: string };
    const json = (payload: unknown) => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(payload) });
    if (body.action === 'connection_status') {
      await json({ connected: true, status: 'active', connected_at: '2026-10-01T00:00:00Z', last_refresh_at: null, scopes: ['Files.Read'] });
    } else if (body.action === 'graph_proxy' && body.path === '/me/drive') {
      await json(DRIVE);
    } else if (body.action === 'graph_proxy' && body.path?.startsWith(`/drives/${DRIVE.id}`)) {
      await json({ value: [FOLDER] });
    } else {
      await route.fulfill({ status: 500, headers: CORS, contentType: 'application/json', body: JSON.stringify({ error: 'INTERNAL_ERROR', message: 'stubbed' }) });
    }
  });
}

test('AC-M365DOC-058: a PM links a folder to a project-less case and it persists across reload and tabs — goal oracle: the folder is listed and openable', async ({ page }) => {
  const title = `E2E-M365-OVERHEAD-${Date.now()}`;
  await mockMicrosoft(page);
  await login(page, 'pm@acme.test');

  // Raise an overhead request: title only, no project.
  await page.goto('/procurement');
  await expect(page.getByTestId('liststate-loading')).toHaveCount(0, { timeout: 20_000 });
  await page.getByRole('button', { name: /raise request/i }).click();
  await expect(page).toHaveURL(/\/procurement\/new$/); // one-page create (#806)
  await page.getByLabel(/title/i).fill(title);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Draft', { timeout: 15_000 });

  // Documents tab → SharePoint links → pick the folder.
  await page.getByRole('tab', { name: /Documents/ }).click();
  const section = page.getByRole('region', { name: 'SharePoint links for this case' });
  await expect(section.getByText('No links yet')).toBeVisible({ timeout: 15_000 });
  await section.getByRole('button', { name: 'Link from Microsoft 365' }).click();

  const picker = page.getByRole('dialog', { name: /Choose a Microsoft document/ });
  await picker.getByRole('button', { name: 'My OneDrive' }).click();
  await picker.getByRole('button', { name: `Select folder ${FOLDER_NAME}` }).click();
  await picker.getByRole('button', { name: 'Link from Microsoft 365' }).click();

  const open = section.getByRole('button', { name: /Open folder in/ });
  await expect(section.getByText(FOLDER_NAME)).toBeVisible({ timeout: 15_000 });
  await expect(open.first()).toBeEnabled();

  // Reload, leave the tab and come back: the reference is still there.
  await page.reload();
  await page.getByRole('tab', { name: /Documents/ }).click();
  await expect(page.getByRole('region', { name: 'SharePoint links for this case' }).getByText(FOLDER_NAME)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('tab', { name: 'Overview' }).click();
  await page.getByRole('tab', { name: /Documents/ }).click();
  await expect(page.getByRole('region', { name: 'SharePoint links for this case' }).getByText(FOLDER_NAME)).toBeVisible();
  await expect(page.getByRole('region', { name: 'SharePoint links for this case' }).getByRole('button', { name: /Open folder in/ }).first()).toBeEnabled();
});
