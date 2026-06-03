import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('AC-603 Engineer sees only own rows (16.0), not the PM total (10.0)', async ({ page }) => {
  await login(page, 'engineer@acme.test');
  await page.goto('/timesheets');

  // Navigate to the Jun 1 – Jun 7, 2026 week in case the current week is different.
  const weekLabel = page.locator('span.min-w-\\[140px\\]');
  const targetLabel = /Jun\s+1\s*[-–]\s*Jun\s+7,?\s*2026/i;

  for (let i = 0; i < 8; i++) {
    const text = await weekLabel.textContent();
    if (text && targetLabel.test(text)) break;
    await page.getByRole('button', { name: /Previous week/i }).click();
    await page.waitForTimeout(100);
  }

  await expect(page.getByTestId('timesheets-weekly-total')).toHaveText(/16\.0/);
  await expect(page.getByTestId('timesheets-weekly-total')).not.toHaveText(/10\.0/);
});
