// The work-order page shows one area at a time (#1126): a journey opens the area it works in the way a person does,
// by its tab on a wide screen or the area picker on a phone. The goal of the journey is unchanged by this step.
import { expect, type Page } from '@playwright/test';

export type WorkOrderArea = 'scope' | 'cost' | 'billing' | 'material' | 'checks' | 'documents' | 'issues';

export async function openWorkOrderArea(page: Page, area: WorkOrderArea): Promise<void> {
  const tab = page.locator(`#wo-tab-${area}`);
  await expect(tab.or(page.getByTestId('wo-area-select').locator('select'))).toBeVisible({ timeout: 30_000 });
  if (await tab.isVisible()) await tab.click();
  else await page.getByTestId('wo-area-select').locator('select').selectOption(area);
  await expect(page.getByTestId(`wo-area-${area}`)).toBeVisible();
}
