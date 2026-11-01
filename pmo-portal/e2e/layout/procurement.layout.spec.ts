// @e2e-isolation: read-only — layout measurements over the seeded procurement routes; UIP-007 and
// UIP-009 rewrite only the READ responses of procurements rows in the browser (page.route), so no
// seed row is ever written.
/**
 * /procurement layout sweep — the consolidated geometry gate for the procurement list, its five
 * detail tabs, and the record header:
 *   - the shared no-bleed + oversized-icon sweep (AC-MOBILE-OVERFLOW-001 / AC-VISUAL-ICON-001),
 *   - AC-PVT-001: the Table/Board view switch is reachable at 390px and switching changes the view,
 *   - UIP-007: comparative procurement values share one right edge with the Value header at 1440px,
 *   - UIP-009: the phone record header stacks the full title above the status chip without clipping.
 */
import { test, expect, type Page } from '@playwright/test';
import { signIn, waitForFonts } from '../helpers';
import { registerLayoutSweep } from '../support/layout-sweep';
import {
  assertGroupedProcurementValueAlignment,
  assertProcurementViewToggle,
  assertRecordHeaderStacksTitleAboveStatus,
} from '../support/layout-oracles';

// SP2401-001 "PV Modules — Meridian 4.2 MW" — richest seeded procurement case (stable seed id).
const PROC_SHOWCASE = '61000000-0000-0000-0000-000000000001';

registerLayoutSweep({ path: '/procurement', label: 'procurement-list', icons: true });
for (const tab of ['timeline', 'items', 'quotes', 'files', 'details'] as const) {
  registerLayoutSweep({ path: `/procurement/${PROC_SHOWCASE}/${tab}`, label: `procurement-detail-${tab}`, icons: false });
}

test('@layout AC-PVT-001: the Procurement view switch is visible at 390px and switching Table/Board changes the view', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'admin@acme.test');
  await page.goto('/procurement');
  await assertProcurementViewToggle(page);
});

/** Rewrite the procurements index read: prepend two synthetic 'Requested' rows sharing a unique
 *  searchable title prefix, shaped by spreading a real row (every column present). */
async function prependGroupedRows(page: Page, prefix: string) {
  await page.route('**/rest/v1/procurements?*', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET' || /id=eq\./.test(request.url())) return route.fallback();
    const response = await route.fetch();
    let rows: unknown;
    try {
      rows = await response.json();
    } catch {
      return route.fulfill({ response });
    }
    if (!Array.isArray(rows) || rows.length === 0) return route.fulfill({ response });
    const base = rows[0] as Record<string, unknown>;
    const synthetic = [1, 2].map((n) => ({
      ...base,
      id: `00000000-0000-4000-8000-00000000000${n}`,
      title: `${prefix} — synthetic comparative row ${n}`,
      status: 'Requested',
      total_value: n === 1 ? 9800 : 48000,
      currency: 'USD',
      open_commitment: null,
      vendor: null,
      requested_by: null,
    }));
    return route.fulfill({ response, json: [...synthetic, ...rows] });
  });
}

test('@layout UIP-007 keeps comparative procurement values and the header right-aligned at desktop', async ({
  page,
}) => {
  // Unique per-run prefix: the search box narrows the grouped view to exactly the two synthetic rows.
  const prefix = `UIP-007 ${Date.now()}`;
  await prependGroupedRows(page, prefix);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'finance@acme.test');
  await page.goto('/procurement?view=grouped');
  await page.getByRole('searchbox', { name: 'Search procurements' }).fill(prefix);
  await assertGroupedProcurementValueAlignment(page);
});

test('@layout UIP-009 stacks the full record title and status in the phone header', async ({ page }) => {
  // A long unbroken-ish title is the stacking worst case: serve the showcase record's data under a
  // synthetic id with the title (and only the title/id) overridden.
  const recordId = '62000000-0000-4000-8000-000000000001';
  const LONG_TITLE = 'Synthetic long procurement record header title — South hall switchgear commissioning package';
  await page.route('**/rest/v1/procurements?*', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET' || !request.url().includes(`id=eq.${recordId}`)) return route.fallback();
    // Serve the showcase row's shape with the synthetic identity, so every joined read stays real.
    // route.fetch keeps the caller's headers — including .single()'s object Accept type — so the
    // response may be a single object rather than an array.
    const response = await route.fetch({ url: request.url().replace(`id=eq.${recordId}`, `id=eq.${PROC_SHOWCASE}`) });
    let rows: unknown;
    try {
      rows = await response.json();
    } catch {
      return route.fulfill({ response });
    }
    const single = !Array.isArray(rows);
    const base = (single ? rows : (rows as unknown[])[0]) as Record<string, unknown> | undefined;
    if (!base) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"synthetic record not found"}' });
    const fixed = { ...base, id: recordId, title: LONG_TITLE, status: 'Requested' };
    return route.fulfill({ response, json: single ? fixed : [fixed] });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'finance@acme.test');
  await page.goto(`/procurement/${recordId}`);
  await expect(page.getByTestId('record-header')).toBeVisible({ timeout: 20_000 });
  await assertRecordHeaderStacksTitleAboveStatus(page, LONG_TITLE, 'Purchase Request');
  await waitForFonts(page);
});
