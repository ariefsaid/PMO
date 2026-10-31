import { expect, type Page, type Locator } from '@playwright/test';
import { waitForFonts } from '../helpers';

export async function findBleeders(page: Page, vw: number) {
  return page.evaluate((vw) => {
    const tol = 2;
    const inScroller = (el: Element): boolean => {
      let p = el.parentElement;
      while (p) {
        const ov = getComputedStyle(p).overflowX;
        if (ov === 'auto' || ov === 'scroll') return true;
        p = p.parentElement;
      }
      return false;
    };
    const out: { tag: string; cls: string; right: number; text: string }[] = [];
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.right > vw + tol && !inScroller(el)) {
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.getAttribute('class') ?? '').slice(0, 60),
          right: Math.round(r.right),
          text: (el.textContent ?? '').trim().slice(0, 30),
        });
      }
    });
    // De-dup parents that share the same right edge (report the outermost few).
    out.sort((a, b) => b.right - a.right);
    return out.slice(0, 12);
  }, vw);
}

interface OversizedIcon {
  width: number;
  height: number;
  nearbyText: string;
  ariaLabel: string;
  classList: string;
}

/** Walk every `svg[viewBox="0 0 24 24"]` on the page. Skip invisible ones (size 0 or
 *  display:none). Return those whose rendered width or height exceeds MAX_ICON_SIZE. */
export async function findOversizedIcons(page: Page, maxSize: number): Promise<OversizedIcon[]> {
  // Icons sized in em track the text face, so measure on the settled (post-swap) layout (#713).
  await waitForFonts(page);
  return page.evaluate((maxSize) => {
    const oversized: {
      width: number;
      height: number;
      nearbyText: string;
      ariaLabel: string;
      classList: string;
    }[] = [];

    document.querySelectorAll<SVGSVGElement>('svg[viewBox="0 0 24 24"]').forEach((svg) => {
      // Skip display:none elements.
      if (getComputedStyle(svg).display === 'none') return;

      const rect = svg.getBoundingClientRect();
      // Skip zero-size (hidden / not laid out / off-screen).
      if (rect.width === 0 && rect.height === 0) return;

      if (rect.width > maxSize || rect.height > maxSize) {
        // Find the nearest text for a debuggable failure message: look at parent chain.
        let nearbyText = '';
        let el: Element | null = svg.parentElement;
        for (let i = 0; i < 5 && el; i++) {
          const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
          if (t) { nearbyText = t; break; }
          el = el.parentElement;
        }

        oversized.push({
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          nearbyText,
          ariaLabel: svg.getAttribute('aria-label') ?? '',
          classList: (svg.getAttribute('class') ?? '').slice(0, 80),
        });
      }
    });

    return oversized;
  }, maxSize);
}

export async function assertNoBleed(page: Page, width: number) {
  const bleeders = await findBleeders(page, width);
  expect(bleeders, `Elements extending beyond ${width}px`).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 2);
}

export async function assertIconSizes(page: Page) {
  expect(await findOversizedIcons(page, 40), 'Shared icons must fit within 40px').toEqual([]);
}

export async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll, `document overflowed by ${dimensions.scroll - dimensions.client}px`).toBeLessThanOrEqual(dimensions.client + 1);
}


export async function assertMinutesHandle(page: Page, width: number) {
    const surface = page.getByTestId('minutes-blocknote');
    await expect(surface.locator('.bn-editor')).toBeVisible();
    await waitForFonts(page);

    await surface.locator('.bn-block-content').first().hover();
    const handle = surface.locator('.bn-side-menu');
    if (width >= 640) {
      await expect(handle).toBeVisible();
      const [h, area] = await Promise.all([handle.boundingBox(), surface.boundingBox()]);
      expect(h, 'handle box').not.toBeNull();
      expect(area, 'content area box').not.toBeNull();
      // inside the content area (not over the sidebar), and inside the viewport
      expect(h!.x, 'handle left edge').toBeGreaterThanOrEqual(area!.x - 0.5);
      expect(h!.x + h!.width, 'handle right edge').toBeLessThanOrEqual(area!.x + area!.width + 0.5);
      expect(h!.x, 'handle is not clipped at x<0').toBeGreaterThanOrEqual(0);
    } else {
      // Below 640px the hover-only menu is not offered, so nothing can be clipped off the left edge.
      await expect(handle).toBeHidden();
    }

    // Either way: no element of the editor surface starts left of the viewport.
    const worstLeft = await page.evaluate(() =>
      Math.min(
        0,
        ...Array.from(document.querySelectorAll('.minutes-editor *'))
          .filter((el) => getComputedStyle(el).display !== 'none')
          .map((el) => el.getBoundingClientRect().left),
      ),
    );
    expect(worstLeft, 'leftmost editor element').toBeGreaterThanOrEqual(-0.5);
}

export async function assertProjectsDisclosures(page: Page, width: number) {
    const filters = page.getByRole('button', { name: /^Filters/ });
    const more = page.getByRole('button', { name: /^More actions/ });
    await filters.click();
    const filtersRegion = page.getByRole('region', { name: 'Filters' });
    await expect(filtersRegion).toBeVisible();
    await waitForFonts(page);
    const filtersBox = await filtersRegion.boundingBox();
    expect(filtersBox).not.toBeNull();
    expect(filtersBox!.x).toBeGreaterThanOrEqual(0);
    expect(filtersBox!.x + filtersBox!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    await more.click();
    await expect(filters).toHaveAttribute('aria-expanded', 'false');
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    const moreRegion = page.getByRole('region', { name: 'More actions' });
    await expect(moreRegion).toBeVisible();
    const moreBox = await moreRegion.boundingBox();
    expect(moreBox).not.toBeNull();
    expect(moreBox!.x).toBeGreaterThanOrEqual(0);
    expect(moreBox!.x + moreBox!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    await page.keyboard.press('Escape');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(more).toBeFocused();

    await filters.click();
    await page.getByRole('heading', { name: 'Projects', exact: true }).click();
    await expect(filters).toHaveAttribute('aria-expanded', 'false');
    await expect(filters).toBeFocused();
}

export async function assertPageWithinWidth(page: Page, width: number) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

/** A whole money/number figure ("IDR 160.9B", "Rp 160,9 M", "US$3,4 jt", "−$2.5K", "95.6%"). */
const FIGURE_TEXT = /^[−-]?(?:[A-Z]{3}|Rp|US\$|\$|€)?\s?[−-]?[\d.,]+\s?(?:[KMBT]|rb|jt)?%?$/u;

interface Violation { text: string; reason: string }

async function figureViolations(page: Page): Promise<{ violations: Violation[]; measured: number }> {
  return page.evaluate((figureSource) => {
    const figureRe = new RegExp(figureSource, 'u');
    const out: { text: string; reason: string }[] = [];
    let measured = 0;
    const scrollerOwns = (el: Element) => {
      for (let n: Element | null = el.parentElement; n; n = n.parentElement) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll') return true;
      }
      return false;
    };
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('.tabular'))) {
      // Tables (incl. DataTable's phone card branch) show FULL amounts by ruling (OD-MONEY-FMT) and
      // are gated by the table geometry lane, not this KPI-figure gate.
      if (el.closest('table, [role="table"], [role="grid"], [data-testid="dt-card-branch"]')) continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue; // hidden / inline-with-no-box
      let hasFigure = false;
      const text = (el.textContent ?? '').trim().slice(0, 40);
      if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 0.5) {
        out.push({ text, reason: `clipped: scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}` });
      }
      // Oracle 3: `break-words` lets a too-long figure wrap instead of overflowing, which oracle 1
      // cannot see — so every whole-figure text node must lay out on a single line.
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const figureText = (node.textContent ?? '').trim();
        if (!figureRe.test(figureText)) continue;
        hasFigure = true;
        const range = document.createRange();
        range.selectNodeContents(node);
        const tops = new Set(Array.from(range.getClientRects()).filter((r) => r.width > 0).map((r) => Math.round(r.top)));
        if (tops.size > 1) out.push({ text: figureText, reason: `wraps mid-number across ${tops.size} lines` });
      }
      if (hasFigure) measured += 1;
      if (scrollerOwns(el)) continue;
      const card = el.parentElement?.closest<HTMLElement>('[class*="rounded-lg"][class*="border"], [class*="rounded-md"][class*="border"]');
      if (card) {
        const c = card.getBoundingClientRect();
        if (box.right > c.right + 0.5 || box.left < c.left - 0.5) {
          out.push({ text, reason: `crosses its card: box ${Math.round(box.left)}-${Math.round(box.right)} vs card ${Math.round(c.left)}-${Math.round(c.right)}` });
        }
      }
    }
    return { violations: out, measured };
  }, FIGURE_TEXT.source);
}

export async function expectFiguresContained(page: Page, label: string) {
  await waitForFonts(page);
  const { violations, measured } = await figureViolations(page);
  expect(measured, `${label}: at least one eligible figure is measured`).toBeGreaterThan(0);
  expect(violations, `${label}: every figure fits its own box and its card`).toEqual([]);
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(overflow.scroll, `${label}: no horizontal page overflow`).toBeLessThanOrEqual(overflow.client);
}


function isInvisible(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === 'transparent' || v === 'rgba(0, 0, 0, 0)') return true;
  // explicit zero alpha in any color function: `... / 0)` or trailing `, 0)`.
  if (/\/\s*0\s*\)$/.test(v)) return true;
  if (/,\s*0\s*\)$/.test(v)) return true;
  return false;
}

/**
 * Paint a 1px swatch of the given CSS color on a canvas and read back the
 * actual RGB the browser rasterizes — format-agnostic (rgb/oklab/color-mix).
 * Lets us assert the *hue* of `text-primary` without parsing every color space.
 */
async function rasterize(
  page: import('@playwright/test').Page,
  cssColor: string
): Promise<[number, number, number, number]> {
  return page.evaluate((color) => {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a];
  }, cssColor);
}


export async function assertDashboardPaintAndDesktopAccount(page: Page) {
  // --- Active nav item: bg-primary/10 + text-primary must actually render. ---
  const activeNav = page
    .locator('nav[aria-label="Primary navigation"] a[aria-current="page"]')
    .first();
  await expect(activeNav).toBeVisible();

  const navStyle = await activeNav.evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, color: s.color };
  });

  // The bg-primary/10 wash must paint a non-transparent tint (not rgba(0,0,0,0),
  // not the discarded `hsl(... / <alpha-value>)` which falls back to no paint).
  expect(
    isInvisible(navStyle.bg),
    `active nav background should be a visible tint, got ${navStyle.bg}`
  ).toBe(false);

  // text-primary must be the brand blue (#3b82f6-ish: blue-dominant), NOT the
  // near-black foreground hsl(240 10% 3.9%) ≈ rgb(9,9,11). Rasterize to compare
  // hue regardless of the computed color space the browser reports.
  const [r, g, b] = await rasterize(page, navStyle.color);
  expect(b, `active nav text should be blue-dominant, got ${navStyle.color}`).toBeGreaterThan(150);
  expect(b, `active nav text blue channel should exceed red, got ${navStyle.color}`).toBeGreaterThan(r);
  expect(b, `active nav text blue channel should exceed green, got ${navStyle.color}`).toBeGreaterThan(g);

  // --- ⌘K command palette: the pre-selected option carries bg-primary/10. ---
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  const selected = page.locator('[role="option"][aria-selected="true"]').first();
  await expect(selected).toBeVisible();
  const selBg = await selected.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(
    isInvisible(selBg),
    `⌘K selected option should show the bg-primary/10 highlight, got ${selBg}`
  ).toBe(false);
  await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /account menu/i }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await waitForFonts(page);
    const desktopBox = await menu.boundingBox();
    expect(desktopBox).not.toBeNull();
    expect(desktopBox!.x).toBeGreaterThanOrEqual(-1);
    expect(desktopBox!.x + desktopBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);

    for (const item of await menu.locator('[role="menuitem"], [role="menuitemradio"]').all()) {
      await expect(item).toBeVisible();
      const itemBox = await item.boundingBox();
      expect(itemBox).not.toBeNull();
      expect(itemBox!.x + itemBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    }
    await page.keyboard.press('Shift+Tab');
    await expect(menu).toHaveCount(0);
    await expect(page.getByRole('button', { name: /notifications/i })).toBeFocused();
    await page.getByRole('button', { name: /account menu/i }).click();
    await page.keyboard.press('Tab');
    await expect(menu).toHaveCount(0);
    await expect(page.locator('main :focus')).toHaveCount(1);
}

export async function expectMoneyFits(tile: Locator, locator: Locator, shortValue: string, exactValue: string) {
  await expect(locator).toHaveText(shortValue);
  // A7 (RD-S1): the short value span carries the title, so AT reads the amount once.
  await expect(locator, 'the exact amount is the figure title').toHaveAttribute('title', exactValue);
  const amountMetrics = await locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      left: box.left,
      right: box.right,
    };
  });
  const containerMetrics = await tile.evaluate((container) => {
    const containerBox = container.getBoundingClientRect();
    const containerStyle = getComputedStyle(container);
    return {
      contentLeft: containerBox.left + Number.parseFloat(containerStyle.paddingLeft),
      contentRight: containerBox.right - Number.parseFloat(containerStyle.paddingRight),
    };
  });
  const metrics = { ...amountMetrics, ...containerMetrics };

  expect(metrics.scrollWidth, 'the complete formatted amount fits within its own rendered box')
    .toBeLessThanOrEqual(metrics.clientWidth);
  expect(metrics.left, 'the formatted amount starts inside its tile content edge')
    .toBeGreaterThanOrEqual(metrics.contentLeft - 0.5);
  expect(metrics.right, 'the formatted amount box stays inside its tile content edge')
    .toBeLessThanOrEqual(metrics.contentRight + 0.5);
}


export async function assertShortAccountMenu(page: Page) {
  {
    await page.getByRole('button', { name: /account menu/i }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await waitForFonts(page);
    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.x).toBeGreaterThanOrEqual(-1);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(391);
    expect(menuBox!.y).toBeGreaterThanOrEqual(-1);
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(361);

    // Eligibility is an org-scoped async read; wait for its real resolved state.
    await expect(menu.getByText('View as role')).toBeVisible({ timeout: 15_000 });

    // The popup scrolls internally when height-constrained (scrollHeight > clientHeight).
    const overflow = await menu.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight);

    // Every action, including conditional Help and all preview roles, is reachable.
    const actions = await menu.locator('[role="menuitem"], [role="menuitemradio"]').all();
    expect(actions.length).toBeGreaterThanOrEqual(8);
    for (const item of actions) {
      await item.scrollIntoViewIfNeeded();
      await expect(item).toBeVisible();
      const itemBox = await item.boundingBox();
      expect(itemBox).not.toBeNull();
      expect(itemBox!.x).toBeGreaterThanOrEqual(menuBox!.x - 1);
      expect(itemBox!.x + itemBox!.width).toBeLessThanOrEqual(menuBox!.x + menuBox!.width + 1);
    }
  }
  await page.keyboard.press('Escape');
  {
    const trigger = page.getByRole('button', { name: /account menu/i });
    const original = await trigger.boundingBox();
    await trigger.click();
    await page.getByRole('menuitemradio', { name: 'Larger' }).click();
    const enlarged = await trigger.boundingBox();
    expect(enlarged!.height / original!.height).toBeCloseTo(1.25, 1);
    const menu = page.getByRole('menu');
    const box = await menu.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(box!.y + box!.height).toBeLessThanOrEqual(360);
    await menu.getByRole('menuitemradio', { name: 'Default' }).click();
  }
}

export async function assertProjectsTableLayout(page: Page) {
  {
    // Guard against measuring an empty shell: the desktop table branch, with data rows, must be up.
    const scroller = page.getByTestId('dt-table-branch');
    await expect(scroller).toBeVisible({ timeout: 20_000 });
    const table = scroller.locator('table');
    await expect(table.locator('tbody tr').first()).toBeVisible({ timeout: 20_000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await waitForFonts(page);

    const rows = table.locator('tbody tr');
    let verifiedCustomer = false;
    for (let index = 0; index < await rows.count(); index += 1) {
      const cells = rows.nth(index).locator('td');
      const customer = cells.nth(0).locator('a').first();
      const customerName = (await customer.textContent())?.trim() ?? '';
      if (customerName.length < 12 || !(await customer.isVisible())) continue;
      const fitsWithoutEllipsis = await customer.evaluate((element) => {
        // The customer name sits on the project cell's second line: it must end inside the cell (not clipped).
        const range = document.createRange();
        range.selectNodeContents(element);
        const text = range.getBoundingClientRect();
        const cell = element.closest('td')!.getBoundingClientRect();
        return text.right <= cell.right && element.scrollWidth <= element.clientWidth + 1;
      });
      expect(fitsWithoutEllipsis, `customer name "${customerName}" should be visible without truncation`).toBe(true);
      verifiedCustomer = true;
      break;
    }
    expect(verifiedCustomer, 'a customer name of at least 12 characters should be rendered in the table').toBe(true);

    const pmAvatar = table.getByRole('img').first();
    await expect(pmAvatar).toBeVisible();
    const accessiblePmName = await pmAvatar.getAttribute('aria-label');
    expect(accessiblePmName?.trim().length).toBeGreaterThan(0);
    await expect(pmAvatar).toHaveAccessibleName(/\s/);
    await expect(pmAvatar).toHaveAttribute('title', accessiblePmName!);

    for (const header of ['Project', 'PM', 'Status', 'Contract', 'Actual']) {
      await expect(table.getByRole('columnheader', { name: header, exact: true }),
        `core Projects column "${header}" should be visible at 1440px`).toBeVisible();
    }
    await expect(page.getByRole('button', { name: /optional columns/i })).toHaveCount(0);
    for (const header of ['Progress', 'Budget used']) {
      await expect(table.getByRole('columnheader', { name: header, exact: true }),
        `Projects column "${header}" should be visible when its data exists`).toBeVisible();
    }
    await expect(table.getByRole('columnheader', { name: 'Action', exact: true })).toHaveCount(0);

    const { tableWidth, tableScrollWidth, scrollerClientWidth, scrollerScrollWidth } =
      await scroller.evaluate((element) => {
        const actualTable = element.querySelector('table');
        if (!actualTable) throw new Error('DataTable desktop branch has no table');
        return {
          tableWidth: Math.ceil(actualTable.getBoundingClientRect().width),
          tableScrollWidth: actualTable.scrollWidth,
          scrollerClientWidth: element.clientWidth,
          scrollerScrollWidth: element.scrollWidth,
        };
      });
    expect(
      tableWidth,
      `Projects table width ${tableWidth}px exceeds its overflow scroller ${scrollerClientWidth}px`,
    ).toBeLessThanOrEqual(scrollerClientWidth);
    expect(
      tableScrollWidth,
      `Projects table scrollWidth ${tableScrollWidth}px exceeds its overflow scroller ${scrollerClientWidth}px`,
    ).toBeLessThanOrEqual(scrollerClientWidth);
    expect(
      scrollerScrollWidth,
      `Projects table scroller scrollWidth ${scrollerScrollWidth}px exceeds clientWidth ${scrollerClientWidth}px`,
    ).toBeLessThanOrEqual(scrollerClientWidth);

    const action = table.getByRole('button', { name: 'Row actions' }).first();
    const actionBounds = await action.boundingBox();
    const scrollerBounds = await scroller.boundingBox();
    expect(actionBounds, 'Projects row menu should be rendered').not.toBeNull();
    expect(scrollerBounds, 'Projects table viewport should be rendered').not.toBeNull();
    expect(actionBounds!.x).toBeGreaterThanOrEqual(scrollerBounds!.x);
    expect(actionBounds!.x + actionBounds!.width).toBeLessThanOrEqual(scrollerBounds!.x + scrollerBounds!.width);

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      scrollWidth,
      `page scrolls sideways on /projects table view: scrollWidth ${scrollWidth} > clientWidth ${clientWidth}`,
    ).toBeLessThanOrEqual(clientWidth);
  }
  const toolbar = page.getByTestId('list-page-toolbar');
  await expect(toolbar).toBeVisible();
  const toolbarBox = await toolbar.boundingBox();
  expect(toolbarBox).not.toBeNull();
  // Projects controls may use two compact rows, but must never grow into the old three-row stack.
  expect(toolbarBox!.height).toBeLessThanOrEqual(120);
  const toolbarRows = await toolbar.evaluate((element) => new Set(Array.from(element.children)
    .filter((child) => getComputedStyle(child).gridRowEnd !== 'span 2')
    .map((child) => Math.round(child.getBoundingClientRect().top))).size);
  expect(toolbarRows).toBeLessThanOrEqual(2);
  const toolbarDimensions = await toolbar.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
  expect(toolbarDimensions.scrollWidth).toBeLessThanOrEqual(toolbarDimensions.clientWidth);
  const desktopStatusScroll = page.getByTestId('status-filter-scroll');
  const desktopStatusBox = await desktopStatusScroll.boundingBox();
  const desktopAtRiskBox = await desktopStatusScroll.getByRole('tab', { name: 'At risk', exact: true }).boundingBox();
  expect(desktopStatusBox).not.toBeNull();
  expect(desktopAtRiskBox).not.toBeNull();
  expect(desktopAtRiskBox!.x).toBeGreaterThanOrEqual(desktopStatusBox!.x - 1);
  expect(desktopAtRiskBox!.x + desktopAtRiskBox!.width).toBeLessThanOrEqual(desktopStatusBox!.x + desktopStatusBox!.width + 1);

  const scroller = page.getByTestId('dt-table-branch');
  const actualHeader = scroller.getByRole('columnheader', { name: /Actual/ });
  const progressHeader = scroller.getByRole('columnheader', { name: 'Progress', exact: true });
  const actualText = await actualHeader.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element.firstChild!);
    const box = range.getBoundingClientRect();
    return { left: box.left, right: box.right };
  });
  const progressText = await progressHeader.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element.firstChild!);
    const box = range.getBoundingClientRect();
    return { left: box.left, right: box.right };
  });
  expect(progressText.left - actualText.right).toBeGreaterThanOrEqual(12);
  await expect(scroller).toBeVisible({ timeout: 20_000 });
  await expect(scroller.locator('tbody tr').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await waitForFonts(page);

  const scrollerBox = await scroller.boundingBox();
  expect(scrollerBox).not.toBeNull();
  const projectHeader = scroller.getByRole('columnheader', { name: 'Project', exact: true });
  const handle = page.getByRole('separator', { name: 'Resize Project column' });
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    const headerBox = await projectHeader.boundingBox();
    const indicator = handle.locator('.datatable-resize-indicator');
    const indicatorBox = await indicator.boundingBox();
    expect(headerBox).not.toBeNull();
    expect(indicatorBox).not.toBeNull();
    expect(indicatorBox!.width).toBe(2);
    expect(Math.abs(indicatorBox!.x + indicatorBox!.width / 2 - (headerBox!.x + headerBox!.width))).toBeLessThanOrEqual(1);
    await projectHeader.hover();
    await expect.poll(() => handle.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const projectCell = scroller.locator('tbody tr').first().locator('td').first();
  for (const element of [projectHeader, projectCell]) {
    const box = await element.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(scrollerBox!.x - 1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(scrollerBox!.x + scrollerBox!.width + 1);
  }
  const rowActions = page.getByRole('button', { name: 'Row actions' }).first();
  await expect(rowActions).toBeVisible();
  const actionsBox = await rowActions.boundingBox();
  expect(actionsBox).not.toBeNull();
  expect(actionsBox!.x + actionsBox!.width).toBeLessThanOrEqual(scrollerBox!.x + scrollerBox!.width + 1);

  await expect(handle).toBeVisible();
  const before = await scroller.getByRole('columnheader', { name: 'Project', exact: true }).evaluate((el) => el.getBoundingClientRect().width);
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 64, box!.y + box!.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => scroller.getByRole('columnheader', { name: 'Project', exact: true }).evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(before + 40);
  let dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('dt-card-branch')).toBeVisible();
  await expect(page.getByTestId('dt-table-branch')).toHaveCount(0);
  const mobileToolbar = page.getByTestId('projects-mobile-toolbar');
  const atRiskTab = mobileToolbar.getByRole('tab', { name: 'At risk', exact: true });
  const boardTab = mobileToolbar.getByRole('tab', { name: 'Board', exact: true });
  await atRiskTab.scrollIntoViewIfNeeded();
  await boardTab.scrollIntoViewIfNeeded();
  for (const [tab, scrollTestId] of [[atRiskTab, 'status-filter-scroll'], [boardTab, 'projects-mobile-view-scroll']] as const) {
    const scrollport = mobileToolbar.getByTestId(scrollTestId);
    const portBox = await scrollport.boundingBox();
    const tabBox = await tab.boundingBox();
    expect(portBox).not.toBeNull();
    expect(tabBox).not.toBeNull();
    expect(tabBox!.x).toBeGreaterThanOrEqual(portBox!.x - 1);
    expect(tabBox!.x + tabBox!.width).toBeLessThanOrEqual(portBox!.x + portBox!.width + 1);
  }
  dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

export async function assertCompaniesSearchFits(page: Page) {
    // The toolbar (and its search) only render after the loading state clears.
    const search = page.getByRole('searchbox', { name: /Search companies/i });
    await expect(search).toBeVisible({ timeout: 10_000 });
    await waitForFonts(page);

    const overflow = await page.evaluate(() => {
      const main = document.querySelector('main')!;
      const input = document.querySelector('input[aria-label="Search companies"]')!;
      const box = input.getBoundingClientRect();
      return {
        mainWidth: Math.round(main.getBoundingClientRect().width),
        vw: window.innerWidth,
        searchRight: Math.round(box.right),
        searchLeft: Math.round(box.left),
      };
    });
    // GOAL ORACLE: main does not exceed the viewport, and the search sits fully
    // inside it (no horizontal clipping of the right-edge control).
    expect(overflow.mainWidth).toBeLessThanOrEqual(overflow.vw + 1);
    expect(overflow.searchRight).toBeLessThanOrEqual(overflow.vw);
    expect(overflow.searchLeft).toBeGreaterThanOrEqual(0);
}

export async function assertMinutesWithinViewport(page: Page, scheme: string) {
    // AC-MTG-021: no element's right edge exceeds the viewport.
    const bleed = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      return {
        scroll: document.documentElement.scrollWidth - vw,
        worst: Math.max(
          0,
          ...Array.from(document.querySelectorAll('.minutes-editor *')).map(
            (el) => el.getBoundingClientRect().right - vw,
          ),
        ),
      };
    });
    expect(bleed.scroll, `${scheme}: page scroll width`).toBeLessThanOrEqual(0);
    expect(bleed.worst, `${scheme}: widest editor element`).toBeLessThanOrEqual(1);
}
