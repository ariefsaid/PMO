// @e2e-isolation: read-only — holds late reads and measures layout; no DB writes.
/**
 * AC-NBR-030 (#2197): when a late read lands, the page does not move.
 *  (1) /sales: while Won/Lost load, their column / phone-list tail hold the space they will fill.
 *  (2) Receivables: the status chip row holds its space until the revenue mode is known.
 *  (3) Invoice record: the primary action's slot is held until the revenue mode is known.
 * Goal oracle: the measured shift (getBoundingClientRect before / after the held read resolves) is 0 px,
 * at 1440 and 390, in English and Bahasa. Each case prints one line with the px values.
 */
import { test, expect, type Page } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';

const LANGS = [{ code: 'en', numberLocale: 'en-US' }, { code: 'id', numberLocale: 'id-ID' }] as const;
const WIDTHS = [1440, 390] as const;

async function pinLocale(page: Page, locale: string, numberLocale: string) {
  await page.route('**/rest/v1/profiles?*', async (route) => {
    if (route.request().method() !== 'GET' || !/[?&]id=eq\./.test(route.request().url())) return route.fallback();
    const response = await route.fetch({ maxRetries: 2 });
    let body: unknown;
    try { body = await response.json(); } catch { return route.fulfill({ response }); }
    if (body && !Array.isArray(body) && typeof body === 'object' && 'locale' in body) {
      return route.fulfill({ response, json: { ...body, locale, number_locale: numberLocale } });
    }
    return route.fulfill({ response, json: body });
  });
}

/** Hold matching requests until `release()` is called. */

/** Tag every element now on the page with its top; later, how far did any of them move? */
const tagTops = (page: Page) => page.evaluate(() => {
  document.querySelectorAll<HTMLElement>('main *, header *, nav *').forEach((e, i) => {
    e.dataset.nbrId = String(i);
    const r = e.getBoundingClientRect();
    e.dataset.nbrTop = String(r.top + window.scrollY);
    e.dataset.nbrVisible = r.bottom > 0 && r.top < window.innerHeight && r.height > 0 ? '1' : '0';
  });
});
const maxDisplacement = (page: Page) => page.evaluate(() => {
  let max = 0;
  let maxVisible = 0;
  let who = '';
  document.querySelectorAll<HTMLElement>('[data-nbr-id]').forEach((e) => {
    if (e.closest('[data-testid="kanban-column-pending"], [data-testid="sales-phone-list-pending"]')) return;
    const d = Math.abs(e.getBoundingClientRect().top + window.scrollY - Number(e.dataset.nbrTop));
    if (e.dataset.nbrVisible === '1' && d > maxVisible) maxVisible = d;
    if (d > max) { max = d; who = `${e.tagName.toLowerCase()}${e.dataset.testid ? '#' + e.dataset.testid : ''}[${(e.textContent ?? '').trim().slice(0, 40)}]`; }
  });
  return { max: Math.round(max * 100) / 100, visible: Math.round(maxVisible * 100) / 100, who };
});
const rectOf = (page: Page, selector: string) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top + window.scrollY, height: r.height, bottom: r.bottom + window.scrollY };
}, selector);
/** Height of what the page owns: the tallest scrollable content (window or the app's scroll region) plus main's box. */
const contentHeight = (page: Page) => page.evaluate(() => {
  const main = document.querySelector('main');
  const r = main?.getBoundingClientRect();
  const scrollers = Array.from(document.querySelectorAll<HTMLElement>('*')).filter((e) => e.scrollHeight > e.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(e).overflowY));
  const tallest = Math.max(document.documentElement.scrollHeight, ...scrollers.map((e) => e.scrollHeight));
  return { main: r ? Math.round(r.height * 100) / 100 : 0, scroll: tallest };
});

for (const lang of LANGS) {
  for (const width of WIDTHS) {
    test.describe(`AC-NBR-030 ${lang.code} @${width}`, () => {
      test.use({ viewport: { width, height: width === 390 ? 844 : 900 } });

      test(`(1) /sales: held Won+Lost reads hold their space`, async ({ page }) => {
        await pinLocale(page, lang.code, lang.numberLocale);
        await signIn(page, 'exec@acme.test');
        await page.goto('/sales');
        await expect(page.getByRole('searchbox').first()).toBeVisible();
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        await page.route(/\/rest\/v1\/projects\?/, async (route) => {
          const url = decodeURIComponent(route.request().url());
          if (/Loss Tender|Declined|Won|Active|Closed/.test(url) && /status=in/.test(url)) await gate;
          await route.continue().catch(() => undefined);
        });
        await page.reload();
        await expect(page.getByRole('searchbox').first()).toBeVisible();
        const pending = await page.locator('[aria-busy="true"]').count();
        await page.waitForTimeout(400);
        await waitForFonts(page);
        const before = await contentHeight(page);
        await tagTops(page);
        const busyBefore = await page.locator('[data-testid="kanban-column-pending"], [data-testid="sales-phone-list-pending"]').count();
        release();
        await expect(page.locator('[data-testid="kanban-column-pending"], [data-testid="sales-phone-list-pending"]')).toHaveCount(0, { timeout: 8000 });
        await page.waitForTimeout(300);
        const after = await contentHeight(page);
        const { max: displacedAll, visible: displaced, who } = await maxDisplacement(page);
        if (displacedAll > 1) console.log(`DEBUG off-screen mover: ${who}`);
        console.log(`MEASURE item1 sales ${lang.code} ${width}px: busyRegions=${busyBefore} (aria-busy total ${pending}) mainHeight ${before.main} -> ${after.main} scrollHeight ${before.scroll} -> ${after.scroll} displacement of content visible in the viewport=${displaced}px (all content incl. off-screen=${displacedAll}px; page grows ${after.scroll - before.scroll}px as the held rows arrive)`);
        expect(displaced).toBeLessThanOrEqual(1);
        expect(busyBefore).toBeGreaterThan(0);
      });

      test(`(2) Receivables: chip row holds its space until the mode lands`, async ({ page }) => {
        await pinLocale(page, lang.code, lang.numberLocale);
        await signIn(page, 'finance@acme.test');
        await page.goto('/finance/receivables');
        await page.waitForLoadState('networkidle').catch(() => undefined);
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        await page.route(/\/rest\/v1\/external_domain_ownership/, async (route) => { await gate; await route.continue().catch(() => undefined); });
        await page.reload();
        await expect(page.locator('[data-testid="invoice-list-body"], table').first()).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(400);
        const chipPending = await page.getByTestId('status-filters-pending').count();
        const submittedChip = await page.getByRole('tab', { name: /^(Submitted|Diajukan)$/ }).count();
        const rowsProbe = '[data-testid="invoice-list-body"] > *';
        const overlapNow = () => page.evaluate(() => {
          const count = Array.from(document.querySelectorAll<HTMLElement>('[aria-live="polite"]')).find((e) => /\d/.test(e.textContent ?? '') && /(of|dari)/.test(e.textContent ?? ''));
          const exp = Array.from(document.querySelectorAll<HTMLElement>('button')).find((b) => /^(Export|Ekspor)/.test((b.textContent ?? '').trim()));
          if (!count || !exp) return 'n/a';
          const a = count.getBoundingClientRect(); const b = exp.getBoundingClientRect();
          const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left); const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          return ix > 0 && iy > 0 ? `${Math.round(ix)}x${Math.round(iy)}px` : `none (gap ${Math.round(b.left - a.right)}px)`;
        });
        await waitForFonts(page);
        const overlapBeforeRelease = await overlapNow();
        const chipBoxBefore = await rectOf(page, '[data-testid="status-filter-scroll"]');
        const before = await rectOf(page, rowsProbe);
        release();
        await expect(page.getByTestId('status-filters-pending')).toHaveCount(0, { timeout: 8000 });
        await page.waitForTimeout(300);
        const after = await rectOf(page, rowsProbe);
        const chipBoxAfter = await rectOf(page, '[data-testid="status-filter-scroll"]');
        const overlap = await overlapNow();
        console.log(`MEASURE item2b count-vs-export ${lang.code} ${width}px: chip box ${chipBoxBefore?.height} -> ${chipBoxAfter?.height}, overlap while pending ${overlapBeforeRelease}, after ${overlap}`);
        expect(overlap).not.toMatch(/^\d/);
        expect(overlapBeforeRelease).not.toMatch(/^\d/);
        console.log(`MEASURE item2 receivables ${lang.code} ${width}px: placeholder=${chipPending} submittedChipWhilePending=${submittedChip} listTop(first row block) ${before?.top} -> ${after?.top} shift=${(after?.top ?? 0) - (before?.top ?? 0)}px`);
        if (width === 1440) expect(chipPending).toBe(1);
        expect(submittedChip).toBe(0);
        expect(Math.abs((after?.top ?? 0) - (before?.top ?? 0))).toBeLessThanOrEqual(0.5);
      });

      test(`(3) Invoice record: the action slot is held while the mode loads`, async ({ page }) => {
        await pinLocale(page, lang.code, lang.numberLocale);
        await signIn(page, 'finance@acme.test');
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
        const base = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
        const res = await page.request.get(`${base}/rest/v1/sales_invoices?select=id&status=in.(Draft,Submitted,Unpaid)&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
        const rows = (await res.json()) as { id: string }[];
        test.skip(!rows.length, 'no Draft/Submitted/Unpaid invoice in seed');
        await page.goto('/sales-invoices');
        await page.waitForLoadState('networkidle').catch(() => undefined);
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        await page.route(/\/rest\/v1\/external_domain_ownership/, async (route) => { await gate; await route.continue().catch(() => undefined); });
        await page.goto(`/sales-invoices/${rows[0].id}`);
        await expect(page.getByTestId('invoice-record')).toBeVisible({ timeout: 15000 });
        await expect(page.getByTestId('record-action-pending')).toBeVisible({ timeout: 8000 });
        await page.waitForTimeout(400);
        await waitForFonts(page);
        const probe = '[data-testid="invoice-record"] > *:last-child';
        const before = await rectOf(page, probe);
        release();
        await expect(page.getByTestId('record-action-pending')).toHaveCount(0, { timeout: 8000 });
        await page.waitForTimeout(300);
        const after = await rectOf(page, probe);
        console.log(`MEASURE item3 invoice-record ${lang.code} ${width}px: factsTop ${before?.top} -> ${after?.top} shift=${(after?.top ?? 0) - (before?.top ?? 0)}px`);
      });
    });
  }
}
