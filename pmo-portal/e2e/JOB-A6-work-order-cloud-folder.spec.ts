// @e2e-isolation: self-isolated — owns its project_administrator login, project, work order, and created project_documents rows; Microsoft custody and org library settings are route-mocked with no live external calls; removes owned rows in finally.
import { test, expect, type Page } from '@playwright/test';
import { ORG_ID, cleanupAll, need, projectWithWorkOrders, runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(180_000);

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const SITE = 'synthetic.example.invalid,site-a,web-a';
const DRIVE = 'synthetic-drive-wo';
const WO_FOLDER_ID = 'synthetic-wo-folder-item';
const UPLOADED_ITEM_ID = 'synthetic-wo-uploaded-item';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

async function mockCloudProvider(page: Page, woId: string, projectId: string, recorded: { ensureBodies: unknown[]; uploadCount: number; linkedFolder: boolean; createFolderRow: () => Promise<void> }) {
  await page.route('**/rest/v1/org_m365_document_settings*', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{
        default_site_id: SITE,
        default_site_name: 'Docs site',
        default_drive_id: DRIVE,
        default_drive_name: 'Documents',
        default_site_url: 'https://synthetic.sharepoint.com/sites/docs',
        updated_at: '2026-10-01T00:00:00Z',
      }]),
    });
  });

  await page.route('**/functions/v1/m365-token-custody', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const raw = route.request().postData() ?? '';
    const json = (payload: unknown) => route.fulfill({
      status: 200,
      headers: CORS,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
    if (route.request().headers()['content-type']?.includes('multipart/form-data') || raw.includes('upload_record_file')) {
      recorded.uploadCount += 1;
      return json({
        reference: {
          drive_id: DRIVE,
          item_id: UPLOADED_ITEM_ID,
          web_url: `https://synthetic.sharepoint.com/sites/docs/${UPLOADED_ITEM_ID}.pdf`,
          name: 'wo-drawing.pdf',
          item_kind: 'file',
        },
      });
    }
    const body = route.request().postDataJSON() as { action?: string; kind?: string; id?: string; path?: string; document_ids?: string[] };
    if (body.action === 'connection_status') {
      return json({ connected: true, status: 'active', connected_at: '2026-10-01T00:00:00Z', last_refresh_at: null, scopes: ['Files.Read', 'Sites.Selected'] });
    }
    if (body.action === 'ensure_record_folder') {
      recorded.ensureBodies.push(body);
      recorded.linkedFolder = true;
      await recorded.createFolderRow();
      return json({ state: 'created', document_id: '90000000-0000-0000-0000-000000000601' });
    }
    if (body.action === 'check_documents') return json({ checked: body.document_ids?.length ?? 0 });
    if (body.action === 'graph_proxy' && body.path?.includes(`/items/${WO_FOLDER_ID}/children`)) {
      // The folder holds the file only once the upload has reached the provider stub.
      return json({
        value: recorded.uploadCount === 0 ? [] : [{
          id: UPLOADED_ITEM_ID,
          name: 'wo-drawing.pdf',
          webUrl: `https://synthetic.sharepoint.com/sites/docs/${UPLOADED_ITEM_ID}.pdf`,
          size: PDF.byteLength,
          lastModifiedDateTime: '2026-11-24T10:00:00Z',
          parentReference: { driveId: DRIVE, path: `/drive/root:/Projects/${projectId}/${woId}` },
          file: { mimeType: 'application/pdf' },
        }],
      });
    }
    return route.fulfill({ status: 500, headers: CORS, contentType: 'application/json', body: JSON.stringify({ error: 'INTERNAL_ERROR', message: 'stubbed' }) });
  });
}

test('JOB-A6 TC-PA-13 Project Administrator creates and uploads work-order documents to the work-order cloud folder without gaining project-level writes', async ({ page }) => {
  const svc = serviceClient('JOB-A6');
  const run = runId('JOBA6');
  const pa = await roleJobUser(svc, 'project_administrator', run);
  const { projectId, workOrders } = await projectWithWorkOrders(svc, run, ['Cloud folder WO']);
  const wo = workOrders[0]!;
  // The provider stub's folder create leaves the work order's linked-folder row behind, as the real function does.
  const recorded = {
    ensureBodies: [] as unknown[], uploadCount: 0, linkedFolder: false,
    async createFolderRow() {
      need('folder row', await svc.from('project_documents').insert({
        org_id: ORG_ID, project_id: projectId, work_order_id: wo.id, title: `${run} WO folder`, status: 'Draft', source: 'onedrive',
        ms_drive_id: DRIVE, ms_item_id: WO_FOLDER_ID, ms_item_kind: 'folder', ms_item_name: 'Cloud folder WO',
        ms_web_url: 'https://synthetic.sharepoint.com/sites/docs/wo-folder', ms_linked_by: pa.id, ms_linked_at: '2026-10-01T00:00:00Z',
      }).select('id').single());
    },
  };

  try {
    await mockCloudProvider(page, wo.id, projectId, recorded);
    await pa.signIn(page);

    await page.goto(`/work-orders/${wo.id}`);
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Add document' }).click();
    await page.getByLabel(/Title/).fill(`${run} WO drawing`);
    await page.getByRole('dialog').getByRole('button', { name: 'Add document' }).click();

    await expect(page.getByText(`${run} WO drawing`)).toBeVisible({ timeout: 15_000 });

    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Upload/i }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: 'wo-drawing.pdf', mimeType: 'application/pdf', buffer: PDF });

    await expect.poll(() => recorded.uploadCount, { timeout: 15_000 }).toBe(1);
    // It appears in that work order's folder, on screen (the folder re-reads its listing when the page is opened again).
    await page.reload();
    await expect(page.getByRole('link', { name: 'Open wo-drawing.pdf in SharePoint' })).toBeVisible({ timeout: 20_000 });
    expect(recorded.ensureBodies).toContainEqual({ action: 'ensure_record_folder', kind: 'work_order', id: wo.id });

    // Project Administrator does not gain project-level document create rights
    await page.goto(`/projects/${projectId}`);
    await page.getByRole('tab', { name: /^Documents/ }).click();
    await expect(page.getByRole('heading', { name: 'Document register' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Add document' })).toHaveCount(0);
  } finally {
    await cleanupAll(svc, [
      ['project_documents', 'project_id', [projectId]],
      ['work_orders', 'id', [wo.id]],
      ['projects', 'id', [projectId]],
    ]);
    await pa.cleanup();
  }
});
