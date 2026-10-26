// @e2e-isolation: read-only — rich seed navigation, phase editor opened/cancelled; no writes.
import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login, waitForFonts } from './helpers';

test.setTimeout(120_000);

const projectPath = '/projects/41000000-0000-0000-0000-000000000001';
const projectSections = ['budget', 'procurement', 'work-orders', 'billing', 'documents', 'history', 'tasks'] as const;
type ProjectSection = (typeof projectSections)[number];
const projectSectionLabels: Record<ProjectSection, string> = {
  budget: 'Budget',
  procurement: 'Procurement',
  'work-orders': 'Work orders',
  billing: 'Billing',
  documents: 'Documents',
  history: 'History',
  tasks: 'Tasks',
};

async function openSectionLinks(page: Page) {
  const desktopNavigation = page.getByRole('navigation', { name: 'Project sections' });
  if (await desktopNavigation.isVisible()) return desktopNavigation;

  await page.getByRole('button', { name: 'Project sections' }).click();
  return page.getByRole('dialog', { name: 'Project sections' })
    .getByRole('navigation', { name: 'Project sections' });
}

function sectionControl(page: Page, width: number) {
  return width < 921
    ? page.getByRole('button', { name: 'Project sections' })
    : page.getByRole('navigation', { name: 'Project sections' });
}

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

async function checkSectionWork(
  page: Page,
  panel: Locator,
  viewport: { width: number; height: number },
  theme: 'light' | 'dark',
  onlySection?: ProjectSection,
) {
  await page.evaluate(value => { localStorage.setItem('theme', value); document.documentElement.classList.toggle('dark', value === 'dark'); }, theme);
  for (const section of onlySection ? [onlySection] : projectSections) {
    await page.goto(`${projectPath}/${section}`);
    const work = section === 'budget' ? panel.getByTestId('forecast-summary').getByText('$4,500,000').first()
      : section === 'procurement' ? panel.getByRole('heading', { name: 'Purchase Requests', exact: true })
      : section === 'work-orders' ? panel.getByRole('heading', { name: 'Work orders', exact: true })
      : section === 'billing' ? panel.getByRole('heading', { name: /^Billing summary/ })
      : section === 'documents' ? panel.getByRole('heading', { name: 'Document register', exact: true })
      : section === 'history' ? panel.getByTestId('history-event').first().or(panel.getByText('No changes recorded yet', { exact: true }))
      : panel.getByText('ENG — Detail Design Package', { exact: true });
    await expect(work).toBeVisible();
    const navigation = await openSectionLinks(page);
    const currentSection = navigation.getByRole('link', { name: projectSectionLabels[section], exact: true });
    await expect(currentSection).toHaveAttribute('aria-current', 'page');
    if (viewport.width < 921) await page.keyboard.press('Escape');

    if (section === 'budget') {
      const remainingLabel = panel.getByTestId('forecast-summary').getByText(/Forecast remaining|Forecast overrun/);
      const remaining = remainingLabel.locator('..').locator('dd');
      await expect(remainingLabel).toBeVisible();
      await expect(remaining).toBeVisible();
    }
    await page.locator('main').evaluate(el => { el.scrollTop = 0; });
    await aboveFold(page, sectionControl(page, viewport.width));
    await aboveFold(page, work);
  }
  if (!onlySection || onlySection === 'tasks') {
    const a11y = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(a11y.violations).toEqual([]);
  }
}

async function runTabWorkCase(
  page: Page,
  role: 'pm' | 'finance',
  viewport: { width: number; height: number },
  theme: 'light' | 'dark',
  onlySection?: ProjectSection,
) {
  await page.setViewportSize(viewport);
  await login(page, `${role}@acme.test`);

  const ownsTasksJourney = !onlySection || onlySection === 'tasks';
  const panel = page.locator('#project-section-content');
  if (ownsTasksJourney) {
    await page.goto(`${projectPath}/tasks`);
    await expect(panel.getByRole('region', { name: 'Engineering Design', exact: true })).toBeVisible();
    await page.locator('main').evaluate(el => { el.scrollTop = 0; });
    await aboveFold(page, sectionControl(page, viewport.width));
    await aboveFold(page, panel.getByRole('heading', { name: 'Tasks', exact: true }));
    await aboveFold(page, panel.getByText('ENG — Detail Design Package', { exact: true }));
    await expect(page.getByRole('heading', { name: 'Delivery phases', exact: true })).toHaveCount(0);
    // The compact phase line states progress only; Overview remains available through named section navigation.
    await expect(page.getByTestId('milestone-summary')).toBeVisible();
    await expect(page.getByTestId('milestone-summary').getByRole('link', { name: 'Overview' })).toHaveCount(0);
    if (viewport.width === 390) {
      const navigation = await openSectionLinks(page);
      for (const label of ['Overview', 'Budget', 'Procurement', 'Tasks', 'Documents', 'History']) {
        await expect(navigation.getByRole('link', { name: label, exact: true })).toBeVisible();
      }
      await page.keyboard.press('Escape');
    }
  }

  await checkSectionWork(page, panel, viewport, theme, onlySection);

  if (theme === 'light' && ownsTasksJourney) {
    const navigation = await openSectionLinks(page);
    await navigation.getByRole('link', { name: 'Overview', exact: true }).click();
    await expect(page).toHaveURL(`${projectPath}/overview`);
    await expect(panel.getByRole('heading', { name: 'Money position', exact: true })).toBeVisible();
    await page.locator('main').evaluate(el => { el.scrollTop = 0; });
    await aboveFold(page, sectionControl(page, viewport.width));
    await aboveFold(page, panel.getByRole('heading', { name: 'Money position', exact: true }));
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
      const navigation = await openSectionLinks(page);
      await navigation.getByRole('link', { name: 'Budget', exact: true }).click();
      await page.getByTestId('milestone-summary').getByRole('link', { name: 'View blocking tasks' }).click();
    }
    await expect(page).toHaveURL(`${projectPath}/tasks`);
    const tasksNavigation = await openSectionLinks(page);
    await expect(tasksNavigation.getByRole('link', { name: 'Tasks', exact: true })).toHaveAttribute('aria-current', 'page');
    if (viewport.width < 921) await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (viewport.width === 390) {
      const details = page.locator('summary').filter({ hasText: 'Project details' });
      await expect(details).toBeVisible();
      await expect(details.locator('..')).not.toHaveAttribute('open', '');
    }
  }
}

for (const role of ['pm', 'finance'] as const) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    for (const theme of ['light', 'dark'] as const) {
      const title = `UIP-005: ${role} sees section work immediately at ${viewport.width} (${theme})`;
      const options = { annotation: { type: 'time-budget-ms', description: '90000' } };
      if (role === 'pm' && theme === 'light') {
        for (const section of projectSections) {
          test(`${title} — ${projectSectionLabels[section]} [AC-TH-007]`, options, async ({ page }) => {
            await runTabWorkCase(page, role, viewport, theme, section);
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
