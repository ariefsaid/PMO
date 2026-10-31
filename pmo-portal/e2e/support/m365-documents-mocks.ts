// @e2e-isolation: read-only — the Microsoft connection, Graph reads, the folder step and the
// project-documents / profile reads are page.route-mocked or rewritten with synthetic rows;
// nothing is written to the database or to Microsoft.
/**
 * Shared Microsoft-documents mocks for the /projects/:id documents geometry sweeps (#1020) and the
 * remaining DOWN-lane discover tests. Microsoft is mocked at the custody edge-function boundary;
 * linked rows are synthetic rows prepended to the real project-documents read (stored OneDrive
 * FOLDER rows are filtered so the folder action stays visible).
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { waitForFonts } from '../helpers';
import { PROJECT_ID } from '../document-file-upload.helpers';

export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
};
export const SENTENCE = 'Opens in Microsoft. Access depends on your Microsoft permissions on this file.';
export const LONG_TOKEN = 'Synthetic-unbroken-name-'.concat('x'.repeat(90));
const DRIVE = { id: 'synthetic-drive', name: 'Synthetic OneDrive', webUrl: 'https://example.invalid/personal/synthetic' };
const LONG_FOLDER = {
  id: 'synthetic-long-folder',
  name: LONG_TOKEN,
  webUrl: `https://synthetic.sharepoint.com/sites/synthetic/Shared%20Documents/${LONG_TOKEN}`,
  folder: { childCount: 1 },
  parentReference: { driveId: DRIVE.id, path: '/drive/root:' },
};
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

interface CustodyOptions {
  connected: boolean;
  /** Answer to ensure_record_folder; omitted means the call is not expected. */
  ensure?: { state: string };
}

/** Connection status, read-only Graph GETs and the folder step, answered at the custody edge function. */
export async function mockCustody(page: Page, { connected, ensure }: CustodyOptions) {
  await page.route('**/functions/v1/m365-token-custody', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    const body = route.request().postDataJSON() as { action?: string; path?: string };
    const json = (payload: unknown) => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(payload) });
    if (body.action === 'connection_status') {
      await json(connected
        ? { connected: true, status: 'active', connected_at: '2026-10-01T00:00:00Z', last_refresh_at: null, scopes: ['Files.Read'] }
        : { connected: false, status: null, connected_at: null, last_refresh_at: null, scopes: [] });
    } else if (body.action === 'ensure_record_folder' && ensure) {
      await json(ensure);
    } else if (body.action === 'graph_proxy' && body.path === '/me/drive') {
      await json(DRIVE);
    } else if (body.action === 'graph_proxy' && body.path?.startsWith(`/drives/${DRIVE.id}`)) {
      await json({ value: [LONG_FOLDER] });
    } else {
      await route.fulfill({ status: 500, headers: CORS, contentType: 'application/json', body: JSON.stringify({ error: 'INTERNAL_ERROR', message: 'stubbed' }) });
    }
  });
}

function linkedRow(overrides: Record<string, unknown>) {
  return {
    org_id: ZERO_UUID,
    project_id: PROJECT_ID,
    author_id: null,
    category: 'Drawing',
    code: null,
    revision: 'A',
    doc_date: '2026-01-20',
    file_path: null,
    parent_document_id: null,
    created_at: '2026-01-20T00:00:00Z',
    source: 'onedrive',
    ms_drive_id: DRIVE.id,
    ms_item_kind: 'file',
    ms_linked_by: ZERO_UUID,
    ms_linked_at: '2026-01-20T00:00:00Z',
    ms_last_verified_at: null,
    ms_drift_state: null,
    ms_content_tag_at_issue: null,
    ms_version_id_at_issue: null,
    ms_check_claim: null,
    ...overrides,
  };
}

export const NORMAL_TITLE = 'Synthetic linked specification';
export const DRAFT_TITLE = 'Synthetic linked draft';
export const LONG_TITLE = LONG_TOKEN;
const SEEDED = [
  linkedRow({
    id: '90000000-0000-0000-0000-000000000001', title: NORMAL_TITLE, status: 'Approved', code: 'SYN-001',
    ms_item_id: 'synthetic-item-1', ms_item_name: 'specification.pdf', ms_drift_state: 'drifted',
    ms_version_id_at_issue: '1.0', ms_content_tag_at_issue: 'synthetic-tag',
    ms_web_url: 'https://synthetic.sharepoint.com/sites/synthetic/Shared%20Documents/specification.pdf',
  }),
  linkedRow({
    id: '90000000-0000-0000-0000-000000000002', title: LONG_TITLE, status: 'Draft',
    ms_item_id: 'synthetic-item-2', ms_item_name: `${LONG_TOKEN}.pdf`,
    ms_web_url: `https://synthetic.sharepoint.com/sites/synthetic/Shared%20Documents/${LONG_TOKEN}.pdf`,
  }),
  linkedRow({
    id: '90000000-0000-0000-0000-000000000003', title: DRAFT_TITLE, status: 'Draft',
    ms_item_id: 'synthetic-item-3', ms_item_name: 'draft.docx',
    ms_web_url: 'https://synthetic.sharepoint.com/sites/synthetic/Shared%20Documents/draft.docx',
  }),
];

/** Prepend the synthetic linked rows to the project's document read and drop stored OneDrive FOLDER rows. */
export async function seedLinkedRows(page: Page) {
  await page.route('**/rest/v1/project_documents?*', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET' || !request.url().includes(`project_id=eq.${PROJECT_ID}`)) return route.fallback();
    const response = await route.fetch();
    let rows: unknown;
    try {
      rows = await response.json();
    } catch {
      return route.fulfill({ response });
    }
    if (!Array.isArray(rows)) return route.fulfill({ response });
    const kept = (rows as Array<Record<string, unknown>>).filter((r) => !(r.source === 'onedrive' && r.ms_item_kind === 'folder'));
    return route.fulfill({ response, json: [...SEEDED, ...kept] });
  });
}

/** The record-folder UI is gated by the m365_integration entitlement: grant it by rewriting this page's org_features read. */
export async function enableM365Feature(page: Page) {
  await page.route('**/rest/v1/org_features*', async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const rows = (await response.json()) as Array<{ feature_key?: string; enabled?: boolean }>;
    return route.fulfill({
      response,
      json: [...rows.filter((r) => r.feature_key !== 'm365_integration'), { feature_key: 'm365_integration', enabled: true }],
    });
  });
}

/** Deterministic viewer language without a persisted write; other profile preferences are preserved. */
export async function forceDocumentsLocale(page: Page, locale: 'en' | 'id') {
  await page.route('**/rest/v1/profiles?*', async (route) => {
    if (route.request().method() !== 'GET' || !/[?&]id=eq\./.test(route.request().url())) return route.fallback();
    const response = await route.fetch();
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return route.fulfill({ response });
    }
    if (body && !Array.isArray(body) && typeof body === 'object' && 'locale' in body) {
      body = { ...(body as Record<string, unknown>), locale };
    }
    return route.fulfill({ response, json: body });
  });
}

/** Bahasa without a persisted write: the profile row the AuthProvider reads carries locale 'id' (as UXS-006). */
export async function forceBahasa(page: Page) {
  await forceDocumentsLocale(page, 'id');
}

export async function openDocuments(page: Page, tabName: string) {
  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole('tab', { name: tabName }).click();
  await expect(page.getByTestId('liststate-loading')).toHaveCount(0, { timeout: 20_000 });
  await waitForFonts(page);
}

export const registerRow = (page: Page, title: string): Locator =>
  page.locator('table tbody tr').filter({ hasText: title }).first();

export async function expectInsideViewport(page: Page) {
  await waitForFonts(page);
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}
