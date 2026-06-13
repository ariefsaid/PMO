import { test, expect } from '@playwright/test';
import { login } from './helpers';

// AC-CAL-001 + AC-CAL-010 — the read-only Project Calendar journey: a real session opens the
// Projects → Calendar view, the month grid renders, and clicking a real project event (start/end
// chip) navigates to that project's detail route. Goal-oracle: "calendar renders AND a project
// event navigates to its detail route" — never downgraded to "a Calendar button exists".
test('AC-CAL-001: Projects calendar toggle renders the month grid and a project event navigates to detail', async ({
  page,
}) => {
  await login(page, 'pm@acme.test');
  await page.goto('/projects');

  // Switch to the Calendar view (the third Projects view toggle).
  await page.getByRole('tab', { name: /calendar/i }).click();
  const grid = page.getByTestId('calendar-month-grid');
  await expect(grid).toBeVisible();

  // A seeded project (Innovate Corp HQ Fit-Out, start 2026-01-06) has a start event. Page back
  // month-by-month until a project start/end chip appears in the displayed month, then activate it.
  const projectEvent = page.getByRole('button', { name: /— (start|end)/ }).first();
  const prev = page.getByRole('button', { name: /previous month/i });
  for (let i = 0; i < 18 && (await projectEvent.count()) === 0; i++) {
    await prev.click();
  }
  await expect(projectEvent).toBeVisible();
  await projectEvent.click();

  // AC-CAL-010: activating a project event navigates to that project's detail route.
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/);
});
