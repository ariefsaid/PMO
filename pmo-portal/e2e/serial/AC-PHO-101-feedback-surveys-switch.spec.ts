// @e2e-isolation: serial — flips an org-wide entitlement row (org_features.feedback_surveys) the whole seed org reads; restored in afterEach.
import { test, expect, type Page } from '@playwright/test';
import { login } from '../helpers';

/**
 * AC-PHO-101 (#1532 S9): an org Admin can switch the feedback button and surveys off for the whole
 * organisation, and the choice survives a reload; any other role sees the state without a control.
 *
 * Goal-oracle: the switch's state after a hard reload equals the state the Admin chose, i.e. the write
 * went through `admin_set_feedback_surveys` and was read back from `org_features`.
 */

const SWITCH_NAME = 'Feedback and surveys';
const featuresSwitch = (page: Page) => page.getByRole('switch', { name: SWITCH_NAME });

async function openFeatures(page: Page) {
  await page.goto('/administration/integrations');
  await expect(page.getByTestId('administration-panel-integrations')).toBeVisible({ timeout: 20_000 });
}

test.describe('AC-PHO-101 feedback and surveys switch', () => {
  test.afterEach(async ({ page }) => {
    // Leave the seed org as found: on. Asserted, because a silent failure here poisons the lane.
    await openFeatures(page);
    if ((await featuresSwitch(page).getAttribute('aria-checked')) === 'false') await featuresSwitch(page).click();
    await expect(featuresSwitch(page)).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
  });

  test('AC-PHO-101 the Admin switches it off, reload keeps it off, and switching on restores it', async ({ page }) => {
    await login(page, 'admin@acme.test');
    await openFeatures(page);
    await expect(featuresSwitch(page)).toHaveAttribute('aria-checked', 'true');

    await featuresSwitch(page).click();
    await expect(featuresSwitch(page)).toHaveAttribute('aria-checked', 'false', { timeout: 15_000 });

    await page.reload();
    await expect(page.getByTestId('administration-panel-integrations')).toBeVisible({ timeout: 20_000 });
    await expect(featuresSwitch(page)).toHaveAttribute('aria-checked', 'false');

    await featuresSwitch(page).click();
    await expect(featuresSwitch(page)).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
  });
});
