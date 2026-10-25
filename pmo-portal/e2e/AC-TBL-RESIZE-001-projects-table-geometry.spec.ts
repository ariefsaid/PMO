// @e2e-isolation: read-only — sign-in and inspect the Projects table; no DB writes.
import { test, expect } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';

test.use({ hasTouch: true });

test('AC-TBL-RESIZE-001 AC-TBL-GEOM-001: Projects columns resize, controls remain reachable and phone layout has no page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'admin@acme.test');
  await page.goto('/projects?view=table');

  const scroller = page.getByTestId('dt-table-branch');
  await expect(scroller).toBeVisible({ timeout: 20_000 });
  await expect(scroller.locator('tbody tr').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await waitForFonts(page);

  const table = scroller.locator('table');
  const projectHeader = table.getByRole('columnheader', { name: 'Project', exact: true });
  const handle = page.getByRole('separator', { name: 'Resize Project column' });
  await expect(handle).toBeVisible();
  const before = await projectHeader.evaluate((element) => element.getBoundingClientRect().width);
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 64, box!.y + box!.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => projectHeader.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(before + 40);

  let dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('dt-card-branch')).toBeVisible();
  await expect(page.getByTestId('dt-table-branch')).toHaveCount(0);
  const toolbar = page.getByTestId('list-page-toolbar');
  await expect(toolbar.getByRole('searchbox', { name: 'Search projects' })).toBeVisible();
  await expect(toolbar.getByRole('combobox', { name: 'Scope' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: /^Filters/i })).toBeVisible();
  await expect(toolbar.getByRole('combobox', { name: 'Sort projects' })).toBeVisible();
  await expect(toolbar.getByRole('combobox', { name: 'View' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: /^More actions/i })).toBeVisible();
  const newProject = page.getByRole('button', { name: 'New project' });
  await expect(newProject).toBeVisible();

  const orderedControls = [
    toolbar.getByRole('searchbox', { name: 'Search projects' }),
    toolbar.getByRole('combobox', { name: 'Scope' }),
    toolbar.getByRole('button', { name: /^Filters/i }),
    toolbar.getByRole('combobox', { name: 'Sort projects' }),
    toolbar.getByRole('combobox', { name: 'View' }),
    toolbar.getByRole('button', { name: /^More actions/i }),
    newProject,
  ];
  const boundsInOrder = [];
  for (let index = 0; index < orderedControls.length; index += 1) {
    const control = orderedControls[index];
    const bounds = await control.boundingBox();
    expect(bounds).not.toBeNull();
    const has44pxTouchArea = await control.evaluate((element) => {
      const before = getComputedStyle(element, '::before');
      return before.minWidth === '44px' && before.minHeight === '44px';
    });
    expect(bounds!.height >= 44 || has44pxTouchArea,
      'phone controls have at least a 44px visible or transparent touch target').toBe(true);
    boundsInOrder.push(bounds!);
    if (index < orderedControls.length - 1) {
      const element = await control.elementHandle();
      const nextElement = await orderedControls[index + 1].elementHandle();
      expect(element).not.toBeNull();
      expect(nextElement).not.toBeNull();
      const followsInDom = await element!.evaluate(
        (current, next) => Boolean(current.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING),
        nextElement!,
      );
      expect(followsInDom, 'toolbar controls keep the specified DOM order').toBe(true);
    }
  }
  for (let index = 0; index < boundsInOrder.length - 1; index += 1) {
    const current = boundsInOrder[index];
    const next = boundsInOrder[index + 1];
    expect(next.y + 1 >= current.y && (next.y > current.y + 1 || next.x + 1 >= current.x),
      'toolbar controls keep the specified visual order as they wrap').toBe(true);
  }

  dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});
