// @e2e-isolation: read-only — verifies browser context configuration without changing application state.
import { expect, test } from '@playwright/test';
import { ownedContextOptions } from './helpers';

test('AC-1210: an owned browser context applies the project locale and timezone', async ({ browser }, testInfo) => {
  const expectedLocale = testInfo.project.use.locale;
  const expectedTimezone = testInfo.project.use.timezoneId;
  const contextOptions = ownedContextOptions(testInfo);
  expect(contextOptions).not.toHaveProperty('trace');
  expect(contextOptions).not.toHaveProperty('screenshot');
  expect(contextOptions).not.toHaveProperty('video');
  expect(expectedLocale).toBeTruthy();
  expect(expectedTimezone).toBeTruthy();

  const ownedContext = await browser.newContext(contextOptions);
  const controlContext = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Pacific/Honolulu' });
  try {
    const ownedPage = await ownedContext.newPage();
    const controlPage = await controlContext.newPage();
    const ownedSettings = await ownedPage.evaluate(() => ({
      locale: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }));
    const controlSettings = await controlPage.evaluate(() => ({
      locale: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }));

    expect(ownedSettings).toEqual({ locale: expectedLocale, timezone: expectedTimezone });
    expect(controlSettings.locale).not.toBe(expectedLocale);
    expect(controlSettings.timezone).not.toBe(expectedTimezone);
  } finally {
    await Promise.all([ownedContext.close(), controlContext.close()]);
  }
});
