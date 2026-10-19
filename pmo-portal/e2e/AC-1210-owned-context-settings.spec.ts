// @e2e-isolation: read-only — verifies browser context configuration without changing application state.
import { expect, test } from '@playwright/test';
import { ownedContextOptions } from './helpers';

test('AC-1210: an owned browser context inherits the project locale and timezone', async ({ browser }, testInfo) => {
  const context = await browser.newContext(ownedContextOptions(testInfo));
  try {
    const page = await context.newPage();
    const settings = await page.evaluate(() => ({
      locale: Intl.DateTimeFormat().resolvedOptions().locale,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }));
    expect(settings.locale).toBe(testInfo.project.use.locale);
    expect(settings.timezone).toBe(testInfo.project.use.timezoneId);
  } finally {
    await context.close();
  }
});
