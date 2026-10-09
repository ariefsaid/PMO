// @e2e-isolation: read-only — rich seed navigation, phase editor opened/cancelled; no writes.
import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login, waitForFonts } from './helpers';

test.setTimeout(120_000);

const projectPath = '/projects/41000000-0000-0000-0000-000000000001';

// toBeVisible alone permits content below the viewport. Prove the whole target is
// inside the actual shell scrollport, without scrolling it into view to pass.
async function aboveFold(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  await waitForFonts(page);
  await expect.poll(async () => target.evaluate(el => {
    const rect = el.getBoundingClientRect();
    const main = document.querySelector('main')!.getBoundingClientRect();
    const actionBar = document.querySelector('[data-testid="mobile-sticky-action"]')?.getBoundingClientRect();
    const bottom = Math.min(main.bottom, window.innerHeight, actionBar?.top ?? window.innerHeight);
    return rect.top >= main.top && rect.bottom <= bottom;
  })).toBe(true);
}

for (const role of ['pm', 'finance'] as const) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`UIP-005: ${role} sees tab work immediately at ${viewport.width}, with Overview phase actions intact`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await login(page, `${role}@acme.test`);
      await page.goto(`${projectPath}/tasks`);
      const sections = page.getByRole('tablist', { name: 'Project sections' });
      const panel = page.getByRole('tabpanel');
      await expect(panel.getByRole('region', { name: 'Engineering Design', exact: true })).toBeVisible();
      // Arrival starts at the top, not at a tab that scrollIntoView pulled upwards.
      await page.locator('main').evaluate(el => { el.scrollTop = 0; });
      await aboveFold(page, sections);
      await aboveFold(page, panel.getByRole('heading', { name: 'Tasks', exact: true }));
      await aboveFold(page, panel.getByText('ENG — Detail Design Package', { exact: true }));
      await expect(page.getByRole('heading', { name: 'Delivery phases', exact: true })).toHaveCount(0);
      await expect(page.getByTestId('milestone-summary').getByRole('link', { name: 'Overview' })).toBeVisible();
      if (viewport.width === 390) {
        const financialSummary = page.locator('summary').filter({ hasText: 'Financial summary' });
        await financialSummary.focus();
        await page.keyboard.press('Enter');
        await expect(financialSummary.locator('..')).toHaveAttribute('open', '');
        await page.keyboard.press('Enter');
        await expect(financialSummary.locator('..')).not.toHaveAttribute('open');
      }

      // Every section has its own immediate work surface in both themes. These
      // are real, section-specific oracles, not the presence of an empty panel.
      for (const theme of ['light', 'dark']) {
        await page.evaluate(value => { localStorage.setItem('theme', value); document.documentElement.classList.toggle('dark', value === 'dark'); }, theme);
        for (const tab of ['budget', 'procurement', 'work-orders', 'billing', 'documents', 'history', 'tasks']) {
          await page.goto(`${projectPath}/${tab}`);
          const work = tab === 'budget' ? panel.getByTestId('derived-budget')
            : tab === 'procurement' ? panel.getByRole('heading', { name: 'Purchase Requests', exact: true })
            : tab === 'work-orders' ? panel.getByText('Contract drawdown', { exact: true }).first()
            : tab === 'billing' ? panel.getByText('Billing summary', { exact: true })
            : tab === 'documents' ? panel.getByRole('heading', { name: 'Document register', exact: true })
            : tab === 'history' ? panel.getByTestId('history-event').first().or(panel.getByText('No changes recorded yet', { exact: true }))
            : panel.getByText('ENG — Detail Design Package', { exact: true });
          await expect(work).toBeVisible();
          await page.locator('main').evaluate(el => { el.scrollTop = 0; });
          await aboveFold(page, sections);
          await aboveFold(page, work);
        }
        const a11y = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        expect(a11y.violations).toEqual([]);
      }

      await sections.getByRole('tab', { name: 'Overview', exact: true }).click();
      await expect(panel.getByRole('heading', { name: 'Delivery phases', exact: true })).toBeVisible();
      await page.locator('main').evaluate(el => { el.scrollTop = 0; });
      await aboveFold(page, sections);
      await aboveFold(page, panel.getByRole('heading', { name: 'Delivery phases', exact: true }));
      if (role === 'pm') {
        await panel.getByRole('button', { name: 'Edit progress for Engineering Design', exact: true }).click();
        if (viewport.width === 1440) {
          await expect(panel.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
          await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
        } else {
          await expect(page.getByRole('dialog')).toBeVisible();
          await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
        }
      }
      // Full desktop cards retain the existing blocker doorway. The compact
      // context makes the same destination reachable on phone, too.
      if (viewport.width === 1440) {
        await panel.getByRole('link', { name: 'View blocking tasks' }).first().click();
      } else {
        await sections.getByRole('tab', { name: 'Budget', exact: true }).click();
        await page.getByTestId('milestone-summary').getByRole('link', { name: 'View blocking tasks' }).click();
      }
      await expect(page).toHaveURL(`${projectPath}/tasks`);
      await expect(sections.getByRole('tab', { name: 'Tasks', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
}
