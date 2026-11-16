// @e2e-isolation: read-only — measures the procurement list at desktop width; the browser rewrites only the
// READ response of procurements (page.route) to give one row a category, so no seed row is ever written.
/**
 * #1791/#2497 — the procurement list's All view at 1440 holds every column whole (status, amount, project,
 * requester; the category under its project): nothing clipped, nothing under the actions column, no sideways scroll.
 */
import { test, expect } from '@playwright/test';
import { signIn, waitForFonts } from '../helpers';

for (const locale of ['en', 'id'] as const) test(`@layout #1791/#2497: at 1440px every column holds its text whole with no sideways scroll (${locale})`, async ({ page }) => {
  // Read-only: the profile READ is rewritten to carry the language under test.
  await page.route('**/rest/v1/profiles?*', async (route) => {
    if (route.request().method() !== 'GET' || !/[?&]id=eq\./.test(route.request().url())) return route.fallback();
    const response = await route.fetch({ maxRetries: 2 });
    let body: unknown;
    try { body = await response.json(); } catch { return route.fulfill({ response }); }
    if (body && !Array.isArray(body) && typeof body === 'object' && 'locale' in body) {
      return route.fulfill({ response, json: { ...body, locale } });
    }
    return route.fulfill({ response, json: body });
  });
  await page.route('**/rest/v1/procurements?*', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET' || /id=eq\./.test(request.url())) return route.fallback();
    const response = await route.fetch({ maxRetries: 2 });
    let rows: unknown;
    try {
      rows = await response.json();
    } catch {
      return route.fulfill({ response });
    }
    if (!Array.isArray(rows) || rows.length === 0) return route.fulfill({ response });
    const withCategory = rows.map((row, index) => (index === 0 ? { ...(row as object), budget_category: 'Materials' } : row));
    return route.fulfill({ response, json: withCategory });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'admin@acme.test');
  await page.goto('/procurement?tab=all');
  // #2497: the category now rides under the project name (it is the project's budget line), not in its own column.
  await expect(page.locator('tbody').getByText(locale === 'id' ? 'Material' : 'Materials', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await waitForFonts(page);
  const m = await page.evaluate(() => {
    const table = document.querySelector('table')!;
    const scroller = table.closest('.overflow-x-auto, [class*="overflow-x"]') as HTMLElement;
    const heads = Array.from(table.querySelectorAll<HTMLElement>('thead th'));
    const widths: Record<string, number> = {};
    for (const th of heads) widths[th.dataset.colKey ?? 'actions'] = Math.round(th.getBoundingClientRect().width);
    const owner = table.querySelector<HTMLElement>('thead th[data-col-key="owner"]')!;
    const actions = heads[heads.length - 1];
    const rowEls = Array.from(table.querySelectorAll<HTMLElement>('tbody tr'));
    const col = (key: string) => heads.findIndex((h) => h.dataset.colKey === key);
    // Every cell in these columns holds its text whole: nothing clipped sideways, no ellipsis.
    const clipped = (key: string) => rowEls.filter((tr) => {
      const cell = tr.children[col(key)] as HTMLElement;
      return cell.scrollWidth > cell.clientWidth || Array.from(cell.querySelectorAll<HTMLElement>('*')).some((el) => el.scrollWidth > el.clientWidth + 1);
    }).length;
    return {
      clipped: { project: clipped('project'), owner: clipped('owner'), value: clipped('value'), stage: clipped('stage') },
      // A status pill is one line: it never wraps inside itself.
      pillWrapped: rowEls.filter((tr) => {
        const pill = (tr.children[col('stage')] as HTMLElement).querySelector<HTMLElement>('.rounded-full');
        return pill ? pill.getBoundingClientRect().height > 30 : false;
      }).length,
      statusPad: (() => { const cs = getComputedStyle(table.querySelector<HTMLElement>('thead th[data-col-key="stage"]')!); return [cs.paddingLeft, cs.paddingRight]; })(),
      titleMax: Math.max(...rowEls.map((tr) => { const b = tr.querySelector<HTMLElement>('button[aria-label]'); return b ? Math.round(b.getBoundingClientRect().height / parseFloat(getComputedStyle(b).lineHeight)) : 0; })),
      widths,
      tableWidth: Math.round(table.getBoundingClientRect().width),
      scrollerClient: scroller.clientWidth,
      scrollerScroll: scroller.scrollWidth,
      ownerRight: owner.getBoundingClientRect().right,
      actionsLeft: actions.getBoundingClientRect().left,
    };
  });
  console.log('WIDTHS', JSON.stringify(m));
  expect(m.ownerRight).toBeLessThanOrEqual(m.actionsLeft);
  expect(m.scrollerScroll).toBeLessThanOrEqual(m.scrollerClient);
  // #1791 ruling: the table's own width never exceeds the scroller's.
  expect(m.tableWidth).toBeLessThanOrEqual(m.scrollerClient);
  expect(m.clipped).toEqual({ project: 0, owner: 0, value: 0, stage: 0 });
  expect(m.pillWrapped).toBe(0);
  expect(m.statusPad.every((v) => parseFloat(v) >= 12)).toBe(true);
  expect(m.titleMax).toBeLessThanOrEqual(2);
});

for (const locale of ['en', 'id'] as const) test(`@layout #1791: at 390px every procurement tab sits whole inside the tab strip (${locale})`, async ({ page }) => {
  await page.route('**/rest/v1/profiles?*', async (route) => {
    if (route.request().method() !== 'GET' || !/[?&]id=eq\./.test(route.request().url())) return route.fallback();
    const response = await route.fetch({ maxRetries: 2 });
    let body: unknown;
    try { body = await response.json(); } catch { return route.fulfill({ response }); }
    if (body && !Array.isArray(body) && typeof body === 'object' && 'locale' in body) return route.fulfill({ response, json: { ...body, locale } });
    return route.fulfill({ response, json: body });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'admin@acme.test');
  await page.goto('/procurement?tab=all');
  await expect(page.getByRole('tab').first()).toBeVisible({ timeout: 20_000 });
  await waitForFonts(page);
  const edges = await page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('[role="tablist"]')!;
    const box = list.getBoundingClientRect();
    return Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]')).map((t) => { const r = t.getBoundingClientRect(); return { left: r.left - box.left, right: box.right - r.right }; });
  });
  for (const e of edges) { expect(e.left).toBeGreaterThanOrEqual(0); expect(e.right).toBeGreaterThanOrEqual(0); }
});
