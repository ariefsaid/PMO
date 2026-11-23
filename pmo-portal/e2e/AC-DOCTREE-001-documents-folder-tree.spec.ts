// @e2e-isolation: read-only — a synthetic linked-folder row is added to this page's project-documents read and the Microsoft connection and folder listings are page.route-mocked; nothing is written to the database or to Microsoft.
import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';
import { openDocumentsTab, PROJECT_ID } from './document-file-upload.helpers';

/**
 * AC-DOCTREE-001 (#2806) — when a project's documents live in a linked SharePoint folder, a Project
 * Manager browses its folders and files in the Documents tab without opening the folder link or a
 * details drawer.
 *
 * Goal oracle: in the Documents tab's Folders view the linked folder is open with its contents
 * listed; opening a subfolder lists that level; the file is a link that opens SharePoint in a new tab.
 * Microsoft is mocked at the custody edge-function boundary (read-only listings).
 */

test.setTimeout(120_000);

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const DRIVE = 'synthetic-drive';
const ROOT = 'synthetic-root-folder';
const FOLDER_TITLE = 'Synthetic project folder';
const web = (name: string) => `https://synthetic.sharepoint.com/sites/project/Shared%20Documents/${encodeURIComponent(name)}`;
const graphItem = (id: string, name: string, kind: 'file' | 'folder', size: number) => ({
  id, name, webUrl: web(name), size, lastModifiedDateTime: '2026-11-18T09:00:00Z',
  parentReference: { driveId: DRIVE, path: '/drive/root:/Project' },
  ...(kind === 'folder' ? { folder: { childCount: 1 } } : { file: { mimeType: 'application/pdf' } }),
});
const CHILDREN: Record<string, unknown[]> = {
  [ROOT]: [graphItem('sub-drawings', 'Drawings', 'folder', 41_900_000), graphItem('file-schedule', 'Baseline schedule.xlsx', 'file', 284_330)],
  'sub-drawings': [graphItem('file-ga', 'General arrangement GA-001.pdf', 'file', 14_220_000)],
};

async function mockFolder(page: Page) {
  await page.route('**/functions/v1/m365-token-custody', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const body = route.request().postDataJSON() as { action?: string; path?: string; document_ids?: string[] };
    const json = (payload: unknown) => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(payload) });
    if (body.action === 'connection_status') {
      return json({ connected: true, status: 'active', connected_at: '2026-10-01T00:00:00Z', last_refresh_at: null, scopes: ['Files.Read'] });
    }
    if (body.action === 'check_documents') return json({ checked: body.document_ids?.length ?? 0 });
    const match = body.action === 'graph_proxy' ? /^\/drives\/[^/]+\/items\/([^/]+)\/children$/.exec(body.path ?? '') : null;
    if (match) return json({ value: CHILDREN[decodeURIComponent(match[1])] ?? [] });
    return route.fulfill({ status: 500, headers: CORS, contentType: 'application/json', body: JSON.stringify({ error: 'INTERNAL_ERROR', message: 'stubbed' }) });
  });
  await page.route('**/rest/v1/project_documents?*', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET' || !request.url().includes(`project_id=eq.${PROJECT_ID}`)) return route.fallback();
    const response = await route.fetch({ maxRetries: 2 });
    const rows = await response.json().catch(() => null);
    if (!Array.isArray(rows)) return route.fulfill({ response });
    const folder = {
      id: '90000000-0000-0000-0000-0000000000f1', org_id: '00000000-0000-0000-0000-000000000000', project_id: PROJECT_ID,
      author_id: null, title: FOLDER_TITLE, category: null, code: null, revision: null, doc_date: null, file_path: null,
      parent_document_id: null, created_at: '2026-10-01T00:00:00Z', status: 'Draft', source: 'onedrive',
      ms_drive_id: DRIVE, ms_item_id: ROOT, ms_item_kind: 'folder', ms_item_name: 'Project', ms_web_url: web('Project'),
      ms_linked_by: '00000000-0000-0000-0000-000000000000', ms_linked_at: '2026-10-01T00:00:00Z', ms_last_verified_at: null,
      ms_drift_state: null, ms_content_tag_at_issue: null, ms_version_id_at_issue: null, ms_check_claim: null,
    };
    return route.fulfill({ response, json: [folder, ...rows.filter((r: { ms_item_kind?: string }) => r.ms_item_kind !== 'folder')] });
  });
}

test('AC-DOCTREE-001: a PM browses the linked SharePoint folder as a tree in the Documents tab — goal oracle: subfolder contents listed, a file opens SharePoint in a new tab', async ({ page }) => {
  await mockFolder(page);
  await login(page, 'pm@acme.test');
  await openDocumentsTab(page);

  await page.getByRole('button', { name: 'Folders', exact: true }).click();
  const tree = page.getByRole('list', { name: 'Project folder' });
  await expect(tree.getByRole('button', { name: FOLDER_TITLE })).toHaveAttribute('aria-expanded', 'true');
  await expect(tree.getByRole('link', { name: 'Open Baseline schedule.xlsx in SharePoint' })).toBeVisible({ timeout: 15_000 });

  const drawings = tree.getByRole('button', { name: /^Drawings/ });
  await drawings.click();
  await expect(drawings).toHaveAttribute('aria-expanded', 'true');
  const file = tree.getByRole('link', { name: 'Open General arrangement GA-001.pdf in SharePoint' });
  await expect(file).toBeVisible({ timeout: 15_000 });
  await expect(file).toHaveAttribute('href', web('General arrangement GA-001.pdf'));
  await expect(file).toHaveAttribute('target', '_blank');

  // The view is kept in the address, so a reload or a shared link returns to the tree.
  await expect(page).toHaveURL(/documentsView=folders/);
});
