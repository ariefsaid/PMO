// @e2e-isolation: read-only — asserts the project header strip geometry at 1024px; no writes.
import { expect, test } from '@playwright/test';
import { login, waitForFonts } from './helpers';

const projectPath = '/projects/41000000-0000-0000-0000-000000000001/overview';

for (const role of ['pm', 'finance'] as const) {
  test(`AC-RD-HDR-001: ${role} sees a compact header strip at 1024px — one details disclosure, every figure inside its tile, no horizontal bleed`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await login(page, `${role}@acme.test`);
    await page.goto(projectPath);
    await waitForFonts(page);

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
      expect(visible, `tile ${i} value is a figure or omitted when unknown, never prose`).toMatch(/^(|[^A-Za-z]*\d[\d.,%\s]*[^A-Za-z]*|[A-Z$€£]{1,4}\s?[\d.,\s]+)$/);
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
  });
}
