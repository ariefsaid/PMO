/**
 * AC-TBL-OVERFLOW-001 + AC-TBL-001 — the /projects table must neither scroll the PAGE sideways nor
 * require horizontal scrolling inside its actual overflow container at 1440px.
 *
 * ORACLES: `documentElement.scrollWidth <= clientWidth` preserves the page-level overflow guard;
 * the visible default-header set plus table bounding/scroll width <= the closest overflow scroller's
 * `clientWidth` proves the default columns fit the available main-content width.
 */
// @e2e-isolation: read-only — sign-in + navigate to /projects table view; no DB writes.
import { test, expect } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';

test.describe('AC-TBL-OVERFLOW-001 + AC-TBL-001 Projects table width at 1440', () => {
  test('AC-TBL-OVERFLOW-001 AC-TBL-001 /projects table has no page or table horizontal scroll @1440', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, 'admin@acme.test');
    await page.goto('/projects?view=table');

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
      const customer = cells.nth(1).locator('a').first();
      const customerName = (await customer.textContent())?.trim() ?? '';
      if (customerName.length < 12 || !(await customer.isVisible())) continue;
      const fitsWithoutEllipsis = await customer.evaluate((element) => {
        const style = getComputedStyle(element);
        return style.textOverflow !== 'ellipsis' && element.scrollWidth <= element.clientWidth;
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

    for (const header of [
      'Project', 'Customer', 'End customer', 'PM', 'Status', 'Contract',
      'Actual', 'Progress', 'Budget used', 'Action',
    ]) {
      await expect(table.getByRole('columnheader', { name: header, exact: true }),
        `default Projects column "${header}" should be visible at 1440px`).toBeVisible();
    }

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

    const action = table.getByRole('button', { name: 'Change status' }).first();
    const actionBounds = await action.boundingBox();
    const scrollerBounds = await scroller.boundingBox();
    expect(actionBounds, 'Projects Action button should be rendered').not.toBeNull();
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
  });
});
