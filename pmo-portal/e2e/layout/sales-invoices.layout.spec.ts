// @e2e-isolation: self-isolated — inserts uniquely tagged invoice rows and deletes only those rows in afterAll.
/** Row actions travel with their row. Scroll to them, then prove the menu remains reachable,
 * portaled outside the table clip and contained in the viewport at both widths and themes. */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey, waitForFonts } from '../helpers';
import { requireMatchingLocalSupabaseUrls } from '../../src/lib/testing/localSupabaseUrl';
import {
  STICKY_EPSILON,
  expectSeamClean,
  measureSticky,
  setDarkTheme,
} from '../support/layout-oracles';

const ORG = '00000000-0000-0000-0000-000000000001';
const CUSTOMER_ID = 'c0000000-0000-0000-0000-000000000001'; // seed company (Solaris Grid EPC)
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);

/** Shared pre-measurement waits: the desktop table branch with data rows and a row-actions
 *  trigger must be up before any geometry is measured. */
async function openInvoicesTable(page: Page) {
  await signIn(page, 'finance@acme.test');
  // /sales-invoices is a legacy redirect to the Receivables hub (FinanceLegacyRedirect, ux/1110):
  // the hub draws its figures and the age strip above the register, so the table arrives BELOW the
  // 900px fold and the screenshot-based seam oracle (viewport clip) must measure it in view. The
  // geometry oracles themselves are unchanged.
  await page.goto('/sales-invoices');
  const scrollerLoc = page.getByTestId('dt-table-branch');
  await expect(scrollerLoc).toBeVisible({ timeout: 20_000 });
  await expect(scrollerLoc.locator('tbody tr').first()).toBeVisible({ timeout: 20_000 });
  await expect(scrollerLoc.locator('tbody button[aria-label="Row actions"]').first()).toBeVisible();
  // The hub above the register fills in asynchronously: the register's own rows can arrive first,
  // and then the tiles/ageings land and push the table back under the fold — so wait for the page
  // above it to settle BEFORE scrolling, and prove the scroll actually holds.
  await expect(page.getByTestId('kpi-skeleton')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId('liststate-loading')).toHaveCount(0, { timeout: 20_000 });
  // The seam oracle screenshots a 1-2px strip from the scroller's top edge down ~92px (header row +
  // first body row), so THAT BAND must be inside the viewport — scroll for it when the register sits
  // under the fold, and prove it before measuring instead of letting the clip throw.
  await scrollerLoc.evaluate((element) => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await expect.poll(async () => scrollerLoc.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const bandBottom = Math.min(box.top + 92, box.bottom - 2);
    return box.top >= 0 && bandBottom <= window.innerHeight;
  }), { message: 'the register header band is inside the viewport before geometry is measured' }).toBe(true);
  await waitForFonts(page);
  return scrollerLoc;
}

test.describe('AC-TBL-STICKY-001 real Sales Invoices columns (DB rows)', () => {
  const insertedIds: string[] = [];
  let admin: SupabaseClient | undefined;

  test.beforeAll(async () => {
    const key = requireServiceRoleKey();
    if (!key) throw new Error('AC-TBL-STICKY-001 real-columns check needs SUPABASE_SERVICE_ROLE_KEY — run via scripts/e2e-local.sh');
    admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
    // Real-shaped rows: tax-basis fraction (11/12), e-Faktur pair, received date, ERP due date —
    // the real column set, real-length values. Unique ids per run (self-isolated).
    for (let i = 0; i < 4; i++) {
      const id = crypto.randomUUID();
      insertedIds.push(id);
      const { error } = await admin.from('sales_invoices').insert({
        id,
        org_id: ORG,
        customer_id: CUSTOMER_ID,
        si_number: `SI-2026-9${i}25`,
        reference_number: `PO-2026-10-00${i}42`,
        invoice_date: '2026-10-01',
        amount: 184_500_000 + i,
        currency: 'IDR',
        tax_treatment: 'exclusive',
        tax_amount: 20_295_000,
        tax_rate: 11,
        tax_base_numerator: 11,
        tax_base_denominator: 12,
        erp_outstanding_amount: 184_500_000 + i,
        status: 'Unpaid',
        erp_docstatus: 1,
        erp_modified: '2026-10-01T00:00:00Z',
        received_date: '2026-10-05',
        erp_due_date: '2026-10-31',
        efaktur_number: `01000925100${i}42`,
        efaktur_date: '2026-10-02',
      });
      if (error) throw new Error(`AC-TBL-STICKY-001 fixture row: ${error.message}`);
    }
  });

  test.afterAll(async () => {
    if (!admin || insertedIds.length === 0) return;
    await admin.from('sales_invoices').delete().in('id', insertedIds);
  });

  for (const width of [1024, 1440] as const) {
    // One load per width; both themes (and the row-menu stacking oracle) run in that load.
    test(`@layout AC-TBL-STICKY-001: real columns at ${width}px — row actions reachable by scrolling, menu opens unclipped in light and dark`, async ({ page }) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width, height: 900 });
      const scrollerLoc = await openInvoicesTable(page);

      for (const mode of ['light', 'dark'] as const) {
        await setDarkTheme(page, mode === 'dark');
        await waitForFonts(page);

        // Row actions intentionally travel with their row; scroll to them before operating the menu.
        await scrollerLoc.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
        const geo = await measureSticky(page);

        // ⋯ fully visible and inside the scroller; nothing renders right of it.
        const outside = geo.triggers.filter(
          ({ left, right }) => left < geo.scroller.left - STICKY_EPSILON || right > geo.scroller.right + STICKY_EPSILON,
        );
        expect(outside, `triggers within scroller: ${JSON.stringify({ geo })}`).toEqual([]);
        if (width === 1024) {
          expect(Math.abs((geo.stickyTd?.right ?? NaN) - geo.scroller.right)).toBeLessThanOrEqual(STICKY_EPSILON);
        }
        await expectSeamClean(page, geo.scroller, mode);

        // The row menu opens ABOVE the sticky cell: portaled to body (escapes every overflow
        // clip — the recurring "tests green, render clipped" defect), z-index over the sticky
        // cells, and fully inside the viewport (right-aligned to the trigger, never off-screen).
        const trigger = scrollerLoc.locator('tbody button[aria-label="Row actions"]').first();
        await trigger.click();
        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible();
        const menuInfo = await menu.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const portalRoot = el.closest('[data-base-ui-portal]');
          let zIndex = 0;
          for (let node: HTMLElement | null = el as HTMLElement; node; node = node.parentElement) {
            const value = Number(getComputedStyle(node).zIndex);
            if (Number.isFinite(value) && value > zIndex) zIndex = value;
          }
          return {
            portalRootIsBodyChild: portalRoot?.parentElement === document.body,
            escapesScroller: el.closest('[data-testid="dt-table-branch"]') === null,
            zIndex,
            box: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
          };
        });
        expect(menuInfo.portalRootIsBodyChild, 'the menu portal must attach directly to document.body (outside the clipped scroller/card)').toBe(true);
        expect(menuInfo.escapesScroller, 'the menu must escape the clipped scroller/card (portaled out of its overflow clip)').toBe(true);
        expect(menuInfo.zIndex, 'menu positioner must stack above the sticky cells (z-[3])').toBeGreaterThanOrEqual(800);
        const vw = width;
        const vh = 900;
        expect(menuInfo.box.right).toBeLessThanOrEqual(vw + STICKY_EPSILON);
        expect(menuInfo.box.left).toBeGreaterThanOrEqual(-STICKY_EPSILON);
        expect(menuInfo.box.top).toBeGreaterThanOrEqual(-STICKY_EPSILON);
        expect(menuInfo.box.bottom).toBeLessThanOrEqual(vh + STICKY_EPSILON);
        // It does overlap the sticky column horizontally — it is rendered over it, not beside it.
        expect(menuInfo.box.left).toBeLessThan(geo.scroller.right);
        expect(menuInfo.box.right).toBeGreaterThan((geo.stickyTd?.left ?? 0));

        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
      }
    });
  }
});
