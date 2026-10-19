// @e2e-isolation: read-only — verifies browser context configuration without changing application state.
import { expect, test } from '@playwright/test';
import { ownedContextOptions } from './helpers';

test('AC-1210: an owned browser context inherits the project locale and timezone', async ({ browser }, testInfo) => {
  const options = ownedContextOptions(testInfo);
  expect(options).toMatchObject({
    locale: testInfo.project.use.locale,
    timezoneId: testInfo.project.use.timezoneId,
    trace: testInfo.project.use.trace,
    screenshot: testInfo.project.use.screenshot,
    video: testInfo.project.use.video,
  });
  const context = await browser.newContext(options);
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
