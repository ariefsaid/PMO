// @e2e-isolation: read-only — opens the cross-project calendar on a seeded month; no DB writes.
import { test, expect } from '@playwright/test';
import { pinEnglishLocale, signIn, waitForFonts } from './helpers';

/**
 * AC-1982 (#1982): a project manager sees what is due, by day, across projects without scanning
 * task lists. Journey: find Calendar in the rail, open it on the month a seeded task is due, and
 * see that task on its due date; the Agenda view lists it too.
 *
 * Seed task "ENG — Detail Design Package" is due 2025-10-10 (a Done row no other spec mutates).
 */
test.describe('AC-1982: calendar shows tasks on their due date', () => {
  test('rail entry opens the calendar; the seed task sits on its due day', async ({ page }) => {
    await pinEnglishLocale(page);
    await signIn(page, 'pm@acme.test');

    const rail = page.getByRole('navigation', { name: /primary navigation/i });
    await expect(rail.getByRole('link', { name: 'Calendar', exact: true })).toBeVisible({ timeout: 10_000 });

    await page.goto('/calendar?date=2025-10-10');
    await expect(page.getByRole('heading', { level: 1, name: 'Calendar' })).toBeVisible();

    await waitForFonts(page);
    const chip = page.getByRole('button', { name: /ENG — Detail Design Package/ }).first();
    await expect(chip).toBeVisible({ timeout: 15_000 });
    // The chip sits in the 10 October cell's week row, in that day's grid column.
    const cell = page.locator('[data-slot="event-calendar-month-cell"]', { has: page.getByText('10', { exact: true }) });
    const cellBox = await cell.first().boundingBox();
    const chipBox = await chip.boundingBox();
    expect(cellBox && chipBox).toBeTruthy();
    const centerX = chipBox!.x + chipBox!.width / 2;
    expect(centerX).toBeGreaterThanOrEqual(cellBox!.x);
    expect(centerX).toBeLessThanOrEqual(cellBox!.x + cellBox!.width);

    await page.getByRole('tab', { name: 'Agenda' }).click();
    await expect(page.getByText('ENG — Detail Design Package').first()).toBeVisible();
  });
});
