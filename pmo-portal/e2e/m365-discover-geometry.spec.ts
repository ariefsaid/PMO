// @e2e-isolation: self-isolated — read-only: the Microsoft connection, Graph reads, the folder step and the project-documents / profile reads are page.route-mocked or rewritten with synthetic rows; nothing is written to the database or to Microsoft.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { login, waitForFonts } from './helpers';
import { PROJECT_ID } from './document-file-upload.helpers';

/**
 * #1020 Discover findings F1-F6/F10 (rendered geometry + wiring) — goal oracles, not snapshots:
 *   F1  a linked file row stays compact, its Date does not wrap, the access sentence is not repeated per row;
 *   F2/F4/F10 at a phone width nothing overflows the viewport, the primary header action stays reachable
 *       with no folder linked, and a very long Microsoft name stays inside the picker;
 *   F5  a "needs a choice" folder outcome offers a working "Choose existing folder";
 *   F6  the not-connected setup link goes to the page every role can open (/integrations);
 *   F3  in Bahasa the Microsoft strings are Indonesian.
 * Microsoft is mocked at the edge-function boundary; linked rows are synthetic rows prepended to the real
 * project-documents read (stored OneDrive FOLDER rows are filtered so the folder action stays visible).
 */

test.setTimeout(120_000);

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const SENTENCE = 'Opens in Microsoft. Access depends on your Microsoft permissions on this file.';
const LONG_TOKEN = 'Synthetic-unbroken-name-'.concat('x'.repeat(90));
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
async function mockCustody(page: Page, { connected, ensure }: CustodyOptions) {
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
    ms_check_claimed_at: null,
    ...overrides,
  };
}

const NORMAL_TITLE = 'Synthetic linked specification';
const DRAFT_TITLE = 'Synthetic linked draft';
const LONG_TITLE = LONG_TOKEN;
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
async function seedLinkedRows(page: Page) {
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
async function enableM365Feature(page: Page) {
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

/** Bahasa without a persisted write: the profile row the AuthProvider reads carries locale 'id' (as UXS-006). */
async function forceBahasa(page: Page) {
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
      body = { ...(body as Record<string, unknown>), locale: 'id', number_locale: 'id-ID' };
    }
    return route.fulfill({ response, json: body });
  });
}

async function openDocuments(page: Page, tabName: string) {
  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole('tab', { name: tabName }).click();
  await expect(page.getByTestId('liststate-loading')).toHaveCount(0, { timeout: 20_000 });
  await waitForFonts(page);
}

const registerRow = (page: Page, title: string): Locator => page.locator('table tbody tr').filter({ hasText: title }).first();

async function expectInsideViewport(page: Page) {
  await waitForFonts(page);
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

test.describe('#1020 Discover geometry (mocked Microsoft)', () => {
  test('F1: a linked file row stays compact, its Date does not wrap, and the access sentence is not repeated per row', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockCustody(page, { connected: true });
    await seedLinkedRows(page);
    await enableM365Feature(page);
    await login(page, 'pm@acme.test');
    await openDocuments(page, 'Documents');

    const dateIndex = await page.getByRole('columnheader', { name: /^Date/ }).evaluate((th) => (th as HTMLTableCellElement).cellIndex);
    for (const title of [NORMAL_TITLE, DRAFT_TITLE]) {
      const row = registerRow(page, title);
      await expect(row).toBeVisible();
      const box = await row.boundingBox();
      expect(box?.height ?? Infinity).toBeLessThanOrEqual(140);

      const dateCell = row.locator('td').nth(dateIndex);
      await expect(dateCell).toHaveText('2026-01-20');
      const lines = await dateCell.evaluate((cell) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        return new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top))).size;
      });
      expect(lines).toBe(1);
    }

    expect(await page.locator('table').getByText(SENTENCE).count()).toBeLessThanOrEqual(1);
  });

  test('F2/F4: at phone width a long linked name does not overflow and the primary header action stays in view with no folder linked', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockCustody(page, { connected: true });
    await seedLinkedRows(page);
    await enableM365Feature(page);
    await login(page, 'pm@acme.test');
    await openDocuments(page, 'Documents');

    await expect(page.getByRole('button', { name: 'Create folder in SharePoint' })).toBeVisible();
    const link = page.getByRole('button', { name: 'Link from Microsoft 365', exact: true });
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);

    await expect(page.getByText(LONG_TITLE).first()).toBeVisible();
    await expectInsideViewport(page);
  });

  test('F10: in the open picker a long unbroken folder name stays inside the dialog, selected and browsed into', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockCustody(page, { connected: true });
    await seedLinkedRows(page);
    await enableM365Feature(page);
    await login(page, 'pm@acme.test');
    await openDocuments(page, 'Documents');

    await page.getByRole('button', { name: 'Link from Microsoft 365', exact: true }).click();
    const picker = page.getByRole('dialog', { name: /Choose a Microsoft document/ });
    await picker.getByRole('button', { name: 'My OneDrive' }).click();
    await picker.getByRole('button', { name: `Select folder ${LONG_TOKEN}` }).click();
    await picker.getByRole('button', { name: `Browse ${LONG_TOKEN}` }).first().click();
    await expect(picker.getByRole('navigation', { name: 'Microsoft location' }).getByRole('button', { name: LONG_TOKEN })).toBeVisible();

    await waitForFonts(page);
    const overflowing = await picker.evaluate((dialog) => {
      const bounds = dialog.getBoundingClientRect();
      const offenders: string[] = [];
      if (dialog.scrollWidth > dialog.clientWidth) offenders.push('dialog scrolls horizontally');
      for (const el of Array.from(dialog.querySelectorAll<HTMLElement>('*'))) {
        const style = getComputedStyle(el);
        if (style.position === 'absolute' || style.position === 'fixed') continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const label = `${el.tagName.toLowerCase()}:${(el.textContent ?? '').trim().slice(0, 30)}`;
        if (r.right > bounds.right + 1 || r.left < bounds.left - 1) offenders.push(`${label} leaves the dialog`);
        const parent = el.parentElement;
        if (parent && parent !== dialog) {
          const p = parent.getBoundingClientRect();
          const parentStyle = getComputedStyle(parent);
          if (parentStyle.overflowX === 'visible' && r.right > p.right + 1) offenders.push(`${label} spills out of its container`);
        }
      }
      return offenders;
    });
    expect(overflowing).toEqual([]);
  });

  test('F5: a folder step that needs a choice offers "Choose existing folder", which opens the picker', async ({ page }) => {
    await mockCustody(page, { connected: true, ensure: { state: 'needs_choice' } });
    await seedLinkedRows(page);
    await enableM365Feature(page);
    await login(page, 'pm@acme.test');
    await openDocuments(page, 'Documents');

    await page.getByRole('button', { name: 'Create folder in SharePoint' }).click();
    const choose = page.getByRole('button', { name: 'Choose existing folder' });
    await expect(choose).toBeVisible();
    await choose.click();
    await expect(page.getByRole('dialog', { name: /Choose a Microsoft document/ })).toBeVisible();
  });

  test('F6: the not-connected notice links to the page every role can open (/integrations)', async ({ page }) => {
    await mockCustody(page, { connected: false });
    await seedLinkedRows(page);
    await enableM365Feature(page);
    await login(page, 'pm@acme.test');
    await openDocuments(page, 'Documents');

    await page.getByRole('button', { name: 'Link from Microsoft 365', exact: true }).click();
    const gate = page.getByTestId('m365-connection-gate');
    await expect(gate).toBeVisible();
    await expect(gate.getByRole('link')).toHaveAttribute('href', '/integrations');
  });

  test('F3: in Bahasa the Microsoft cell, picker and unlink confirmation are Indonesian', async ({ page }) => {
    await mockCustody(page, { connected: true });
    await seedLinkedRows(page);
    await enableM365Feature(page);
    await forceBahasa(page);
    await login(page, 'admin@acme.test');
    await openDocuments(page, 'Dokumen');

    const row = registerRow(page, DRAFT_TITLE);
    await expect(row).toBeVisible();
    await expect(row.getByText('File SharePoint')).toBeVisible();
    await expect(row.getByText('SharePoint file')).toHaveCount(0);

    // Unlink confirmation (opened, then dismissed: nothing is written).
    await row.hover();
    await row.getByRole('button', { name: 'Tindakan baris' }).click();
    await page.getByRole('menuitem', { name: 'Lepas tautan item Microsoft' }).click();
    await expect(page.getByText(`Lepas tautan ${DRAFT_TITLE}?`)).toBeVisible();
    await expect(page.getByText('Hanya referensi PMO yang dihapus. Item Microsoft tidak berubah.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText(`Lepas tautan ${DRAFT_TITLE}?`)).toHaveCount(0);

    // Picker.
    await page.getByRole('button', { name: 'Tautkan dari Microsoft 365', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Pilih dokumen Microsoft' });
    await expect(picker).toBeVisible();
    await expect(picker.getByText('Pilih lokasi')).toBeVisible();
    await expect(picker.getByRole('button', { name: 'OneDrive saya' })).toBeVisible();
    await expect(picker.getByText('Choose a location')).toHaveCount(0);
  });
});
