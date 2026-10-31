import { expect, type Page, type Locator } from '@playwright/test';
import { signIn, waitForFonts } from '../helpers';

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

// ── Phase 2 (#1529) consolidated route oracles — ported verbatim from the single-purpose geometry
// specs they replace, so each route's layout sweep pays one page load per viewport/theme instead of
// one page load per assertion. ──────────────────────────────────────────────────────────────

/** AC-SBC-001 (#696): every Sales board card's money row stays inside the card's inner right edge,
 *  and no column's card list scrolls sideways. Assumes /sales?view=kanban is loaded and settled. */
export async function assertSalesBoardCards(page: Page) {
  const { cardCount, cardOverflows, listScroll } = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="project-card"]'));
    const cardOverflows: { card: string; overflowing: { el: string; right: number; innerRight: number }[] }[] = [];
    const lists = new Set<HTMLElement>();
    for (const card of cards) {
      const cs = getComputedStyle(card);
      const rect = card.getBoundingClientRect();
      const innerRight = rect.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
      const overflowing: { el: string; right: number; innerRight: number }[] = [];
      card.querySelectorAll<HTMLElement>('*').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        if (r.right > innerRight + 1) {
          overflowing.push({
            el: `${el.tagName.toLowerCase()}:${(el.textContent ?? '').trim().slice(0, 24)}`,
            right: Math.round(r.right * 10) / 10,
            innerRight: Math.round(innerRight * 10) / 10,
          });
        }
      });
      cardOverflows.push({ card: card.getAttribute('aria-label') ?? '?', overflowing });
      if (card.parentElement) lists.add(card.parentElement);
    }
    const listScroll = Array.from(lists).map((l) => ({ scrollWidth: l.scrollWidth, clientWidth: l.clientWidth }));
    return { cardCount: cards.length, cardOverflows, listScroll };
  });
  expect(cardCount, 'expected seeded deal cards on the board').toBeGreaterThanOrEqual(5);

  const bad = cardOverflows.filter((c) => c.overflowing.length > 0);
  expect(bad, `card descendants end past the card's inner right edge (+1px): ${JSON.stringify(bad.slice(0, 3))}`).toEqual([]);

  const scrolling = listScroll.filter((l) => l.scrollWidth > l.clientWidth);
  expect(scrolling, `a column card list scrolls sideways: ${JSON.stringify(scrolling.slice(0, 3))}`).toEqual([]);
}

const FUNNEL_VIEWPORT_WIDTH = 768;

/** AC-SFA-001: every funnel stage amount stays inside its own stage and the page never pans at the
 *  768px breakpoint. Probes the layout with a representative long IDR amount (the seed is USD). */
export async function assertFunnelAmountsContained(page: Page) {
  await expect(page.getByRole('region', { name: 'Pipeline summary' })).toBeVisible();
  await expect(page.locator('[data-funnel-stage]')).toHaveCount(5);
  await waitForFonts(page);

  // At least one stage must show a currency symbol plus a grouped thousands separator (not a
  // compact form), then the layout is probed against a noncompact long IDR amount.
  const amounts = await page.locator('[data-funnel-stage-amount]').allTextContents();
  const LONG_AMOUNT_SHAPE = /[\p{Sc}]\s?\d{1,3}(?:[.,]\d{3})+/u;
  expect(
    amounts.some((text) => LONG_AMOUNT_SHAPE.test(text)),
    `expected a grouped long amount among stage values, got: ${amounts.join(' | ')}`,
  ).toBe(true);

  await page.evaluate(() => {
    const idr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(1_250_000_000_000);
    document.querySelectorAll('[data-funnel-stage-amount]').forEach((el) => {
      el.textContent = idr;
    });
  });

  const containment = await page.evaluate(() => {
    const results: { i: number; stage: DOMRect | null; amount: DOMRect | null }[] = [];
    document.querySelectorAll('[data-funnel-stage]').forEach((stageEl, i) => {
      const amount = stageEl.querySelector('[data-funnel-stage-amount]');
      results.push({
        i,
        stage: stageEl.getBoundingClientRect().toJSON() as unknown as DOMRect,
        amount: amount ? (amount.getBoundingClientRect().toJSON() as unknown as DOMRect) : null,
      });
    });
    return results;
  });

  for (const { i, stage, amount } of containment) {
    expect(stage, `stage ${i} box missing`).not.toBeNull();
    expect(amount, `stage ${i} amount box missing`).not.toBeNull();
    expect(amount!.x, `stage ${i} amount starts before its stage`).toBeGreaterThanOrEqual(stage!.x - 1);
    expect(
      amount!.x + amount!.width,
      `stage ${i} amount overflows its stage: amount.right=${(amount!.x + amount!.width).toFixed(1)} > stage.right=${(stage!.x + stage!.width).toFixed(1)}`,
    ).toBeLessThanOrEqual(stage!.x + stage!.width + 1);
  }

  const pageScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(pageScrollWidth).toBeLessThanOrEqual(FUNNEL_VIEWPORT_WIDTH + 2);
}

/** AC-SFA-006: every stage progress bar keeps an 8px gap below its weighted line and all bar tops
 *  align across the row (1px rendering tolerance). */
export async function assertFunnelBarGapAndAlignment(page: Page) {
  await expect(page.locator('[data-funnel-stage]')).toHaveCount(5);
  await waitForFonts(page);

  const bars = await page.evaluate(() => {
    const results: { i: number; weightedBottom: number; barTop: number }[] = [];
    document.querySelectorAll('[data-funnel-stage]').forEach((stageEl, i) => {
      const weighted = stageEl.querySelector('[data-funnel-stage-weighted]');
      const bar = stageEl.querySelector('[data-funnel-stage-bar]');
      if (!weighted || !bar) return;
      results.push({
        i,
        weightedBottom: weighted.getBoundingClientRect().bottom,
        barTop: bar.getBoundingClientRect().top,
      });
    });
    return results;
  });

  expect(bars, 'expected a weighted line + progress bar on every one of the 5 stages').toHaveLength(5);

  for (const { i, weightedBottom, barTop } of bars) {
    expect(
      barTop - weightedBottom,
      `stage ${i} bar sits closer than 8px below its weighted line: gap=${(barTop - weightedBottom).toFixed(1)}px`,
    ).toBeGreaterThanOrEqual(7);
  }

  const barTops = bars.map((b) => b.barTop);
  const firstTop = barTops[0];
  for (const [i, top] of barTops.entries()) {
    expect(
      Math.abs(top - firstTop),
      `stage ${i} bar top (${top.toFixed(1)}) is not aligned with stage 0's bar top (${firstTop.toFixed(1)})`,
    ).toBeLessThanOrEqual(1);
  }
}

/** AC-SFA-007: a focused stage's visible focus ring lies inside the funnel viewport, never clipped
 *  by the scroll area's own overflow. Measures the ring from computed style. */
export async function assertFunnelFocusRingInsideViewport(page: Page) {
  await expect(page.locator('[data-funnel-stage]')).toHaveCount(5);
  await waitForFonts(page);

  const stages = page.locator('[data-funnel-stage]');
  for (const index of [0, 2]) {
    // Native `.focus()` dispatches the same focus event a real Tab keypress produces and reliably
    // matches `:focus-visible` in Chromium (no prior pointer interaction targeted the element).
    await stages.nth(index).focus();

    const result = await page.evaluate((i) => {
      const scrollArea = document.querySelector('[data-testid="funnel-scroll-area"]')!;
      const stageEl = document.querySelectorAll('[data-funnel-stage]')[i] as HTMLElement;
      const cs = getComputedStyle(stageEl);
      const outlineWidth = parseFloat(cs.outlineWidth) || 0;
      const outlineOffset = parseFloat(cs.outlineOffset) || 0;
      const grow = outlineOffset + outlineWidth;
      const stageRect = stageEl.getBoundingClientRect();
      return {
        outlineStyle: cs.outlineStyle,
        outlineWidth,
        ring: {
          top: stageRect.top - grow,
          bottom: stageRect.bottom + grow,
          left: stageRect.left - grow,
          right: stageRect.right + grow,
        },
        scrollRect: scrollArea.getBoundingClientRect().toJSON() as unknown as DOMRect,
      };
    }, index);

    expect(result.outlineStyle, `stage ${index} is not showing a visible focus outline`).not.toBe('none');
    expect(result.outlineWidth, `stage ${index} has a 0px outline width while focused`).toBeGreaterThan(0);

    const { ring, scrollRect } = result;
    expect(ring.top, `stage ${index} focus ring top is clipped above the funnel viewport`)
      .toBeGreaterThanOrEqual(scrollRect.top - 1);
    expect(ring.bottom, `stage ${index} focus ring bottom is clipped below the funnel viewport`)
      .toBeLessThanOrEqual(scrollRect.top + scrollRect.height + 1);
    expect(ring.left, `stage ${index} focus ring left is clipped left of the funnel viewport`)
      .toBeGreaterThanOrEqual(scrollRect.left - 1);
    expect(ring.right, `stage ${index} focus ring right is clipped right of the funnel viewport`)
      .toBeLessThanOrEqual(scrollRect.left + scrollRect.width + 1);
  }
}

// ── AC-TBL-STICKY-001: Sales Invoices row-actions sticky geometry. ───────────────────────────

export const STICKY_EPSILON = 1.5;

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

export interface StickyGeometry {
  scroller: { left: number; right: number; top: number; bottom: number; clientWidth: number; scrollWidth: number };
  stickyTd: { left: number; right: number; top: number; bottom: number; width: number } | null;
  stickyTh: { left: number; right: number; top: number; bottom: number; width: number } | null;
  triggers: { left: number; right: number; top: number; bottom: number }[];
}

export async function measureSticky(page: Page): Promise<StickyGeometry> {
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
export async function expectSeamClean(page: Page, scroller: { right: number; top: number; bottom: number }, mode: 'light' | 'dark') {
  const bandBottom = Math.min(scroller.top + 92, scroller.bottom - 2);
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
export async function expectHairlineVisible(page: Page, tdLeft: number, scroller: { top: number; bottom: number }, mode: 'light' | 'dark') {
  const bandBottom = Math.min(scroller.top + 92, scroller.bottom - 2);
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

/** Flip the theme AFTER mount: index.html's no-flash script seeds the class from localStorage on
 *  every load and would wipe a pre-goto class. */
export async function setDarkTheme(page: Page, dark: boolean) {
  await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);
  expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(dark);
}

/** AC-1201: the persistent rail shows at desktop with nav links and no hamburger; collapsed at
 *  mobile where the hamburger opens a drawer copy of the rail. Installs the English-profile read
 *  rewrite BEFORE sign-in so the DOM landmark labels never depend on a persisted seed locale. */
export async function assertResponsiveRailAndDrawer(page: Page, email = 'exec@acme.test') {
  // The DOM landmark labels below are English; avoid dependence on a persisted seed locale.
  await page.route('**/rest/v1/profiles?*', async (route) => {
    const url = route.request().url();
    if (route.request().method() !== 'GET' || !/[?&]id=eq\./.test(url)) return route.fallback();
    const response = await route.fetch();
    const body: unknown = await response.json();
    if (body && !Array.isArray(body) && typeof body === 'object' && 'locale' in body) {
      return route.fulfill({ response, json: { ...body, locale: 'en', number_locale: 'en-US' } });
    }
    return route.fulfill({ response, json: body });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, email);
  await page.goto('/');

  // --- Desktop: persistent grid-area rail is visible, no hamburger. ---
  const persistent = page.locator('.rail-persistent');
  await expect(persistent).toBeVisible();
  const desktopNavCount = await persistent.locator('nav a').count();
  expect(desktopNavCount).toBeGreaterThan(0);
  await expect(page.locator('.mobile-rail-toggle')).toBeHidden();

  // --- Mobile: persistent rail collapses, hamburger appears. ---
  await page.setViewportSize({ width: 560, height: 800 });
  await expect(persistent).toBeHidden();
  const hamburger = page.locator('.mobile-rail-toggle');
  await expect(hamburger).toBeVisible();

  // Opening the hamburger reveals a drawer copy of the rail WITH nav links.
  await hamburger.click();
  const drawerNav = page.locator('nav[aria-label="Primary navigation"]').nth(1);
  await expect(drawerNav.getByRole('link', { name: /Approvals/ })).toBeVisible();
  const drawerNavCount = await page.evaluate(() => {
    const navs = Array.from(document.querySelectorAll('nav[aria-label="Primary navigation"]'));
    const drawer = navs.find((n) => !n.closest('.rail-persistent'));
    return drawer ? drawer.querySelectorAll('a').length : 0;
  });
  expect(drawerNavCount).toBeGreaterThan(0);
}

/** UX-001: every persistent-rail nav link — Approvals included — stays inside the rail box and the
 *  800px desktop viewport height. */
export async function assertRailNavWithinViewport(page: Page, height: number) {
  const nav = page.locator('.rail-persistent nav[aria-label="Primary navigation"]');
  const approvals = nav.getByRole('link', { name: /Approvals/ });
  const sales = nav.getByRole('link', { name: 'Sales Pipeline' });
  await expect(approvals).toBeVisible();
  await expect(sales).toBeAttached();
  await waitForFonts(page);

  const railBox = await nav.boundingBox();
  const approvalsBox = await approvals.boundingBox();
  expect(railBox).not.toBeNull();
  expect(approvalsBox).not.toBeNull();
  expect(approvalsBox!.y).toBeGreaterThanOrEqual(railBox!.y);
  expect(approvalsBox!.y + approvalsBox!.height).toBeLessThanOrEqual(railBox!.y + railBox!.height);
  expect(approvalsBox!.y + approvalsBox!.height).toBeLessThanOrEqual(height);
}

// ── AC-ADMIA-005: Administration destinations reachability + overflow. ───────────────────────

export const ADMINISTRATION_ORGANIZATION_SECTIONS = [
  { name: 'Users', url: '/administration/users', testid: 'administration-panel-users', heading: 'Users' },
  {
    name: 'Organization integrations',
    url: '/administration/integrations',
    testid: 'administration-panel-integrations',
    heading: 'Organization integrations',
  },
  {
    name: 'Accounting setup',
    url: '/administration/accounting',
    testid: 'administration-panel-accounting',
    heading: 'Accounting setup',
  },
  { name: 'Credits', url: '/administration/credits', testid: 'administration-panel-credits', heading: 'Credits' },
] as const;

export const ADMINISTRATION_OPERATOR_SECTIONS = [
  ...ADMINISTRATION_ORGANIZATION_SECTIONS,
  { name: 'Usage', url: '/administration/usage', testid: 'administration-panel-usage', heading: 'Usage' },
  { name: 'Features', url: '/administration/features', testid: 'administration-panel-features', heading: 'Features' },
] as const;

/** Drive every Administration section: the link is reachable and navigates, the selected panel is
 *  visible, phone controls sit in the first scroll region with 44px touch targets, and neither the
 *  elements nor the page overflow horizontally. */
export async function driveAdministrationSections(
  page: Page,
  vw: number,
  height: number,
  sections: ReadonlyArray<(typeof ADMINISTRATION_OPERATOR_SECTIONS)[number]> = ADMINISTRATION_ORGANIZATION_SECTIONS,
) {
  const sectionNav = page.getByRole('navigation', { name: 'Administration sections' });
  for (const s of sections) {
    const link = sectionNav.getByRole('link', { name: s.name });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${s.url}$`));
    await expect(page.getByTestId(s.testid)).toBeVisible();

    const heading = page.getByRole('heading', { level: 1, name: 'Administration' });
    const panelHeading = page.getByRole('heading', { level: 2, name: s.heading });
    await expect(heading).toBeVisible();
    await expect(panelHeading).toBeVisible();
    await waitForFonts(page);
    if (vw < 600) {
      for (const el of [heading, sectionNav.getByRole('link', { name: s.name }), panelHeading]) {
        const box = await el.boundingBox();
        expect(box, `${s.name} control should have a layout box at ${vw}px`).not.toBeNull();
        expect(
          box!.y,
          `${s.name} control must sit within the first scroll region at ${vw}px — its top (${Math.round(box!.y)}px) is below the ${height}px viewport.`,
        ).toBeLessThan(height);
      }
      const linkBox = await link.boundingBox();
      expect(linkBox, `${s.name} link should have a layout box at ${vw}px`).not.toBeNull();
      expect(
        linkBox!.height,
        `${s.name} link must offer a 44px-tall phone touch target, without overlap from adjacent links`,
      ).toBeGreaterThanOrEqual(44);
    }

    await assertNoBleed(page, vw);
  }
}

/** AC-PVT-001 (#715): at 390px the Procurement view switch has a real in-viewport box, the page
 *  does not pan, and choosing Board then Table changes what the page renders. */
export async function assertProcurementViewToggle(page: Page) {
  const toggle = page.getByRole('tablist', { name: 'Procurement view' });
  await expect(toggle).toBeVisible({ timeout: 60_000 });
  await waitForFonts(page);
  const box = await toggle.boundingBox();
  expect(box, 'the view tablist has a rendered box').not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390 + 1);

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, 'the page must not pan sideways at 390px').toBeLessThanOrEqual(overflow.clientWidth);

  const boardStage = page.locator('[data-testid^="prstage-"]').first();
  const tableTab = toggle.getByRole('tab', { name: 'Table' });
  const boardTab = toggle.getByRole('tab', { name: 'Board' });

  await expect(tableTab).toHaveAttribute('aria-selected', 'true');
  await expect(boardStage).toHaveCount(0);

  await boardTab.click();
  await expect(boardTab).toHaveAttribute('aria-selected', 'true');
  await expect(boardStage).toBeVisible();

  await tableTab.click();
  await expect(tableTab).toHaveAttribute('aria-selected', 'true');
  await expect(boardStage).toHaveCount(0);
}

/** AC-BWO-004 (#785): on the project Work orders tab each visible Invoice action is inside its
 *  customer-order card and the customer-orders region, with no sideways scroll on card, region or
 *  page. `names` carries the locale-specific accessible names. */
export async function assertWorkOrderInvoiceContainment(
  page: Page,
  names: { invoice: string; region: string; billableDetail: string },
) {
  const billableWorkOrder = page.getByRole('button', { name: names.billableDetail, exact: true });
  await expect(billableWorkOrder).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: names.invoice }).first()).toBeVisible();
  await waitForFonts(page);

  const orders = page.getByRole('region', { name: names.region });
  await expect(orders).toBeVisible();
  const buttons = orders.getByRole('button', { name: names.invoice, exact: true });
  expect(await buttons.count(), 'expected Invoice on the billable work orders').toBeGreaterThanOrEqual(2);
  const regionBox = await orders.boundingBox();
  expect(regionBox).not.toBeNull();
  const EPSILON = 1;
  for (const button of await buttons.all()) {
    await expect(button).toBeVisible();
    const card = button.locator('xpath=ancestor::article');
    const cardBox = await card.boundingBox();
    const buttonBox = await button.boundingBox();
    expect(cardBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox!.x).toBeGreaterThanOrEqual(cardBox!.x - EPSILON);
    expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + EPSILON);
    expect(cardBox!.x).toBeGreaterThanOrEqual(regionBox!.x - EPSILON);
    expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(regionBox!.x + regionBox!.width + EPSILON);
    const cardOverflow = await card.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(cardOverflow.scroll, 'the work-order card scrolls sideways').toBeLessThanOrEqual(cardOverflow.client);
  }
  const regionOverflow = await orders.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(regionOverflow.scroll, 'the customer-orders region scrolls sideways').toBeLessThanOrEqual(regionOverflow.client);
  const pageOverflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(pageOverflow.scroll, 'the page scrolls sideways').toBeLessThanOrEqual(pageOverflow.client);
}

/** AC-RAM-004 (#688): the LifecycleStepper scroll region's :focus-visible ring is drawn inward, so
 *  its overflow-hidden clip wrapper never slices it. */
export async function assertStepperFocusRingNotClipped(page: Page) {
  const scrollContainer = page.getByTestId('stepper-scroll-container');
  await scrollContainer.focus();

  const result = await page.evaluate(() => {
    const wrapper = document.querySelector('[data-testid="stepper-clip-wrapper"]')!;
    const region = document.querySelector('[data-testid="stepper-scroll-container"]') as HTMLElement;
    const cs = getComputedStyle(region);
    const outlineWidth = parseFloat(cs.outlineWidth) || 0;
    const outlineOffset = parseFloat(cs.outlineOffset) || 0;
    const grow = outlineOffset + outlineWidth;
    const regionRect = region.getBoundingClientRect();
    return {
      outlineStyle: cs.outlineStyle,
      outlineWidth,
      ring: {
        top: regionRect.top - grow,
        bottom: regionRect.bottom + grow,
        left: regionRect.left - grow,
        right: regionRect.right + grow,
      },
      wrapperRect: wrapper.getBoundingClientRect().toJSON() as unknown as DOMRect,
    };
  });

  expect(result.outlineStyle, 'the stepper scroll region shows no visible focus outline when focused').not.toBe('none');
  expect(result.outlineWidth, 'the stepper scroll region has a 0px outline width while focused').toBeGreaterThan(0);

  const { ring, wrapperRect } = result;
  expect(ring.top, `focus ring top (${ring.top.toFixed(1)}) is clipped above the wrapper (${wrapperRect.top.toFixed(1)})`)
    .toBeGreaterThanOrEqual(wrapperRect.top - 1);
  expect(ring.bottom, `focus ring bottom (${ring.bottom.toFixed(1)}) is clipped below the wrapper (${(wrapperRect.top + wrapperRect.height).toFixed(1)})`)
    .toBeLessThanOrEqual(wrapperRect.top + wrapperRect.height + 1);
  expect(ring.left, `focus ring left (${ring.left.toFixed(1)}) is clipped left of the wrapper (${wrapperRect.left.toFixed(1)})`)
    .toBeGreaterThanOrEqual(wrapperRect.left - 1);
  expect(ring.right, `focus ring right (${ring.right.toFixed(1)}) is clipped right of the wrapper (${(wrapperRect.left + wrapperRect.width).toFixed(1)})`)
    .toBeLessThanOrEqual(wrapperRect.left + wrapperRect.width + 1);
}

/** Open the milestone card grid on a project overview (the seeded phase-editor surface). */
export async function openMilestoneCardGrid(page: Page) {
  await page.getByRole('region', { name: 'Phase timeline' })
    .getByRole('button', { name: 'Update phases', exact: true }).click();
  await expect(page.getByTestId('milestone-card-grid')).toBeVisible({ timeout: 20_000 });
  await waitForFonts(page);
}

/** AC-RAM-004: the milestone percentage column never collides with the (possibly long) phase name. */
export async function assertMilestonePctClearOfName(page: Page) {
  const card = page
    .getByTestId('milestone-card-grid')
    .locator('section')
    .filter({ hasText: 'Commissioning & Grid Connection' });
  await expect(card).toBeVisible();
  await waitForFonts(page);

  const nameBox = await card.getByTestId('milestone-phase-name').boundingBox();
  const pctBox = await card.getByTestId('milestone-phase-pct').boundingBox();
  expect(nameBox, 'milestone phase name did not render a bounding box').not.toBeNull();
  expect(pctBox, 'milestone phase percentage did not render a bounding box').not.toBeNull();

  const nameRight = nameBox!.x + nameBox!.width;
  const pctLeft = pctBox!.x;
  const horizontallyClear = nameRight <= pctLeft + 1;
  const nameBottom = nameBox!.y + nameBox!.height;
  const pctTop = pctBox!.y;
  const pctBottom = pctBox!.y + pctBox!.height;
  const verticallyClear = nameBottom <= pctTop + 1 || nameBox!.y >= pctBottom - 1;

  expect(
    horizontallyClear || verticallyClear,
    `phase name box (right=${nameRight.toFixed(1)}, y=${nameBox!.y.toFixed(1)}..${nameBottom.toFixed(1)}) overlaps the percentage box (left=${pctLeft.toFixed(1)}, y=${pctTop.toFixed(1)}..${pctBottom.toFixed(1)})`,
  ).toBe(true);
}

/** AC-RAM-004 round 3: every milestone phase name renders each of its words on a single line — a
 *  word split across two line tops means the browser had to break INSIDE the word. */
export async function assertMilestoneNamesWrapAtWords(page: Page) {
  const grid = page.getByTestId('milestone-card-grid');
  await expect(grid).toBeVisible({ timeout: 20_000 });
  await waitForFonts(page);

  const nameEls = grid.getByTestId('milestone-phase-name');
  const count = await nameEls.count();
  expect(count, 'expected the seeded delivery phases to render as cards').toBeGreaterThan(0);

  for (let i = 0; i < count; i += 1) {
    const nameEl = nameEls.nth(i);
    const result = await nameEl.evaluate((el) => {
      const node = el.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) {
        return { name: el.textContent ?? '', brokenWords: [] as string[] };
      }
      const text = node.textContent ?? '';
      const brokenWords: string[] = [];
      for (const match of text.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index!);
        range.setEnd(node, match.index! + match[0].length);
        const lineTops = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
        if (lineTops.size > 1) brokenWords.push(match[0]);
      }
      return { name: el.textContent ?? '', brokenWords };
    });

    expect(
      result.brokenWords,
      `"${result.name}" broke word(s) [${result.brokenWords.join(', ')}] mid-word — every word must stay on one line`,
    ).toEqual([]);
  }
}

/** AC-RD-HDR-001: the compact project header strip — one details disclosure, every figure inside
 *  its tile (a figure or an em dash, never prose), no horizontal bleed at 1024px. */
export async function assertCompactProjectHeader(page: Page) {
  const moneyPosition = page.getByRole('region', { name: 'Money position' });
  const stages = moneyPosition.locator('dl[aria-label="Contract to payment"] > div');
  await expect(moneyPosition.getByTestId('contract-value-amount')).toBeVisible();
  // Net fewer always-visible elements: the header's own disclosure is gone, the rail owns the codes.
  await expect(page.getByText('More project details', { exact: true })).toHaveCount(0);
  const moreActions = page.locator('summary[aria-label="More actions"]');
  await expect(moreActions).toHaveCount(1);
  await moreActions.click();
  const projectDetails = page.getByRole('button', { name: 'Project details', exact: true });
  await expect(projectDetails).toHaveCount(1);
  await projectDetails.click();
  await expect(page.getByTestId('project-detail-rail')).toBeVisible();
  // No prose in a figure slot: every figure is a money amount, a percentage or an em dash.
  await expect(stages.first()).toBeVisible();
  const count = await stages.count();
  for (let i = 0; i < count; i++) {
    const value = stages.nth(i).locator(':scope > dd.text-right').first();
    const visible = (await value.evaluate((el) => {
      const clone = el.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('.sr-only, button, [data-testid="fx-equivalent"]').forEach((n) => n.remove());
      return clone.textContent ?? '';
    })).trim();
    expect(visible, `tile ${i} value is a figure or omitted when unknown, never prose`)
      .toMatch(/^(|[^A-Za-z]*\d[\d.,%\s]*[^A-Za-z]*|[A-Z$€£]{1,4}\s?[\d.,\s]+)$/);
    const box = await stages.nth(i).evaluate((el) => {
      const stage = el.getBoundingClientRect();
      const v = el.querySelector(':scope > dd.text-right') as HTMLElement;
      const value = v.getBoundingClientRect();
      return { overflow: v.scrollWidth - v.clientWidth, left: value.left, right: value.right, stageLeft: stage.left, stageRight: stage.right, vw: window.innerWidth };
    });
    expect(box.overflow, `tile ${i} figure fits its box`).toBeLessThanOrEqual(1);
    expect(box.left, `tile ${i} figure stays inside its row`).toBeGreaterThanOrEqual(box.stageLeft - 0.5);
    expect(box.right, `tile ${i} figure stays inside its row`).toBeLessThanOrEqual(box.stageRight + 0.5);
    expect(box.stageRight, `tile ${i} stays inside the viewport`).toBeLessThanOrEqual(box.vw + 0.5);
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

/** AC-S24-004: the selected-stage phone list — the stage list, first card and its complete long
 *  amount all render inside a 390px viewport that never pans sideways. */
export async function assertPhonePipelineGeometry(page: Page) {
  const measure = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const pageWidth = document.documentElement.scrollWidth;
    const list = document.querySelector<HTMLElement>('[data-testid="sales-phone-stage-list"]');
    const card = list?.querySelector<HTMLElement>('[data-testid="project-card"]');
    const name = card?.querySelector<HTMLElement>('button');
    const customer = card?.querySelector<HTMLElement>('span.truncate');
    const listBox = list?.getBoundingClientRect();
    const cardBox = card?.getBoundingClientRect();
    const amount = Array.from(card?.querySelectorAll('span') ?? []).find(
      (el) => el.textContent?.replace(/\D/g, '') === '1250000000000',
    );
    const amountBox = amount?.getBoundingClientRect();
    return {
      viewportWidth,
      pageWidth,
      viewportHeight: document.documentElement.clientHeight,
      listBox: listBox ? { left: listBox.left, right: listBox.right, width: listBox.width } : null,
      cardBox: cardBox ? { top: cardBox.top, bottom: cardBox.bottom, left: cardBox.left, right: cardBox.right } : null,
      amountBox: amountBox ? { top: amountBox.top, bottom: amountBox.bottom, left: amountBox.left, right: amountBox.right } : null,
      name: name ? { clientWidth: name.clientWidth, scrollWidth: name.scrollWidth } : null,
      customer: customer ? { clientWidth: customer.clientWidth, scrollWidth: customer.scrollWidth } : null,
    };
  });
  expect(measure.pageWidth, 'the phone document must not pan sideways').toBeLessThanOrEqual(measure.viewportWidth);
  expect(measure.listBox, 'the selected-stage result list has a rendered box').not.toBeNull();
  expect(measure.listBox!.left).toBeGreaterThanOrEqual(0);
  expect(measure.listBox!.right).toBeLessThanOrEqual(measure.viewportWidth + 1);
  expect(measure.cardBox, 'the first phone opportunity is rendered above the fold').not.toBeNull();
  expect(measure.cardBox!.top).toBeGreaterThanOrEqual(0);
  expect(measure.cardBox!.bottom).toBeLessThanOrEqual(measure.viewportHeight);
  expect(measure.amountBox, 'the complete long source-currency amount has a rendered box').not.toBeNull();
  expect(measure.amountBox!.left).toBeGreaterThanOrEqual(measure.cardBox!.left - 1);
  expect(measure.amountBox!.right).toBeLessThanOrEqual(measure.cardBox!.right + 1);
  expect(measure.name?.scrollWidth).toBeLessThanOrEqual(measure.name?.clientWidth ?? 0);
  expect(measure.customer?.scrollWidth).toBeLessThanOrEqual(measure.customer?.clientWidth ?? 0);
}

/** UIP-007: comparative procurement values share one right edge with each other and the Value
 *  column header, set in tabular numerals (1px tolerance). */
export async function assertGroupedProcurementValueAlignment(page: Page) {
  await expect(page.locator('[data-procurement-value]')).toHaveCount(2);
  await waitForFonts(page);
  const edges = await page.locator('[data-procurement-value]').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().right));
  expect(Math.abs(edges[0] - edges[1])).toBeLessThanOrEqual(1);
  const headerEdge = await page.getByTestId('procurement-list-columns').getByText('Value', { exact: true }).evaluate((node) => node.getBoundingClientRect().right);
  expect(Math.abs(headerEdge - edges[0])).toBeLessThanOrEqual(1);
  await expect(page.locator('[data-procurement-value]').first()).toHaveCSS('font-variant-numeric', 'tabular-nums');
}

/** UIP-009: the phone record header stacks the full title above the status chip, the title never
 *  clips, and the page never pans. */
export async function assertRecordHeaderStacksTitleAboveStatus(page: Page, title: string, statusText: string) {
  const header = page.getByTestId('record-header');
  const titleLoc = header.getByRole('heading', { name: title, exact: true });
  await expect(titleLoc).toBeVisible();
  await waitForFonts(page);
  const titleBox = (await titleLoc.boundingBox())!;
  const statusBox = (await header.getByText(statusText, { exact: true }).boundingBox())!;
  expect(statusBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
  expect(await titleLoc.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
