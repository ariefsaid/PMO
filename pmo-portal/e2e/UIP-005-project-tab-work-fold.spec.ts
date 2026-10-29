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
    await page.getByRole('region', { name: 'Phase timeline', exact: true }).getByRole('button', { name: 'Update phases', exact: true }).click();
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
    let work: Locator;
    if (tab === 'budget') {
      await panel.getByRole('tab', { name: 'Forecast', exact: true }).click();
      const forecast = panel.getByTestId('budget-forecast-view');
      work = forecast.getByText('$4,500,000', { exact: true }).first();
      const forecastCards = forecast.getByRole('list', { name: 'Budget forecast by category', exact: true });
      if ((page.viewportSize()?.width ?? 1440) < 768) {
        await expect(forecastCards).toBeVisible();
        const total = forecastCards.getByRole('listitem').last();
        const remainingLabel = total.getByText('Remaining', { exact: true });
        const remaining = remainingLabel.locator('xpath=../following-sibling::dd[1]');
        await expect(remainingLabel).toBeVisible();
        await expect(remaining).toBeVisible();
      } else {
        const forecastTable = forecast.getByRole('table', { name: 'Budget forecast by category', exact: true });
        const remainingLabel = forecastTable.getByRole('columnheader', { name: 'Forecast remaining / (overrun)', exact: true });
        const remaining = forecastTable.locator('tfoot tr').last().getByRole('cell').last();
        await expect(remainingLabel).toBeVisible();
        await expect(remaining).toBeVisible();
      }
      const summaryRemainingLabel = forecast.getByText(/Forecast remaining|Forecast overrun/);
      const summaryRemaining = summaryRemainingLabel.locator('..').locator('dd');
      await expect(summaryRemainingLabel).toBeVisible();
      await expect(summaryRemaining).toBeVisible();
    } else if (tab === 'procurement') {
      // Current compact entry point for the old Procurement heading.
      work = panel.getByRole('region', { name: 'Procurement stages', exact: true });
    } else if (tab === 'work-orders') {
      // #1402 recomposition: keep the exact Customer orders target reachable in the merged Contract & billing area.
      work = panel.getByRole('heading', { name: 'Customer orders', exact: true });
    } else if (tab === 'billing') {
      // #1402 recomposition: keep the exact Claims & down payment target reachable in the merged Contract & billing area.
      work = panel.getByRole('heading', { name: 'Claims & down payment', exact: true });
    } else if (tab === 'documents') {
      work = panel.getByRole('heading', { name: 'Document register', exact: true });
    } else if (tab === 'history') {
      const activity = page.getByRole('dialog', { name: 'Activity', exact: true });
      await expect(activity).toBeVisible();
      await activity.getByRole('tab', { name: 'Changes', exact: true }).click();
      await expect(activity.getByRole('tab', { name: 'Changes', selected: true })).toBeVisible();
      const events = activity.getByTestId('history-event');
      const emptyState = activity.getByText('No changes recorded yet', { exact: true });
      await expect.poll(async () => (await events.count()) + (await emptyState.count())).toBeGreaterThan(0);
      work = await events.count() ? events.first() : emptyState;
    } else {
      // #1402 recomposition: use the named pending primary task for the fold goal; keep the completed target reachable below.
      work = panel.getByRole('button', { name: 'Open task PROC — Panel & Inverter Procurement', exact: true });
    }
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
    await page.locator('main').evaluate(el => { el.scrollTop = 0; });
    await aboveFold(page, sections);
    if (tab === 'work-orders' || tab === 'billing') {
      // Both old URLs now open the approved Contract & billing tab (#1402); its exact Contract summary is the shared first-glance target.
      const contractHeading = panel.getByRole('heading', { name: 'Contract', exact: true });
      const contractSummary = panel.getByRole('region', { name: 'Contract', exact: true });
      await aboveFold(page, contractHeading);
      await aboveFold(page, contractSummary);
      await expect(work).toBeVisible();
    } else {
      await aboveFold(page, work);
    }
    if (tab === 'tasks') {
      await panel.getByRole('button', { name: '2 done', exact: true }).click();
      await expect(panel.getByRole('button', { name: 'Open task ENG — Detail Design Package', exact: true })).toBeVisible();
      await panel.getByRole('button', { name: '2 done', exact: true }).click();
      await expect(panel.getByRole('button', { name: 'Open task ENG — Detail Design Package', exact: true })).not.toBeVisible();
    }
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
    await expect(initialPanel.getByRole('button', { name: 'Engineering Design', exact: true })).toBeVisible();
    const primaryTask = initialPanel.getByRole('button', { name: 'Open task PROC — Panel & Inverter Procurement', exact: true });
    await expect(primaryTask).toBeVisible();
    // Arrival starts at the top, not at a tab that scrollIntoView pulled upwards.
    await page.locator('main').evaluate(el => { el.scrollTop = 0; });
    await aboveFold(page, initialSections);
    await aboveFold(page, initialPanel.getByRole('heading', { name: 'Tasks', exact: true }));
    await aboveFold(page, primaryTask);
    // #1402 recomposition: retain the former exact Done-task target through its explicit disclosure.
    await initialPanel.getByRole('button', { name: '2 done', exact: true }).click();
    const completedTask = initialPanel.getByRole('button', { name: 'Open task ENG — Detail Design Package', exact: true });
    await expect(completedTask).toBeVisible();
    await initialPanel.getByRole('button', { name: '2 done', exact: true }).click();
    await expect(completedTask).not.toBeVisible();
    // #1402 copy: Delivery phases -> Phase timeline
    await expect(page.getByRole('heading', { name: 'Phase timeline', exact: true })).toHaveCount(0);
    // #1402 recomposition: the old compact phase summary is now weighted Project progress in the persistent Project facts region.
    const projectFacts = page.getByRole('region', { name: 'Project facts', exact: true });
    await expect(projectFacts.getByText('Progress', { exact: true })).toBeVisible();
    await expect(projectFacts.getByRole('progressbar')).toBeVisible();
    await expect(projectFacts.getByRole('link', { name: 'Overview', exact: true })).toHaveCount(0);
    if (viewport.width === 390) {
      // #1402 recomposition: keyboard users reach current financial context through Overview's Money position.
      const tasksTab = initialSections.getByRole('tab', { name: 'Tasks', exact: true });
      await tasksTab.focus();
      await page.keyboard.press('Home');
      await page.keyboard.press('Enter');
      await expect(initialSections.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true');
      const moneyPosition = page.getByRole('region', { name: 'Money position', exact: true });
      await expect(moneyPosition.getByRole('heading', { name: 'Money position', exact: true })).toBeVisible();
      await expect(moneyPosition.getByTestId('contract-value-amount')).toBeVisible();
      await page.keyboard.press('ArrowRight');
      await expect(initialSections.getByRole('tab', { name: 'Budget', exact: true })).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('ArrowRight');
      await expect(initialSections.getByRole('tab', { name: 'Procurement', exact: true })).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('ArrowRight');
      await expect(initialSections.getByRole('tab', { name: 'Tasks', exact: true })).toHaveAttribute('aria-selected', 'true');
    }
  }

  const sections = page.getByRole('tablist', { name: 'Project sections' });
  const panel = page.getByRole('tabpanel');
  await checkTabWork(page, panel, sections, theme, onlyTab);

  if (theme === 'light' && ownsTasksJourney) {
    await sections.getByRole('tab', { name: 'Overview', exact: true }).click();
    // #1402 copy: Delivery phases -> Phase timeline
    const phaseTimeline = panel.getByRole('region', { name: 'Phase timeline', exact: true });
    await expect(phaseTimeline.getByRole('heading', { name: 'Phase timeline', exact: true })).toBeVisible();
    await page.locator('main').evaluate(el => { el.scrollTop = 0; });
    await aboveFold(page, sections);
    // #1402 recomposition: Money position is the current primary-work target on phone and desktop.
    const moneyPosition = panel.getByRole('region', { name: 'Money position', exact: true });
    await aboveFold(page, moneyPosition.getByRole('heading', { name: 'Money position', exact: true }));
    await aboveFold(page, moneyPosition.getByTestId('contract-value-amount'));
    if (role === 'pm') {
      await panel.getByRole('region', { name: 'Phase timeline', exact: true }).getByRole('button', { name: 'Update phases', exact: true }).click();
      await panel.getByRole('button', { name: 'Edit progress for Engineering Design', exact: true }).click();
      if (viewport.width === 1440) {
        await expect(panel.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
        await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
      } else {
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
      }
      await panel.getByRole('region', { name: 'Phase timeline', exact: true }).getByRole('button', { name: 'Done', exact: true }).click();
      await expect(panel.getByRole('region', { name: 'Phase timeline', exact: true }).getByRole('button', { name: 'Update phases', exact: true })).toBeVisible();
    }
    if (viewport.width === 390) {
      // #1402 recomposition: More actions is the current closed menu containing the Project details doorway.
      const moreActions = page.locator('summary[aria-label="More actions"]');
      const actionsMenu = moreActions.locator('..');
      await expect(moreActions).toBeVisible();
      await expect(actionsMenu).not.toHaveAttribute('open', '');
      await moreActions.focus();
      await page.keyboard.press('Enter');
      await expect(actionsMenu).toHaveAttribute('open', '');
      await expect(actionsMenu.getByRole('button', { name: 'Project details', exact: true })).toHaveAttribute('aria-expanded', 'false');
      await page.keyboard.press('Enter');
      await expect(actionsMenu).not.toHaveAttribute('open', '');
    }
    // #1402 recomposition: the old overdue-phase doorway is now Open timeline in Phase timeline.
    const openTimeline = phaseTimeline.getByRole('link', { name: 'Open timeline', exact: true });
    await expect(openTimeline).toHaveAttribute('href', `${projectPath}/tasks?view=timeline`);
    await openTimeline.click();
    await expect(page).toHaveURL(`${projectPath}/tasks?view=timeline`);
    await expect(sections.getByRole('tab', { name: 'Tasks', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
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
  test(`UIP-006: ${role} contract and committed values remain visible at 1440px`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, `${role}@acme.test`);
    await page.goto(`${projectPath}/overview`);
    const contractAmount = page.getByRole('region', { name: 'Money position' }).getByTestId('contract-value-amount');
    const budgetActual = page.getByRole('region', { name: 'Budget vs actual' });
    const committedValue = budgetActual.getByText('Plus 2,558,500 committed in purchase orders', { exact: true });
    await expect(contractAmount).toBeVisible();
    // #1402 copy (#1437): the block names USD once in its unit; keep the seeded committed total exact.
    await expect(budgetActual.getByText('USD · excl. PPN', { exact: true })).toBeVisible();
    await expect(committedValue).toHaveText('Plus 2,558,500 committed in purchase orders');
    // look relation retired: recomposed (#1402)
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
