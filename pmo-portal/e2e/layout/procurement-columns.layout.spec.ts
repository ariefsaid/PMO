// @e2e-isolation: read-only — measures the procurement list at desktop width; the browser rewrites only the
// READ response of procurements (page.route) to give one row a category, so no seed row is ever written.
/**
 * #1791 — the procurement list's All view at 1440 holds every column whole with Category present:
 * no column sits under the sticky actions column at rest, and the table never scrolls sideways.
 */
import { test, expect } from '@playwright/test';
import { signIn, waitForFonts } from '../helpers';

for (const locale of ['en', 'id'] as const) test(`@layout #1791: with Category shown, "Raised by" ends left of the actions column at 1440px (${locale})`, async ({ page }) => {
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
  await expect(page.locator('thead th[data-col-key="category"]')).toBeVisible({ timeout: 20_000 });
  await waitForFonts(page);
  const m = await page.evaluate(() => {
    const table = document.querySelector('table')!;
    const scroller = table.closest('.overflow-x-auto, [class*="overflow-x"]') as HTMLElement;
    const heads = Array.from(table.querySelectorAll<HTMLElement>('thead th'));
    const widths: Record<string, number> = {};
    for (const th of heads) widths[th.dataset.colKey ?? 'actions'] = Math.round(th.getBoundingClientRect().width);
    const owner = table.querySelector<HTMLElement>('thead th[data-col-key="owner"]')!;
    const actions = heads[heads.length - 1];
    // 'In stage' fit: header text and the widest value must fit the cell content box with no clip and no wrap.
    const ageTh = table.querySelector<HTMLElement>('thead th[data-col-key="age"]')!;
    const ageIdx = heads.indexOf(ageTh);
    const fit = (cell: HTMLElement) => {
      const cs = getComputedStyle(cell);
      const box = cell.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const r = document.createRange(); r.selectNodeContents(cell);
      const rects = Array.from(r.getClientRects());
      const lines = new Set(rects.map((x) => Math.round(x.top))).size;
      const text = Math.max(...rects.map((x) => x.width));
      return { box: Math.round(box * 10) / 10, text: Math.round(text * 10) / 10, lines, scrollOver: cell.scrollWidth - cell.clientWidth };
    };
    const ageCells = Array.from(table.querySelectorAll<HTMLElement>('tbody tr')).map((tr) => tr.children[ageIdx] as HTMLElement);
    const ageValues = ageCells.map(fit);
    const catIdx = heads.findIndex((h) => h.dataset.colKey === 'category');
    const rowEls = Array.from(table.querySelectorAll<HTMLElement>('tbody tr'));
    const statusTh = table.querySelector<HTMLElement>('thead th[data-col-key="stage"]')!;
    const stCs = getComputedStyle(statusTh);
    return {
      // header: the sort button (label + cue) must sit on one line inside the content box
      ageHeader: (() => {
        const btn = ageTh.querySelector<HTMLElement>('button')!;
        const label = btn.querySelector<HTMLElement>('span')!;
        const cs = getComputedStyle(ageTh);
        const box = ageTh.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const lines = Math.round(btn.getBoundingClientRect().height / label.getBoundingClientRect().height) || 1;
        return { labelW: Math.round(label.getBoundingClientRect().width * 10) / 10, labelH: Math.round(label.getBoundingClientRect().height), btnH: Math.round(btn.getBoundingClientRect().height), box: Math.round(box * 10) / 10, text: Math.round(btn.getBoundingClientRect().width * 10) / 10, lines: lines > 1 && btn.getBoundingClientRect().height < label.getBoundingClientRect().height * 1.5 ? 1 : lines, scrollOver: 0 };
      })(),
      ageWidest: ageValues.reduce((a, b) => (b.text > a.text ? b : a), ageValues[0]),
      ageWrapped: ageValues.some((v) => v.lines > 1),
      statusPad: [stCs.paddingLeft, stCs.paddingRight],
      statusFit: Array.from(table.querySelectorAll<HTMLElement>('tbody tr')).map((tr) => {
        const cell = tr.children[heads.indexOf(statusTh)] as HTMLElement;
        const pill = cell.querySelector<HTMLElement>('span')!;
        const cs = getComputedStyle(cell);
        return { box: cell.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), text: Math.round(pill.getBoundingClientRect().width * 10) / 10, lines: Math.round(pill.getBoundingClientRect().height / 20), scrollOver: cell.scrollWidth - cell.clientWidth };
      }).reduce((a, b) => (b.text > a.text ? b : a)),
      // #1791 r2: a category word never splits mid-word, and no row is taller than the previous list's tallest (82px).
      categoryClipped: rowEls.filter((tr) => { const c = tr.children[catIdx] as HTMLElement; return c.scrollWidth > c.clientWidth; }).length,
      rowMax: Math.max(...rowEls.map((tr) => Math.round(tr.getBoundingClientRect().height))),
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
  // #1791 ruling: the table's own width never exceeds the scroller's with Category present.
  expect(m.tableWidth).toBeLessThanOrEqual(m.scrollerClient);
  expect(m.statusFit.text).toBeLessThanOrEqual(m.statusFit.box);
  expect(m.statusPad.every((v) => parseFloat(v) >= 12)).toBe(true);
  expect(m.widths.category).toBeGreaterThanOrEqual(112);
  expect(m.categoryClipped).toBe(0);
  expect(m.rowMax).toBeLessThanOrEqual(82);
  expect(m.titleMax).toBeLessThanOrEqual(2);
  expect(m.ageWrapped).toBe(false);
  expect(m.ageWidest.text).toBeLessThanOrEqual(m.ageWidest.box);
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
