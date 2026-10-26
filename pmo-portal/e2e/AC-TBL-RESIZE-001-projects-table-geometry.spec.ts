// @e2e-isolation: read-only — sign-in and inspect the Projects table; no DB writes.
import { test, expect } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';

test('AC-TBL-RESIZE-001 AC-TBL-GEOM-001: Projects columns resize, controls remain reachable and phone layout has no page overflow', async ({ page, browser }) => {
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
  // The handle extends 12px beyond its header. Start in its overlap with the header so the
  // browser dispatches mousedown to the separator rather than the next table cell.
  const dragX = box!.x + 4;
  const dragY = box!.y + box!.height / 2;
  const hitLabel = await page.evaluate(({ x, y }) =>
    document.elementFromPoint(x, y)?.closest('[role="separator"]')?.getAttribute('aria-label'),
  { x: dragX, y: dragY });
  expect(hitLabel).toBe('Resize Project column');
  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  await page.mouse.move(dragX + 64, dragY, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => projectHeader.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(before + 40);

  let dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    storageState: await page.context().storageState(),
  });
  try {
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto('/projects?view=table');
    await expect(mobilePage.getByTestId('dt-card-branch')).toBeVisible();
    await expect(mobilePage.getByTestId('dt-table-branch')).toHaveCount(0);
    const toolbar = mobilePage.getByTestId('list-page-toolbar');
    await expect(toolbar.getByRole('searchbox', { name: 'Search projects' })).toBeVisible();
    await expect(toolbar.getByRole('combobox', { name: 'Scope' })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: /^Filters/i })).toBeVisible();
    await expect(toolbar.getByRole('combobox', { name: 'Sort projects' })).toBeVisible();
    await expect(toolbar.getByRole('combobox', { name: 'View' })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: /^More actions/i })).toBeVisible();
    const newProject = mobilePage.getByRole('button', { name: 'New project' });
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
    const visualGroups = [
      orderedControls[0].locator('xpath=..'),
      orderedControls[1].locator('xpath=..'),
      orderedControls[2],
      orderedControls[3].locator('xpath=..'),
      orderedControls[4].locator('xpath=..'),
      orderedControls[5],
      orderedControls[6],
    ];
    const boundsInOrder = [];
    for (let index = 0; index < orderedControls.length; index += 1) {
      const control = orderedControls[index];
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      const uses44pxTargetUtility = await control.evaluate((element) => {
        for (let node: Element | null = element; node; node = node.parentElement) {
          if (Array.from(node.classList).some((token) => token.includes('touch-target'))) return true;
          if (node.getAttribute('data-testid') === 'list-page-toolbar') break;
        }
        return false;
      });
      const targetDescription = await control.evaluate((element) => {
        const ancestors: string[] = [];
        for (let node: Element | null = element; node; node = node.parentElement) {
          ancestors.push(node.getAttribute('class') ?? '');
          if (node.getAttribute('data-testid') === 'list-page-toolbar') break;
        }
        return ancestors.join(' <- ');
      });
      expect(bounds!.height >= 44 || uses44pxTargetUtility,
        `phone controls have a 44px visual target or use the shared 44px touch-target utility: ${targetDescription}`).toBe(true);
      const visualBounds = await visualGroups[index].boundingBox();
      expect(visualBounds).not.toBeNull();
      boundsInOrder.push(visualBounds!);
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
        `toolbar controls keep the specified visual order as they wrap: ${JSON.stringify({ index, current, next })}`).toBe(true);
    }

    dimensions = await mobilePage.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  } finally {
    await mobileContext.close();
  }
});
