import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('AC-601/602 PM sees own seeded entries with project name and weekly total 10.0', async ({ page }) => {
  await login(page, 'pm@acme.test');
  await page.goto('/timesheets');

  // Navigate to the Jun 1 – Jun 7, 2026 week in case the current week is different.
  // The week label format is "Jun 1 - Jun 7, 2026".
  const weekLabel = page.locator('span.min-w-\\[140px\\]');
  const targetLabel = /Jun\s+1\s*[-–]\s*Jun\s+7,?\s*2026/i;

  // Navigate backwards until we find the target week (max 8 attempts to avoid infinite loop).
  for (let i = 0; i < 8; i++) {
    const text = await weekLabel.textContent();
    if (text && targetLabel.test(text)) break;
    // If we overshot (went too far forward), navigate back; otherwise navigate back.
    await page.getByRole('button', { name: /Previous week/i }).click();
    await page.waitForTimeout(100);
  }

  await expect(page.getByText('Innovate Corp HQ Fit-Out').first()).toBeVisible();
  await expect(page.getByTestId('timesheets-weekly-total')).toHaveText(/10\.0/);
});
