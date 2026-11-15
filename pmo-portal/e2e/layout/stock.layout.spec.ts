// @e2e-isolation: read-only — layout measurements on seeded stock routes; no writes.
import { test, expect, type Page } from '@playwright/test';
import { openAppPath, signIn, waitForFonts } from '../helpers';

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await expect(page.getByRole('status', { name: 'Loading page' })).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('liststate-loading')).toHaveCount(0, { timeout: 20_000 });
  await page.waitForTimeout(1000);
  await waitForFonts(page);
}

// ── Stock setup at 390: one surface, one left edge ──
test('@layout AC-STOCK-LAYOUT-001 stock setup @390: the heading, text, fields and first-column rows share one left edge', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'admin@acme.test');
  await openAppPath(page, '/stock/setup');
  await expect(page.getByRole('tab', { name: 'Units' })).toBeVisible({ timeout: 20_000 });
  await settle(page);
  const edges = await page.evaluate(() => {
    const main = document.querySelector('main') ?? document.body;
    const textLeft = (el: Element | null) => {
      if (!el) return null;
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = w.nextNode())) {
        if ((n.textContent ?? '').trim()) { const r = document.createRange(); r.selectNodeContents(n); return r.getBoundingClientRect().left; }
      }
      return null;
    };
    const out: { what: string; x: number | null }[] = [];
    out.push({ what: 'h1', x: textLeft(main.querySelector('h1')) });
    const lists = [...main.querySelectorAll('[role="tablist"]')];
    const setupTabs = lists[lists.length - 1];
    out.push({ what: 'setupTabLabel', x: textLeft(setupTabs?.querySelector('[role="tab"]') ?? null) });
    out.push({ what: 'showArchivedBox', x: main.querySelector('input[type="checkbox"]')?.closest('label')?.getBoundingClientRect().left ?? null });
    const row = main.querySelector('[role="tabpanel"] [class*="border"]');
    out.push({ what: 'rowsPanel', x: row ? row.getBoundingClientRect().left : null });
    return out;
  });
  const xs = edges.map((e) => Math.round(e.x ?? -1));
  expect(xs.every((x) => x >= 0), JSON.stringify(edges)).toBe(true);
  // One surface, one left edge: heading, tab text, field and the rows' panel all start on the page gutter.
  expect(new Set(xs).size, `left edges: ${JSON.stringify(edges)}`).toBe(1);
});

// ── Stock ledger at 1440: the Value column is reachable and money is never clipped ──
test('@layout AC-STOCK-LAYOUT-002 stock ledger @1440: the Value column is inside the viewport or its own scroller, and no money cell is clipped', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'admin@acme.test');
  await openAppPath(page, '/stock/ledger');
  await expect(page.getByTestId('stock-ledger-item-code').first()).toBeVisible({ timeout: 20_000 });
  await settle(page);
  const m = await page.evaluate(() => {
    const table = document.querySelector('table');
    const ths = [...document.querySelectorAll('table th')];
    const th = ths.find((h) => /value/i.test(h.textContent ?? '') && /balance|value/i.test(h.textContent ?? '')) ?? null;
    const valueHeads = ths.filter((h) => /value/i.test(h.textContent ?? ''));
    const last = valueHeads[valueHeads.length - 1];
    if (!table || !last) return { found: false } as const;
    // nearest scrollable ancestor
    let sc: Element | null = table.parentElement;
    while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowX)) sc = sc.parentElement;
    const vw = document.documentElement.clientWidth;
    const lr = last.getBoundingClientRect();
    const scr = sc ? sc.getBoundingClientRect() : null;
    const insideViewport = lr.right <= vw + 1;
    const insideScroller = !!scr && lr.right <= scr.right + 1 && lr.left >= scr.left - 1;
    const pageOverflow = document.documentElement.scrollWidth - vw;
    // money cells: any td whose text has a digit and sits in a value column
    const idx = ths.indexOf(last);
    const cells = [...document.querySelectorAll('table tbody tr')].map((tr) => tr.children[idx] as HTMLElement | undefined).filter(Boolean) as HTMLElement[];
    const clipped = cells.filter((c) => { const s = c.querySelector('span') ?? c; return s.scrollWidth > s.clientWidth + 1 || s.getBoundingClientRect().height > 24; }).length;
    return { found: true, vw, right: Math.round(lr.right), scrollerRight: scr ? Math.round(scr.right) : null, scrollable: sc ? sc.scrollWidth > sc.clientWidth : false, insideViewport, insideScroller, pageOverflow, clipped, th: th?.textContent };
  });
  expect(m.found, 'a Value column header must exist for Admin on seeded data').toBe(true);
  if (!m.found) return;
  // At 1440 the whole table fits its panel: the last Value column is in view at rest, with no
  // sideways scroll needed to read a balance (it stays reachable by scrolling at narrower widths).
  expect(m.insideViewport && m.insideScroller, `Value column must be in view at rest: ${JSON.stringify(m)}`).toBe(true);
  expect(m.pageOverflow, `page must not scroll sideways: ${JSON.stringify(m)}`).toBeLessThanOrEqual(1);
  expect(m.clipped, JSON.stringify(m)).toBe(0);
  // Scroll the container to the end: the column is then fully inside the container and the viewport.
  const after = await page.evaluate(() => {
    const table = document.querySelector('table')!;
    let sc: Element | null = table.parentElement;
    while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowX)) sc = sc.parentElement;
    if (sc) sc.scrollLeft = sc.scrollWidth;
    const ths = [...document.querySelectorAll('table th')].filter((h) => /value/i.test(h.textContent ?? ''));
    const r = ths[ths.length - 1].getBoundingClientRect();
    const sr = sc ? sc.getBoundingClientRect() : { right: window.innerWidth };
    return { right: r.right, scRight: sr.right, vw: document.documentElement.clientWidth };
  });
  expect(after.right).toBeLessThanOrEqual(Math.min(after.scRight, after.vw) + 1);
});
