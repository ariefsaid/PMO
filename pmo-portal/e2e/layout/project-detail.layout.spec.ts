// @e2e-isolation: read-only — layout measurements over seeded project routes; every state beyond the
// seed (statement RPCs, Microsoft, project finances, work-order reads) is answered at the route
// boundary with synthetic READ payloads; nothing is written to the database.
/**
 * /projects/:id layout sweep — the consolidated geometry gate for the project detail shell and its
 * tabs. One page load per route × viewport × theme, all oracles via e2e/support helpers:
 *   - the shared no-bleed + oversized-icon sweep (AC-MOBILE-OVERFLOW-001 / AC-VISUAL-ICON-001),
 *   - UIP-005: tab work arrives above the fold, per tab × viewport × theme (roles merged per the
 *     classification target), with the tasks journey/doorway assertions in per-theme journey tests,
 *   - UX-006: the phase-edit action's coarse-pointer hit area at 390px,
 *   - AC-RD-HDR-001: the compact header strip at 1024px (per role),
 *   - AC-BWO-004: the Invoice action inside the work-order list's visible box (en/id),
 *   - m365 #1020 F1/F2-F4/F10: linked-row compactness, phone containment, picker containment,
 *   - AC-008: project totals fit the overview P&L section (en/id × light/dark × 390/1440),
 *   - AC-RAM-004: stepper focus ring, milestone percentage collision, phase-name word wrap,
 *   - AC-PFIN-015: the project finances section fits a 390px phone (keyboard assertions for the
 *     assign dialog live in pages/__tests__/SalesInvoices.assignProject.test.tsx).
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { login, signIn, waitForFonts } from '../helpers';
import { formatDateOnly } from '../../src/lib/format';
import { registerLayoutSweep } from '../support/layout-sweep';
import {
  assertCompactProjectHeader,
  assertMilestoneNamesWrapAtWords,
  assertMilestonePctClearOfName,
  assertStepperFocusRingNotClipped,
  assertWorkOrderInvoiceContainment,
  expectNoHorizontalOverflow,
  openMilestoneCardGrid,
} from '../support/layout-oracles';
import {
  DRAFT_TITLE,
  LONG_TOKEN,
  LONG_TITLE,
  NORMAL_TITLE,
  enableM365Feature,
  expectInsideViewport,
  forceDocumentsLocale,
  mockCustody,
  openDocuments,
  registerRow,
  seedLinkedRows,
} from '../support/m365-documents-mocks';
import {
  STATEMENT_PROJECT_ID as PROJECT_ID,
  forceLocale as forceStatementLocale,
  installRoutes,
} from '../support/financial-statement-fixtures';

test.setTimeout(120_000);

const MERIDIAN = '41000000-0000-0000-0000-000000000001';
const PIPELINE_LENS = '40000000-0000-0000-0000-000000000011';
const projectPath = `/projects/${MERIDIAN}`;

registerLayoutSweep({ path: `${projectPath}/overview`, label: 'project-overview', icons: true });
registerLayoutSweep({ path: `${projectPath}/budget`, label: 'project-budget', icons: true });
registerLayoutSweep({ path: `${projectPath}/tasks`, label: 'project-tasks', icons: true });
registerLayoutSweep({
  path: `/projects/${PIPELINE_LENS}`,
  label: 'project-pipeline-lens (AC-RAM-003)',
  acs: 'AC-RAM-003',
  icons: false,
  ready: (p) => p.getByLabel('Project stage journey'),
});

// ── UIP-005: tab work above the fold. ────────────────────────────────────────────────────────

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
  await expect.poll(async () => target.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const main = document.querySelector('main')!.getBoundingClientRect();
    const actionBar = document.querySelector('[data-testid="mobile-sticky-action"]')?.getBoundingClientRect();
    const bottom = Math.min(main.bottom, window.innerHeight, actionBar?.top ?? window.innerHeight);
    return rect.top >= main.top && rect.bottom <= bottom;
  })).toBe(true);
}

async function checkTabWork(
  page: Page,
  panel: Locator,
  sections: Locator,
  theme: 'light' | 'dark',
  tab: ProjectTab,
  options: { skipGoto?: boolean; withAxe?: boolean } = {},
) {
  await page.evaluate((value) => { localStorage.setItem('theme', value); document.documentElement.classList.toggle('dark', value === 'dark'); }, theme);
  if (!options.skipGoto) await page.goto(`${projectPath}/${tab}`);
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
  await expect.poll(async () => selectedTab.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const label = range.getBoundingClientRect();
    const strip = el.closest('[role="tablist"]')!.getBoundingClientRect();
    return label.left >= strip.left && label.right <= strip.right;
  })).toBe(true);
  await page.locator('main').evaluate((el) => { el.scrollTop = 0; });
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
  if (options.withAxe) {
    const a11y = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(a11y.violations).toEqual([]);
  }
}

/** The tasks-arrival journey: the tab strip, the Tasks heading and the pending primary task are all
 *  above the fold on arrival; the completed-task disclosure, Project facts progress and the phone
 *  keyboard section order hold. */
async function tasksArrivalJourney(page: Page, viewport: { width: number; height: number }, theme: 'light' | 'dark') {
  await page.setViewportSize(viewport);
  await login(page, 'pm@acme.test');
  await page.goto(`${projectPath}/tasks`);
  const initialSections = page.getByRole('tablist', { name: 'Project sections' });
  const initialPanel = page.getByRole('tabpanel');
  await expect(initialPanel.getByRole('button', { name: 'Engineering Design', exact: true })).toBeVisible();
  const primaryTask = initialPanel.getByRole('button', { name: 'Open task PROC — Panel & Inverter Procurement', exact: true });
  await expect(primaryTask).toBeVisible();
  // Arrival starts at the top, not at a tab that scrollIntoView pulled upwards.
  await page.locator('main').evaluate((el) => { el.scrollTop = 0; });
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
    // The approved section design appends the loaded task count to the tab name.
    const tasksTab = initialSections.getByRole('tab', { name: /^Tasks(?: \d+)?$/ });
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
    await expect(initialSections.getByRole('tab', { name: /^Procurement(?: \d+)?$/ })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(initialSections.getByRole('tab', { name: /^Tasks(?: \d+)?$/ })).toHaveAttribute('aria-selected', 'true');
  }

  const sections = page.getByRole('tablist', { name: 'Project sections' });
  const panel = page.getByRole('tabpanel');
  await checkTabWork(page, panel, sections, theme, 'tasks', { skipGoto: true, withAxe: true });

  if (theme === 'light') {
    await sections.getByRole('tab', { name: 'Overview', exact: true }).click();
    // #1402 copy: Delivery phases -> Phase timeline
    const phaseTimeline = panel.getByRole('region', { name: 'Phase timeline', exact: true });
    await expect(phaseTimeline.getByRole('heading', { name: 'Phase timeline', exact: true })).toBeVisible();
    await page.locator('main').evaluate((el) => { el.scrollTop = 0; });
    await aboveFold(page, sections);
    // #1402 recomposition: Money position is the current primary-work target on phone and desktop.
    const moneyPosition = panel.getByRole('region', { name: 'Money position', exact: true });
    await aboveFold(page, moneyPosition.getByRole('heading', { name: 'Money position', exact: true }));
    await aboveFold(page, moneyPosition.getByTestId('contract-value-amount'));
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
    await expect(sections.getByRole('tab', { name: /^Tasks(?: \d+)?$/ })).toHaveAttribute('aria-selected', 'true');
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

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`@layout UIP-005 AC-TH-007: tab work arrives above the fold — tasks journey and doorways at ${viewport.width} (${theme})`, async ({ page }) => {
      await tasksArrivalJourney(page, viewport, theme);
    });
  }
}

for (const tab of projectTabs) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    for (const theme of ['light', 'dark'] as const) {
      test(`@layout UIP-005 AC-TH-007: ${projectTabLabels[tab]} work is above the fold at ${viewport.width} (${theme})`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await login(page, 'pm@acme.test');
        const sections = page.getByRole('tablist', { name: 'Project sections' });
        const panel = page.getByRole('tabpanel');
        await checkTabWork(page, panel, sections, theme, tab, { withAxe: tab === 'tasks' });
      });
    }
  }
}

test.describe('UX-006: effective phone action targets', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('@layout UX-006: the routine phase-edit action receives the coarse-pointer hit area', async ({ page }) => {
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

// ── AC-RD-HDR-001: the compact header strip at 1024px. ───────────────────────────────────────

for (const role of ['pm', 'finance'] as const) {
  test(`@layout AC-RD-HDR-001: ${role} sees a compact header strip at 1024px — one details disclosure, every figure inside its tile, no horizontal bleed`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await login(page, `${role}@acme.test`);
    await page.goto(`${projectPath}/overview`);
    await waitForFonts(page);
    await assertCompactProjectHeader(page);
  });
}

// ── AC-BWO-004: work-order billing containment beside the record panel. ──────────────────────

const WO_PID = '40000000-0000-0000-0000-000000000013';
const WO_ORG = '00000000-0000-0000-0000-000000000001';

const wo = (n: number, status: 'Draft' | 'Issued' | 'Closed', value: number, title: string, extra: Record<string, unknown> = {}) => ({
  id: `aaaaaaaa-0000-0000-0000-00000000000${n}`, org_id: WO_ORG, project_id: WO_PID, wo_number: status === 'Draft' ? null : `WO-261007000${n}`,
  client_po_number: status === 'Draft' ? null : `MSW-PO-260${n + 1}`, title, description: null, status, order_value: value,
  currency: 'USD', tax_treatment: 'exclusive', tax_amount: 0, tax_rate: 11, tax_template: null, order_date: '2026-09-14',
  start_date: null, end_date: null, order_value_set_by: null, order_value_set_at: null, issued_by: null,
  issued_at: status === 'Draft' ? null : '2026-09-15T00:00:00Z', over_commit_ack_by: null, over_commit_ack_at: null,
  closed_at: status === 'Closed' ? '2026-10-04T00:00:00Z' : null, cancelled_at: null, created_at: '2026-09-14T00:00:00Z',
  tax_base_numerator: 1, tax_base_denominator: 1, ...extra,
});
const WO_ROWS = [
  wo(5, 'Issued', 50_000, 'Additional string combiner boxes'),
  wo(6, 'Draft', 40_000, 'Variation — cable tray rerouting'),
  wo(3, 'Closed', 120_000, 'Commissioning support'),
  wo(2, 'Issued', 300_000, 'Inverter supply and installation'),
  wo(1, 'Issued', 555_000, 'Roof structural reinforcement, Bays 1–4', { tax_treatment: 'inclusive', tax_amount: 55_000 }),
];
const woBilling = (r: (typeof WO_ROWS)[number], invoiced: number, pending: number, paid: number) => {
  const net = r.tax_treatment === 'inclusive' ? r.order_value - (r.tax_amount as number) : r.order_value;
  return {
    work_order_id: r.id, org_id: WO_ORG, project_id: WO_PID, status: r.status, currency: 'USD', order_net: net, invoiced, pending,
    paid, remaining: net - invoiced - pending, figures_complete: true, line_count: invoiced || pending ? 1 : 0,
    unpaid_count: invoiced > paid ? 1 : 0,
  };
};
const WO_BILL = [woBilling(WO_ROWS[0], 60_000, 0, 0), woBilling(WO_ROWS[1], 0, 0, 0), woBilling(WO_ROWS[2], 0, 0, 0), woBilling(WO_ROWS[3], 0, 300_000, 0),
  woBilling(WO_ROWS[4], 300_000, 50_000, 100_000)];

async function stubWorkOrders(page: Page, bahasa: boolean) {
  await page.route('**/rest/v1/work_orders?**', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: WO_ROWS }) : r.fallback()));
  await page.route('**/rest/v1/work_order_billing?**', (r) => r.fulfill({ json: WO_BILL }));
  await page.route('**/rest/v1/external_domain_ownership?**', (r) =>
    r.fulfill({ json: [{ id: 'own-1', org_id: WO_ORG, external_tier: 'erpnext', domain: 'revenue' }] }));
  // The Invoice action needs a project client; the seed project has one, this only guarantees it on READ.
  await page.route('**/rest/v1/projects?**', async (r) => {
    if (r.request().method() !== 'GET' || !r.request().url().includes(WO_PID)) return r.fallback();
    const res = await r.fetch();
    let body = await res.json();
    const patch = (o: Record<string, unknown>) => (o && o.id === WO_PID ? { ...o, currency: 'USD', client_id: o.client_id ?? '30000000-0000-0000-0000-000000000001' } : o);
    body = Array.isArray(body) ? body.map(patch) : patch(body);
    return r.fulfill({ response: res, json: body });
  });
  if (bahasa) {
    await page.route('**/rest/v1/profiles?*', async (r) => {
      if (r.request().method() !== 'GET' || !/[?&]id=eq\./.test(r.request().url())) return r.fallback();
      const res = await r.fetch();
      let body: unknown;
      try { body = await res.json(); } catch { return r.fulfill({ response: res }); }
      if (body && !Array.isArray(body) && typeof body === 'object' && 'locale' in body) {
        body = { ...(body as Record<string, unknown>), locale: 'id', number_locale: 'id-ID' };
      }
      return r.fulfill({ response: res, json: body });
    });
  }
}

test('@layout AC-BWO-004: English at 1024px, 1280px and 1440px — Invoice is inside the list\'s visible box and nothing scrolls sideways', async ({ page }) => {
  await stubWorkOrders(page, false);
  await page.setViewportSize({ width: 1024, height: 900 });
  await signIn(page, 'finance@acme.test');
  await page.goto(`/projects/${WO_PID}/work-orders`);
  // #1402 copy: English invoice action ships as "Raise invoice"; same action/geometry oracle.
  const names = { invoice: 'Raise invoice', region: 'Customer orders', billableDetail: 'View details for WO-2610070002' };
  await assertWorkOrderInvoiceContainment(page, names);
  for (const width of [1280, 1440] as const) {
    await page.setViewportSize({ width, height: 900 });
    await waitForFonts(page);
    await assertWorkOrderInvoiceContainment(page, names);
  }
});

test('@layout AC-BWO-004: Bahasa Indonesia at 1024px and 1440px — Invoice is inside the list\'s visible box and nothing scrolls sideways', async ({ page }) => {
  await stubWorkOrders(page, true);
  await page.setViewportSize({ width: 1024, height: 900 });
  await signIn(page, 'finance@acme.test');
  await page.goto(`/projects/${WO_PID}/work-orders`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'id', { timeout: 60_000 });
  const names = { invoice: 'Tagih', region: 'Pesanan pelanggan', billableDetail: 'Lihat detail WO-2610070002' };
  await assertWorkOrderInvoiceContainment(page, names);
  await page.setViewportSize({ width: 1440, height: 900 });
  await waitForFonts(page);
  await assertWorkOrderInvoiceContainment(page, names);
});

// ── #1020 m365 documents geometry (F1, F2/F4, F10). ─────────────────────────────────────────

test('@layout m365 F1: a linked file row stays compact, its Date does not wrap, and the access sentence is not repeated per row', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await forceDocumentsLocale(page, 'en');
  await mockCustody(page, { connected: true });
  await seedLinkedRows(page);
  await enableM365Feature(page);
  await login(page, 'pm@acme.test');
  await openDocuments(page, 'Documents');

  const dateIndex = await page.getByRole('columnheader', { name: /^Date/ }).evaluate((th) => (th as HTMLTableCellElement).cellIndex);
  for (const title of [NORMAL_TITLE, DRAFT_TITLE]) {
    const row = registerRow(page, title);
    await expect(row).toBeVisible();
    const box = await row.boundingBox();
    expect(box?.height ?? Infinity).toBeLessThanOrEqual(140);

    const dateCell = row.locator('td').nth(dateIndex);
    await expect(dateCell).toHaveText(formatDateOnly('2026-01-20'));
    const lines = await dateCell.evaluate((cell) => {
      const range = document.createRange();
      range.selectNodeContents(cell);
      return new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top))).size;
    });
    expect(lines).toBe(1);
  }

  expect(await page.locator('table').getByText('Opens in Microsoft. Access depends on your Microsoft permissions on this file.').count()).toBeLessThanOrEqual(1);
});

test('@layout m365 F2/F4: at phone width a long linked name does not overflow and the primary header action stays in view with no folder linked', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCustody(page, { connected: true });
  await seedLinkedRows(page);
  await enableM365Feature(page);
  await login(page, 'pm@acme.test');
  await openDocuments(page, 'Documents');

  await expect(page.getByRole('button', { name: 'Create folder in SharePoint' })).toBeVisible();
  const link = page.getByRole('button', { name: 'Link from Microsoft 365', exact: true });
  await expect(link).toBeVisible();
  const box = await link.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);

  await expect(page.getByText(LONG_TITLE).first()).toBeVisible();
  await expectInsideViewport(page);
});

test('@layout m365 F10: in the open picker a long unbroken folder name stays inside the dialog, selected and browsed into', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCustody(page, { connected: true });
  await seedLinkedRows(page);
  await enableM365Feature(page);
  await login(page, 'pm@acme.test');
  await openDocuments(page, 'Documents');

  await page.getByRole('button', { name: 'Link from Microsoft 365', exact: true }).click();
  const picker = page.getByRole('dialog', { name: /Choose a Microsoft document/ });
  await picker.getByRole('button', { name: 'My OneDrive' }).click();
  await picker.getByRole('button', { name: `Select folder ${LONG_TOKEN}` }).click();
  await picker.getByRole('button', { name: `Browse ${LONG_TOKEN}` }).first().click();
  await expect(picker.getByRole('navigation', { name: 'Microsoft location' }).getByRole('button', { name: LONG_TOKEN })).toBeVisible();

  await waitForFonts(page);
  const overflowing = await picker.evaluate((dialog) => {
    const bounds = dialog.getBoundingClientRect();
    const offenders: string[] = [];
    if (dialog.scrollWidth > dialog.clientWidth) offenders.push('dialog scrolls horizontally');
    for (const el of Array.from(dialog.querySelectorAll<HTMLElement>('*'))) {
      const style = getComputedStyle(el);
      if (style.position === 'absolute' || style.position === 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const label = `${el.tagName.toLowerCase()}:${(el.textContent ?? '').trim().slice(0, 30)}`;
      if (r.right > bounds.right + 1 || r.left < bounds.left - 1) offenders.push(`${label} leaves the dialog`);
      const parent = el.parentElement;
      if (parent && parent !== dialog) {
        const p = parent.getBoundingClientRect();
        const parentStyle = getComputedStyle(parent);
        if (parentStyle.overflowX === 'visible' && r.right > p.right + 1) offenders.push(`${label} spills out of its container`);
      }
    }
    return offenders;
  });
  expect(overflowing).toEqual([]);
});

// ── AC-008: project totals fit the overview P&L section. ─────────────────────────────────────

async function expectProjectTotalsGeometry(page: Page) {
  const amountCells = page.locator('[data-testid="dt-card-branch"] dd');
  await expect(amountCells).toHaveCount(6);
  const measurements = await amountCells.evaluateAll((cells) => cells.map((cell) => {
    const range = document.createRange();
    range.selectNodeContents(cell);
    const text = cell.textContent ?? '';
    const digitsByLine = new Map<number, number>();
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const nodeText = node.textContent ?? '';
      for (let index = 0; index < nodeText.length; index += 1) {
        const character = nodeText[index] ?? '';
        const characterRange = document.createRange();
        characterRange.setStart(node, index);
        characterRange.setEnd(node, index + 1);
        const characterBox = characterRange.getBoundingClientRect();
        const line = Math.round(characterBox.top);
        if (/\d/.test(character)) digitsByLine.set(line, (digitsByLine.get(line) ?? 0) + 1);
      }
    }
    return {
      width: cell.getBoundingClientRect().width,
      renderedLines: range.getClientRects().length,
      digits: (text.match(/[0-9]/g) ?? []).length,
      digitsByLine: [...digitsByLine.values()],
      whiteSpace: getComputedStyle(cell).whiteSpace,
      overflowWrap: getComputedStyle(cell).overflowWrap,
    };
  }));
  for (const measurement of measurements) {
    expect(measurement.width, 'each current/prior value column should remain comfortably readable at 390px').toBeGreaterThanOrEqual(100);
    expect(measurement.whiteSpace, 'future longer native amounts remain allowed to wrap').toBe('normal');
    expect(measurement.overflowWrap, 'future longer native amounts remain contained without clipping').toBe('break-word');
    expect(measurement.digitsByLine.every((digitCount) => digitCount >= 2),
      `these retained values should not leave one digit alone on a line (line digit counts: ${measurement.digitsByLine.join(', ')})`).toBe(true);
  }
}

async function saveMountedScreenshot(page: Page, width: number, locale: 'en' | 'id', theme: 'light' | 'dark') {
  const directory = process.env.PMO_DISPLAY_SCREENSHOT_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  const path = join(directory, `project-${width}-${locale}-${theme}.png`);
  await page.screenshot({ path, fullPage: true });
  const title = locale === 'id' ? 'Laba rugi proyek' : 'Project profit and loss';
  const sectionHeading = page.getByRole('heading', { level: 2, name: title });
  await sectionHeading.locator('xpath=../../..').screenshot({ path: join(directory, `project-${width}-${locale}-${theme}-section.png`) });
}

for (const width of [390, 1440] as const) {
  for (const locale of ['en', 'id'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      test(`@layout AC-008 support: project totals fit at ${width}px in ${locale}/${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        const routes = await installRoutes(page, { projectId: PROJECT_ID });
        await forceStatementLocale(page, locale);
        await signIn(page, 'finance@acme.test');
        await page.evaluate((value) => localStorage.setItem('theme', value), theme);
        await page.goto(`${projectPath}/overview`);
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
        else await expect(page.locator('html')).not.toHaveClass(/dark/);
        await expect(page.getByRole('heading', { level: 2, name: locale === 'id' ? 'Laba rugi proyek' : 'Project profit and loss' })).toBeVisible();
        const currentIncome = locale === 'id' ? '12.345.678.901.234.567.890,01' : '12,345,678,901,234,567,890.01';
        const priorIncome = locale === 'id' ? '76.543.210.987.654.321.098,76' : '76,543,210,987,654,321,098.76';
        await expect(page.getByText(currentIncome)).toBeVisible();
        await expect(page.getByText(priorIncome)).toBeVisible();
        await waitForFonts(page);
        await expectNoHorizontalOverflow(page);
        if (width === 390) await expectProjectTotalsGeometry(page);
        await expect.poll(routes.readCount).toBeGreaterThan(0);
        await saveMountedScreenshot(page, width, locale, theme);
      });
    }
  }
}

// ── AC-RAM-004: stepper focus ring + milestone geometry. ─────────────────────────────────────

test('@layout AC-RAM-004: the stage-journey stepper\'s focus ring is not clipped by its overflow-hidden wrapper at 390px and 1440px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'admin@acme.test');
  await page.goto(`/projects/${PIPELINE_LENS}`);
  await expect(page.getByLabel('Project stage journey')).toBeVisible({ timeout: 20_000 });
  await waitForFonts(page);
  await assertStepperFocusRingNotClipped(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await waitForFonts(page);
  await assertStepperFocusRingNotClipped(page);
});

test('@layout AC-RAM-004: the milestone card percentage stays clear of a long phase name, and every phase name renders each word on a single line, at 1280px and 1440px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, 'admin@acme.test');
  await page.goto(`${projectPath}/overview`);
  await openMilestoneCardGrid(page);
  await assertMilestonePctClearOfName(page);
  await assertMilestoneNamesWrapAtWords(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByTestId('milestone-card-grid')).toBeVisible();
  await waitForFonts(page);
  await assertMilestonePctClearOfName(page);
  await assertMilestoneNamesWrapAtWords(page);
});

// ── AC-PFIN-015: the project finances section fits a 390px phone. ────────────────────────────

/** The projected finances payload: USD 100 invoiced / 75 settled / 25 outstanding, no budget, and
 *  incomplete actuals so the margin reads the honest no-fabricated-margin reason. */
const PFIN_FINANCES = {
  project_id: MERIDIAN,
  contract_invoiced: '100.00',
  remaining_to_invoice: null,
  invoices: [{
    currency: 'USD', invoice_count: 1, missing_amount: 0, missing_outstanding: 0, missing_work: 0,
    tax_basis: 'exclusive', invoiced: '100.00', settled: '75.00', outstanding: '25.00', work_revenue: '100.00',
  }],
  budget: null,
  actuals: { currency: null, as_of: null, total: null, excludes_restricted_rows: false, categories: [] },
};

test('@layout AC-PFIN-015 support: the project finance section fits a 390px phone and the assign dialog stays keyboard-operable', async ({ page }) => {
  await page.route('**/rest/v1/rpc/get_project_finances', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PFIN_FINANCES) }));
  // One unassigned, ERP-adopted invoice so the sales-invoices search renders an assignable row.
  await page.route('**/rest/v1/sales_invoices?**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ json: [{
      id: 'aaaaaaaa-0000-0000-0000-000000000926',
      org_id: '00000000-0000-0000-0000-000000000001',
      project_id: null,
      erp_project: null,
      customer_id: 'c0000000-0000-0000-0000-000000000001',
      customer_name: 'Solaris Grid EPC',
      si_number: 'SI-PFIN015-VISUAL',
      reference_number: 'PO-2026-10-00043',
      invoice_date: '2026-01-01',
      amount: 100,
      currency: 'USD',
      tax_treatment: 'exclusive',
      tax_amount: 0,
      tax_rate: 11,
      tax_base_numerator: 1,
      tax_base_denominator: 1,
      status: 'Submitted',
      erp_docstatus: 1,
      erp_outstanding_amount: 25,
      pmo_native: false,
      author_user_id: null,
      author_user_ids: [],
      sales_invoice_authors: [],
      erp_modified: '2026-10-01T00:00:00Z',
      erp_due_date: null,
      received_date: null,
      efaktur_number: null,
      efaktur_date: null,
      companies: { name: 'Solaris Grid EPC', erp_payment_terms_days: 30 },
    }] });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'finance@acme.test');
  await page.goto(projectPath);
  await page.getByRole('region', { name: 'Money position' }).getByRole('button', { name: 'Details', exact: true }).click();
  const usd = page.getByTestId('project-finances-USD');
  await expect(usd).toBeVisible({ timeout: 20_000 });
  await waitForFonts(page);
  await expect(usd.getByRole('heading', { name: 'USD', exact: true })).toBeVisible();
  const outstanding = usd.locator('dl > div').filter({ hasText: 'Outstanding' }).locator('dd').first();
  await expect(outstanding).toHaveText('25');
  const margin = usd.locator('dl > div').filter({ hasText: 'Margin' }).locator('dd').first();
  // #1402 copy: keep the exact no-fabricated-margin reason for the owning margin oracle.
  await expect(margin).toHaveText('Gross margin is left out until spending is linked for every budget category.');
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(fits).toBe(true);

  await page.goto(`/sales-invoices?q=SI-PFIN015-VISUAL`);
  const row = page.locator('tbody tr, [role="row"], li', { hasText: 'SI-PFIN015-VISUAL' }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole('button', { name: 'Row actions' }).first().click();
  await page.getByRole('menuitem', { name: /Assign project|Change project/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Tab');
  await expect(dialog.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});
