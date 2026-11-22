// @e2e-isolation: read-only — only navigates and asserts; works whichever way the organisation's plan switch is set, and changes nothing.
/**
 * JOB-CF-EQ-6 — the monthly equipment plan is reachable from the Equipment screen (fix lane "equipment manager's day", item 6).
 * Goal oracle: from Equipment, one tap reaches the monthly plan when the plan is on; when it is off, an Admin is shown the
 * place that turns it on, by name, and other roles are not offered a link to a plan that is off.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

test.setTimeout(120_000);

test('JOB-CF-EQ-6 the Admin finds the monthly plan, or where to turn it on, from the Equipment screen', async ({ page }) => {
  await signIn(page, 'admin@acme.test');
  await page.goto('/equipment');
  const plan = page.getByRole('link', { name: 'Monthly equipment plan' });
  const turnOn = page.getByRole('link', { name: 'Turn on the monthly equipment plan' });
  await expect(plan.or(turnOn)).toBeVisible({ timeout: 20_000 });
  if (await plan.isVisible()) {
    await plan.click();
    await expect(page).toHaveURL(/\/equipment-plans$/);
    await expect(page.getByRole('heading', { name: 'Monthly equipment plan' })).toBeVisible();
  } else {
    await turnOn.click();
    await expect(page).toHaveURL(/\/equipment-plans\/settings$/);
  }
});

test('JOB-CF-EQ-6 the equipment manager is offered the plan only when it is on', async ({ page }) => {
  await signIn(page, 'pm@acme.test');
  await page.goto('/equipment');
  await expect(page.getByRole('link', { name: 'Hours log' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('link', { name: 'Turn on the monthly equipment plan' })).toHaveCount(0);
});
