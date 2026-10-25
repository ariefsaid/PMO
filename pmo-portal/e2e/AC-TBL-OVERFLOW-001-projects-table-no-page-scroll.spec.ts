// @e2e-isolation: read-only — sign-in + navigate to /projects table view; no DB writes.
import { test, expect } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';

test('AC-TBL-OVERFLOW-001 AC-TBL-001: Projects evidence and row actions remain readable without page-level horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'admin@acme.test');
  await page.goto('/projects?view=table');

  const scroller = page.getByTestId('dt-table-branch');
  await expect(scroller).toBeVisible({ timeout: 20_000 });
  const table = scroller.locator('table');
  await expect(table.locator('tbody tr').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await waitForFonts(page);

  for (const header of ['Project', 'PM', 'Status / expected end', 'Delivery', 'Contract', 'Actual', 'Budget used']) {
    await expect(table.getByRole('columnheader', { name: header, exact: true }),
      `the ${header} evidence column should be available in the Projects table`).toBeVisible();
  }

  const rows = table.locator('tbody tr');
  let foundCustomer = false;
  let foundManager = false;
  for (let index = 0; index < await rows.count(); index += 1) {
    const cells = rows.nth(index).locator('td');
    const customer = cells.nth(0).locator('a').first();
    if (!foundCustomer && await customer.count() > 0 && await customer.isVisible()) {
      const customerName = (await customer.textContent())?.trim() ?? '';
      expect(customerName.length, 'customer identity is readable as text').toBeGreaterThan(0);
      const customerRects = await customer.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const cell = element.closest('td')!.getBoundingClientRect();
        return Array.from(range.getClientRects()).map((rect) => ({ right: rect.right, cellRight: cell.right }));
      });
      expect(customerRects.length).toBeGreaterThan(0);
      expect(customerRects.every((rect) => rect.right <= rect.cellRight + 1), `customer name "${customerName}" should wrap inside its cell`).toBe(true);
      foundCustomer = true;
    }

    if (!foundManager) {
      const manager = cells.nth(1);
      const managerName = (await manager.textContent())?.trim() ?? '';
      if (managerName.length > 0) {
        expect(managerName).not.toMatch(/[.…]{3}/u);
        foundManager = true;
      }
    }
    if (foundCustomer && foundManager) break;
  }
  expect(foundCustomer, 'at least one row should show its customer alongside the project identity').toBe(true);
  expect(foundManager, 'at least one row should show a readable project-manager name or unassigned state').toBe(true);

  const action = table.getByRole('button', { name: 'Row actions' }).first();
  await expect(action).toBeVisible();
  const actionBounds = await action.boundingBox();
  const scrollerBounds = await scroller.boundingBox();
  expect(actionBounds).not.toBeNull();
  expect(scrollerBounds).not.toBeNull();
  expect(actionBounds!.x).toBeGreaterThanOrEqual(scrollerBounds!.x);
  expect(actionBounds!.x + actionBounds!.width).toBeLessThanOrEqual(scrollerBounds!.x + scrollerBounds!.width);

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `page horizontal overflow at ${width}px`).toBeLessThanOrEqual(clientWidth);
  }
});
