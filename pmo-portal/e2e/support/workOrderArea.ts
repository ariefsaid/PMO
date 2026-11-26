// The work-order page shows one area at a time (#1126): a journey opens the area it works in the way a person does,
// by its tab on a wide screen or the area picker on a phone. The goal of the journey is unchanged by this step.
import { expect, type Page } from '@playwright/test';

export type WorkOrderArea = 'scope' | 'cost' | 'billing' | 'material' | 'checks' | 'documents' | 'issues';

export async function openWorkOrderArea(page: Page, area: WorkOrderArea): Promise<void> {
  const tab = page.locator(`#wo-tab-${area}`);
  const picker = page.getByTestId('wo-area-select').locator('select');
  // Both exist in the page; the width decides which one a person sees.
  await expect.poll(async () => (await tab.isVisible()) || (await picker.isVisible()), { timeout: 30_000 }).toBe(true);
  if (await tab.isVisible()) await tab.click();
  else await picker.selectOption(area);
  await expect(page.getByTestId(`wo-area-${area}`)).toBeVisible();
}

/**
 * A billing step or close-out item row is for scanning; what changes it opens in a right drawer (#1126). A journey opens it
 * the way a person does, by the row's Update button, and works inside the drawer it returns.
 */
export async function openRowUpdate(page: Page, name: string) {
  await page.getByRole('button', { name: `Update ${name}` }).click();
  const drawer = page.getByRole('dialog', { name });
  await expect(drawer).toBeVisible();
  return drawer;
}
