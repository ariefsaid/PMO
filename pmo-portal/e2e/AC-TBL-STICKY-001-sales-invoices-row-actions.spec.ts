// @e2e-isolation: self-isolated — the geometry checks stub the Sales Invoices GET (no write); the
// real-columns check inserts its own uniquely-tagged sales-invoice rows via service role and
// deletes them in afterAll; touches no shared seed row.
/**
 * AC-TBL-STICKY-001 — Sales Invoices row-actions column during horizontal scroll.
 *
 * Defects this pins (2026-10-08 fix round, Director zoom of the 1440 render):
 * 1. SEAM: a sticky cell painted flush with the scrollport (`right-0`) misses its last ~1px of
 *    background in Chromium — scrolled text showed through as a glyph sliver PAST the ⋯ column.
 *    Oracle: the 1px column inside the scroller's right edge carries no ink (uniform surface) and
 *    the sticky cell's right edge is flush (within 1.5px) with the scroller's visible edge.
 * 2. SEPARATION: in a border-collapse table the collapsed `border-l` does not travel with a sticky
 *    cell and an outset box-shadow is not painted at all — the divider is an inset hairline plus a
 *    positioned gradient strip (`[data-dt-seam]`). Oracle: hairline pixel present in header+body;
 *    seam spans rendered.
 * 3. REAL COLUMNS: re-checked against real Sales Invoices columns (tax-basis note, e-Faktur pair,
 *    received/due dates) on real DB rows at 1280/1440, light+dark: ⋯ fully visible, nothing past
 *    it, menu portals to body (never clipped by the scroller/card) above the sticky cell.
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey, waitForFonts } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const ORG = '00000000-0000-0000-0000-000000000001';
const CUSTOMER_ID = 'c0000000-0000-0000-0000-000000000001'; // seed company (Solaris Grid EPC)
const EPSILON = 1.5;
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);

const WIDE_INVOICE = {
  id: 'aaaaaaaa-0000-0000-0000-000000000925',
  org_id: ORG,
  project_id: '40000000-0000-0000-0000-000000000013',
  customer_id: CUSTOMER_ID,
  si_number: 'SI-2026-00925',
  // The worst case for the seam: unbroken text under EVERY pixel column of the scroller,
  // including the 1px column at the sticky cell's edge (the Director's 1440 zoom).
  reference_number: `PO-${'WIDE-REFERENCE-'.repeat(20)}`,
  invoice_date: '2026-10-01',
  amount: 180_000_000,
  currency: 'IDR',
  tax_treatment: 'exclusive',
  tax_amount: 0,
  tax_rate: 11,
  tax_base_numerator: 1,
  tax_base_denominator: 1,
  erp_outstanding_amount: 180_000_000,
  status: 'Unpaid',
  erp_docstatus: 1,
  erp_modified: '2026-10-01T00:00:00Z',
  erp_amended_from: null,
  erp_cancelled_at: null,
  created_at: '2026-10-01T00:00:00Z',
  author_user_id: null,
  sales_invoice_authors: [],
  erp_due_date: null,
  received_date: null,
  efaktur_number: null,
  efaktur_date: null,
  companies: { name: 'Solaris Grid EPC', erp_payment_terms_days: 30 },
};

/** Luminance columns of a 1-2px-wide screenshot strip, averaged per device pixel row. */
async function stripLuminance(page: Page, x: number, y: number, width: number, height: number): Promise<number[]> {
  const buffer = await page.screenshot({ clip: { x, y, width, height } });
  const b64 = buffer.toString('base64');
  return page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + b64; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const cols: number[] = [];
    for (let cx = 0; cx < c.width; cx++) {
      let sum = 0;
      for (let cy = 0; cy < c.height; cy++) {
        const i = (cy * c.width + cx) * 4;
        sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
      }
      cols.push(sum / c.height);
    }
    return cols;
  }, b64);
}

async function measureSticky(page: Page) {
  return page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="dt-table-branch"]');
    if (!scroller) throw new Error('dt-table-branch not found');
    const sBox = scroller.getBoundingClientRect();
    const sStyle = getComputedStyle(scroller);
    const row = scroller.querySelector('tbody tr');
    const td = row?.querySelector('td:last-child');
    const th = scroller.querySelector('thead th:last-child');
    const box = (el: Element | null | undefined) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
    };
    const triggers = [...scroller.querySelectorAll<HTMLButtonElement>('tbody button[aria-label="Row actions"]')]
      .filter((b) => b.offsetParent !== null)
      .map((b) => {
        const r = b.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      });
    return {
      scroller: {
        left: sBox.left,
        // The visible (clip) right edge of the scrollport.
        right: sBox.left + scroller.clientWidth - parseFloat(sStyle.borderRightWidth || '0'),
        top: sBox.top,
        bottom: sBox.bottom,
        clientWidth: scroller.clientWidth,
        scrollWidth: scroller.scrollWidth,
      },
      stickyTd: box(td),
      stickyTh: box(th),
      triggers,
    };
  });
}

/** The rendered seam must be clean surface: no glyph ink in the last pixel column of the scroller.
 *  Sampled across the header + first body row only — headless Chromium draws classic (light)
 *  scrollbars inside the scroller's bottom edge, which would pollute a full-height strip. */
async function expectSeamClean(page: Page, scroller: { right: number; top: number; bottom: number }, mode: 'light' | 'dark') {
  const bandBottom = Math.min(scroller.top + 92, scroller.bottom - 2);
  // Sample the innermost 2px of the scrollport across the header + first body row.
  const lums = await stripLuminance(page, scroller.right - 2, scroller.top + 1, 2, bandBottom - scroller.top - 1);
  const min = Math.min(...lums);
  const max = Math.max(...lums);
  if (mode === 'light') {
    expect(
      min,
      `seam column must carry no ink in light mode (min luminance ${min.toFixed(1)} — a glyph sliver past the sticky cell renders as dark pixels)`,
    ).toBeGreaterThanOrEqual(195);
  } else {
    expect(
      max,
      `seam column must carry no ink in dark mode (max luminance ${max.toFixed(1)} — scrolled text shows as light pixels)`,
    ).toBeLessThanOrEqual(100);
  }
}

/** The inset hairline on the sticky cells' left edge must actually render (travels with the cell). */
async function expectHairlineVisible(page: Page, tdLeft: number, scroller: { top: number; bottom: number }, mode: 'light' | 'dark') {
  const bandBottom = Math.min(scroller.top + 92, scroller.bottom - 2);
  // The 1px hairline occupies [tdLeft, tdLeft+1] — a 1-CSS-px strip (a 0.75px clip rounds to 0
  // device pixels at DPR 1 and Playwright refuses it).
  const lums = await stripLuminance(page, tdLeft + 0.25, scroller.top + 1, 1, bandBottom - scroller.top - 1);
  const min = Math.min(...lums);
  const max = Math.max(...lums);
  if (mode === 'light') {
    expect(
      min,
      `divider hairline must be visible in light mode (min luminance ${min.toFixed(1)} — absent reads as pure card white 255)`,
    ).toBeLessThanOrEqual(247);
  } else {
    expect(
      max,
      `divider hairline must be visible in dark mode (max luminance ${max.toFixed(1)} — absent reads as flat card ~28)`,
    ).toBeGreaterThanOrEqual(33);
  }
}

async function setDark(page: Page, dark: boolean) {
  await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);
}

test.describe('AC-TBL-STICKY-001 Sales Invoices row-actions geometry', () => {
  for (const width of [1280, 1440]) {
    for (const mode of ['light', 'dark'] as const) {
      test(`AC-TBL-STICKY-001: sticky actions cell flush with scroller, seam clean, divider rendered at ${width}px ${mode}`, async ({ page }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width, height: 900 });
        await page.route('**/rest/v1/sales_invoices?**', async (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          await route.fulfill({ json: [WIDE_INVOICE] });
        });
        await signIn(page, 'finance@acme.test');
        await page.goto('/sales-invoices');

        const scrollerLoc = page.getByTestId('dt-table-branch');
        await expect(scrollerLoc).toBeVisible({ timeout: 20_000 });
        await expect(scrollerLoc.locator('tbody tr').first()).toBeVisible({ timeout: 20_000 });
        await expect(scrollerLoc.locator('tbody button[aria-label="Row actions"]').first()).toBeVisible();
        await expect(scrollerLoc.locator('[data-dt-seam]').first()).toBeAttached();
        // Flip the theme AFTER mount: index.html's no-flash script seeds the class from
        // localStorage (empty → light) on every load and would wipe a pre-goto class.
        await setDark(page, mode === 'dark');
        expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(mode === 'dark');
        await waitForFonts(page);

        const geo = await measureSticky(page);

        // Precondition: the table actually overflows, so sticky is exercised.
        expect(
          geo.scroller.scrollWidth,
          `Sales Invoices table should overflow: ${JSON.stringify(geo.scroller)}`,
        ).toBeGreaterThan(geo.scroller.clientWidth);
        expect(geo.triggers.length, 'expected a visible row-actions trigger').toBeGreaterThan(0);

        // Defect 1a: the ⋯ trigger lies inside the scroller box.
        const outside = geo.triggers.filter(
          ({ left, right }) => left < geo.scroller.left - EPSILON || right > geo.scroller.right + EPSILON,
        );
        expect(outside, `triggers must stay within the scroller box ${JSON.stringify({ scroller: geo.scroller, triggers: geo.triggers })}`).toEqual([]);

        // Defect 1b: the sticky cell is FLUSH with the scroller's visible right edge.
        expect(
          Math.abs((geo.stickyTd?.right ?? NaN) - geo.scroller.right),
          `sticky body cell right edge must sit at the scrollport edge (td ${JSON.stringify(geo.stickyTd)} vs scroller ${geo.scroller.right})`,
        ).toBeLessThanOrEqual(EPSILON);
        expect(
          Math.abs((geo.stickyTh?.right ?? NaN) - geo.scroller.right),
          `sticky header cell right edge must sit at the scrollport edge`,
        ).toBeLessThanOrEqual(EPSILON);

        // Defect 1c (the rendered defect itself): no ink in the seam column past the sticky cell.
        await expectSeamClean(page, geo.scroller, mode);

        // Defect 2: the separation hairline renders in BOTH the header and body sticky cells.
        await expectHairlineVisible(page, geo.stickyTd!.left, geo.scroller, mode);

        // Defect 2 (structural): the gradient strip exists in header and body — the outset
        // box-shadow it replaces is never painted by Chromium on sticky table cells.
        const seamCount = await page.locator('[data-dt-seam]').count();
        expect(seamCount, 'seam gradient strips expected in header + body rows').toBeGreaterThanOrEqual(2);
        const seamImage = await page.locator('[data-dt-seam]').first().evaluate((el) => getComputedStyle(el).backgroundImage);
        expect(seamImage, 'seam strip must paint the foreground-token gradient').toContain('gradient');
      });
    }
  }
});

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

  for (const width of [1280, 1440]) {
    for (const mode of ['light', 'dark'] as const) {
      test(`AC-TBL-STICKY-001: real columns at ${width}px ${mode} — ⋯ visible, nothing past it, menu opens unclipped above the sticky cell`, async ({ page }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width, height: 900 });
        await signIn(page, 'finance@acme.test');
        await page.goto('/sales-invoices');

        const scrollerLoc = page.getByTestId('dt-table-branch');
        await expect(scrollerLoc).toBeVisible({ timeout: 20_000 });
        await expect(scrollerLoc.locator('tbody tr').first()).toBeVisible({ timeout: 20_000 });
        await expect(scrollerLoc.locator('tbody button[aria-label="Row actions"]').first()).toBeVisible();
        // Flip the theme AFTER mount (the no-flash script seeds from empty localStorage → light).
        await setDark(page, mode === 'dark');
        expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(mode === 'dark');
        await waitForFonts(page);

        const geo = await measureSticky(page);
        expect(geo.scroller.scrollWidth, 'real column set must overflow the container to exercise sticky').toBeGreaterThan(geo.scroller.clientWidth);

        // ⋯ fully visible and inside the scroller; nothing renders right of it.
        const outside = geo.triggers.filter(
          ({ left, right }) => left < geo.scroller.left - EPSILON || right > geo.scroller.right + EPSILON,
        );
        expect(outside, `triggers within scroller: ${JSON.stringify({ geo })}`).toEqual([]);
        expect(Math.abs((geo.stickyTd?.right ?? NaN) - geo.scroller.right)).toBeLessThanOrEqual(EPSILON);
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
          return {
            parentIsBody: el.parentElement === document.body,
            zIndex: Number(getComputedStyle(el).zIndex),
            box: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
          };
        });
        expect(menuInfo.parentIsBody, 'the menu must be portaled to document.body (never inside the clipped scroller/card)').toBe(true);
        expect(menuInfo.zIndex, 'menu must stack above the sticky cells (z-[3])').toBeGreaterThanOrEqual(800);
        const vw = width;
        const vh = 900;
        expect(menuInfo.box.right).toBeLessThanOrEqual(vw + EPSILON);
        expect(menuInfo.box.left).toBeGreaterThanOrEqual(-EPSILON);
        expect(menuInfo.box.top).toBeGreaterThanOrEqual(-EPSILON);
        expect(menuInfo.box.bottom).toBeLessThanOrEqual(vh + EPSILON);
        // It does overlap the sticky column horizontally — it is rendered over it, not beside it.
        expect(menuInfo.box.left).toBeLessThan(geo.scroller.right);
        expect(menuInfo.box.right).toBeGreaterThan((geo.stickyTd?.left ?? 0));

        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
      });
    }
  }
});
