// @e2e-isolation: self-isolated — unique document title/code (Date.now()) on the seeded project, PM creates one Draft reference row; the Microsoft connection and Graph reads are page.route-mocked, nothing is written to Microsoft.
import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';
import { documentRow, openDocumentsTab } from './document-file-upload.helpers';

/**
 * AC-M365DOC-011/040/058 (support-owned by unit tests) — a Project Manager adds a project document
 * from a OneDrive FOLDER, completes the ordinary form, and the reference survives a full reload.
 *
 * Goal oracle: after reload the row shows the folder-reference sentence and an enabled
 * "Open folder in SharePoint" action, and offers no Issue/Approve controls. Microsoft is mocked
 * at the edge-function boundary (connection status + read-only Graph GETs).
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
  webUrl: 'https://synthetic.sharepoint.com/sites/synthetic/Shared%20Documents/Synthetic%20folder',
  folder: { childCount: 0 },
  parentReference: { driveId: DRIVE.id, path: '/drive/root:' },
};

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

test('AC-M365DOC-011/040/058: a PM adds a project document from a OneDrive folder and the folder reference persists — goal oracle: reference sentence + openable, never issuable', async ({ page }) => {
  const runId = Date.now();
  const title = `E2E-M365-FOLDER-${runId}`;
  await mockMicrosoft(page);
  await login(page, 'pm@acme.test');
  await openDocumentsTab(page);

  await page.getByRole('button', { name: 'Link from Microsoft 365', exact: true }).click();
  const picker = page.getByRole('dialog', { name: /Choose a Microsoft document/ });
  await picker.getByRole('button', { name: 'My OneDrive' }).click();
  await picker.getByRole('button', { name: `Select folder ${FOLDER_NAME}` }).click();
  await picker.getByRole('button', { name: 'Link from Microsoft 365' }).click();

  // Ordinary document form, seeded from the folder name; give it a unique title.
  const form = page.getByRole('dialog');
  await form.getByLabel(/title/i).fill(title);
  const code = form.getByLabel(/code/i);
  if (await code.count()) await code.fill(`M365-${runId}`);
  await form.getByLabel(/category/i).selectOption({ index: 1 });
  await form.getByRole('button', { name: /^(add|save) document$/i }).click();
  await expect(form).not.toBeVisible({ timeout: 15_000 });

  // Full reload: the reference is persisted, not session state.
  await openDocumentsTab(page);
  const row = documentRow(page, title);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByText('Folder reference — contents are not issued or approved')).toBeVisible();
  await expect(row.getByRole('button', { name: /Open folder in SharePoint/ })).toBeEnabled();

  // Reference-only: no Issue / Approve affordance in the row menu.
  await row.hover();
  await row.getByRole('button', { name: 'Row actions' }).click();
  await expect(page.getByRole('menuitem', { name: /^issue$/i })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: /^approve$/i })).toHaveCount(0);
});
