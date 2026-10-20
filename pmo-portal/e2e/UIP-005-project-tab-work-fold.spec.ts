// @e2e-isolation: read-only — rich seed navigation, phase editor opened/cancelled; no writes.
import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login, waitForFonts } from './helpers';

test.setTimeout(120_000);

const projectPath = '/projects/41000000-0000-0000-0000-000000000001';
const projectTabs = ['budget', 'procurement', 'work-orders', 'billing', 'documents', 'history', 'tasks'] as const;
type ProjectTab = (typeof projectTabs)[number];
const projectTabLabels: Record<ProjectTab, string> = {
  budget: 'Budget',
  procurement: 'Procurement',
  'work-orders': 'Work orders',
  billing: 'Billing',
  documents: 'Documents',
  history: 'History',
  tasks: 'Tasks',
};

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

test.describe('UX-006: effective phone action targets', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the routine phase-edit action receives the coarse-pointer hit area', async ({ page }) => {
    await login(page, 'pm@acme.test');
    await page.goto(`${projectPath}/overview`);
    const edit = page.getByRole('button', { name: 'Edit progress for Engineering Design', exact: true });
    await expect(edit).toBeVisible();
    const hitArea = await edit.evaluate((el) => {
      const pseudo = getComputedStyle(el, '::before');
      const box = el.getBoundingClientRect();
      const height = Math.max(parseFloat(pseudo.height), parseFloat(pseudo.minHeight));
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top - 1);
      return { height, extendedHitTargetsButton: hit === el };
    });
    expect(hitArea.height).toBeGreaterThanOrEqual(44);
    expect(hitArea.extendedHitTargetsButton).toBe(true);
  });
});

async function checkTabWork(
  page: Page,
  panel: Locator,
  sections: Locator,
  theme: 'light' | 'dark',
  onlyTab?: ProjectTab,
) {
  await page.evaluate(value => { localStorage.setItem('theme', value); document.documentElement.classList.toggle('dark', value === 'dark'); }, theme);
  for (const tab of onlyTab ? [onlyTab] : projectTabs) {
    await page.goto(`${projectPath}/${tab}`);
    const work = tab === 'budget' ? panel.getByTestId('forecast-summary').getByText('$4,500,000').first()
      : tab === 'procurement' ? panel.getByRole('heading', { name: 'Purchase Requests', exact: true })
      : tab === 'work-orders' ? panel.getByRole('heading', { name: 'Contract drawdown', exact: true })
      : tab === 'billing' ? panel.getByRole('heading', { name: 'Billing summary', exact: true })
      : tab === 'documents' ? panel.getByRole('heading', { name: 'Document register', exact: true })
      : tab === 'history' ? panel.getByTestId('history-event').first().or(panel.getByText('No changes recorded yet', { exact: true }))
      : panel.getByText('ENG — Detail Design Package', { exact: true });
    await expect(work).toBeVisible();
    const selectedTab = sections.getByRole('tab', { selected: true });
    await expect(selectedTab).toBeVisible();
    await expect.poll(async () => selectedTab.evaluate(el => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const label = range.getBoundingClientRect();
      const strip = el.closest('[role="tablist"]')!.getBoundingClientRect();
      return label.left >= strip.left && label.right <= strip.right;
    })).toBe(true);
    if (tab === 'budget') {
      const remainingLabel = panel.getByTestId('forecast-summary').getByText(/Forecast remaining|Forecast overrun/);
      const remaining = remainingLabel.locator('..').locator('dd');
      await expect(remainingLabel).toBeVisible();
      await expect(remaining).toBeVisible();
    }
    await page.locator('main').evaluate(el => { el.scrollTop = 0; });
    await aboveFold(page, sections);
    await aboveFold(page, work);
  }
  if (!onlyTab || onlyTab === 'tasks') {
    const a11y = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(a11y.violations).toEqual([]);
  }
}

async function runTabWorkCase(
  page: Page,
  role: 'pm' | 'finance',
  viewport: { width: number; height: number },
  theme: 'light' | 'dark',
  onlyTab?: ProjectTab,
) {
  await page.setViewportSize(viewport);
  await login(page, `${role}@acme.test`);

  const ownsTasksJourney = !onlyTab || onlyTab === 'tasks';
  if (ownsTasksJourney) {
    await page.goto(`${projectPath}/tasks`);
    const initialSections = page.getByRole('tablist', { name: 'Project sections' });
    const initialPanel = page.getByRole('tabpanel');
    await expect(initialPanel.getByRole('region', { name: 'Engineering Design', exact: true })).toBeVisible();
    // Arrival starts at the top, not at a tab that scrollIntoView pulled upwards.
    await page.locator('main').evaluate(el => { el.scrollTop = 0; });
    await aboveFold(page, initialSections);
    await aboveFold(page, initialPanel.getByRole('heading', { name: 'Tasks', exact: true }));
    await aboveFold(page, initialPanel.getByText('ENG — Detail Design Package', { exact: true }));
    await expect(page.getByRole('heading', { name: 'Delivery phases', exact: true })).toHaveCount(0);
    // PD-A: the compact phase line states progress only; Overview is one tab click away, not a second link.
    await expect(page.getByTestId('milestone-summary')).toBeVisible();
    await expect(page.getByTestId('milestone-summary').getByRole('link', { name: 'Overview' })).toHaveCount(0);
    if (viewport.width === 390) {
      const financialSummary = page.locator('summary').filter({ hasText: 'Financial summary' });
      await financialSummary.focus();
      await page.keyboard.press('Enter');
      await expect(financialSummary.locator('..')).toHaveAttribute('open', '');
      await page.keyboard.press('Enter');
      await expect(financialSummary.locator('..')).not.toHaveAttribute('open');
    }
  }

  const sections = page.getByRole('tablist', { name: 'Project sections' });
  const panel = page.getByRole('tabpanel');
  await checkTabWork(page, panel, sections, theme, onlyTab);

  if (theme === 'light' && ownsTasksJourney) {
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
    if (viewport.width === 390) {
      const details = page.locator('summary').filter({ hasText: 'Project details and actions' });
      await expect(details).toBeVisible();
      await expect(details.locator('..')).not.toHaveAttribute('open', '');
    }
    if (viewport.width === 1440) {
      const panelBox = await panel.boundingBox();
      const mainBox = await page.locator('main').boundingBox();
      expect(panelBox).not.toBeNull();
      expect(mainBox).not.toBeNull();
      expect(panelBox!.width).toBeGreaterThan(mainBox!.width * 0.9);
    }
  }
}

for (const role of ['pm', 'finance'] as const) {
  test(`UIP-006: ${role} contract and committed KPI value tops align at 1440px`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, `${role}@acme.test`);
    await page.goto(`${projectPath}/overview`);
    const tiles = page.getByTestId('stat-tile');
    const contractAmount = tiles.nth(0).getByTestId('contract-value-amount');
    const committedValue = tiles.nth(1).locator(':scope > div').nth(1);
    await expect(contractAmount).toBeVisible();
    await expect(committedValue).toHaveText(/\$[\d,]+/);
    await waitForFonts(page);
    const contractTop = await contractAmount.evaluate(el => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect().top;
    });
    const committedTop = await committedValue.evaluate(el => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect().top;
    });
    expect(Math.abs(contractTop - committedTop)).toBeLessThanOrEqual(2);
  });

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    for (const theme of ['light', 'dark'] as const) {
      const title = `UIP-005: ${role} sees tab work immediately at ${viewport.width} (${theme})`;
      const options = { annotation: { type: 'time-budget-ms', description: '90000' } };
      if (role === 'pm' && theme === 'light') {
        for (const tab of projectTabs) {
          test(`${title} — ${projectTabLabels[tab]} [AC-TH-007]`, options, async ({ page }) => {
            await runTabWorkCase(page, role, viewport, theme, tab);
          });
        }
      } else {
        test(`${title} [AC-TH-007]`, options, async ({ page }) => {
          await runTabWorkCase(page, role, viewport, theme);
        });
      }
    }
  }
}
