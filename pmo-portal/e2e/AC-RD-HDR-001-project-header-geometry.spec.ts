// @e2e-isolation: read-only — asserts consolidated Overview figures stay readable at 1024px; no writes.
import { expect, test } from '@playwright/test';
import { login, waitForFonts } from './helpers';

const projectPath = '/projects/41000000-0000-0000-0000-000000000001/overview';

for (const role of ['pm', 'finance'] as const) {
  test(`AC-RD-HDR-001: ${role} sees the consolidated money position at 1024px without figure or page overflow`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await login(page, `${role}@acme.test`);
    await page.goto(projectPath);
    await waitForFonts(page);

    const moneyPosition = page.getByTestId('money-position-groups');
    await expect(moneyPosition).toBeVisible();
    await expect(page.getByTestId('overview-contract-value')).toContainText(/\d/);
    for (const name of ['Contract', 'Cost', 'Billing']) {
      await expect(moneyPosition.getByRole('group', { name, exact: true })).toBeVisible();
    }

    const figuresFit = await moneyPosition.locator('dd').evaluateAll((elements) => elements.every((element) => {
      const group = element.closest('[role="group"]');
      if (!group) return false;
      const box = element.getBoundingClientRect();
      const groupBox = group.getBoundingClientRect();
      return element.scrollWidth <= element.clientWidth + 1 &&
        box.left >= groupBox.left - 1 && box.right <= groupBox.right + 1;
    }));
    expect(figuresFit, 'money figures remain within their named group').toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
