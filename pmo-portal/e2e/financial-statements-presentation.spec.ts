// @e2e-isolation: read-only — uses the seeded Finance and project records and scoped statement RPC fixtures; it performs no writes or native calls.
import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { signIn, waitForFonts } from './helpers';

type Locale = 'en' | 'id';
type Theme = 'light' | 'dark';
type PeriodKind = 'month' | 'quarter' | 'fiscal_year';
type Statement = 'trial_balance' | 'profit_and_loss' | 'balance_sheet';

const FINANCE = 'finance@acme.test';
const PROJECT_ID = '41000000-0000-0000-0000-000000000001';
const COMPANY_NAME = 'Example Business';
const periodPairs = [
  { kind: 'quarter', currentStart: '2026-04-01', currentEnd: '2026-06-30', priorStart: '2026-01-01', priorEnd: '2026-03-31' },
  { kind: 'fiscal_year', currentStart: '2026-04-01', currentEnd: '2027-03-31', priorStart: '2025-04-01', priorEnd: '2026-03-31' },
  { kind: 'month', currentStart: '2026-09-01', currentEnd: '2026-09-30', priorStart: '2026-08-01', priorEnd: '2026-08-31' },
] as const;

const generation = (delayed = false) => ({
  snapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sourceGeneration: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  asOf: '2026-10-17T13:00:00.000Z',
  captureStartedAt: '2026-10-17T12:00:00.000Z',
  captureCompletedAt: '2026-10-17T13:00:00.000Z',
  currency: 'IDR',
  presentation: { precision: 2, roundingMethod: 'Commercial Rounding' },
  delayed,
});

function catalogue(projectId: string | null) {
  return {
    state: 'complete',
    companyLabel: COMPANY_NAME,
    generation: generation(),
    periods: periodPairs,
    scopes: projectId === null
      ? [{ scopeKind: 'company', projectId: null, statements: ['trial_balance', 'profit_and_loss', 'balance_sheet'], viewKinds: ['account_breakdown'] }]
      : [{ scopeKind: 'project', projectId, statements: ['profit_and_loss'], viewKinds: ['account_breakdown', 'project_totals'] }],
  };
}

function nativePeriod(pair: (typeof periodPairs)[number], side: 'current' | 'prior') {
  const start = side === 'current' ? pair.currentStart : pair.priorStart;
  const end = side === 'current' ? pair.currentEnd : pair.priorEnd;
  return {
    fromDate: start,
    toDate: end,
    fromFiscalYear: side === 'current' ? 'FY 2026' : 'FY 2025',
    toFiscalYear: side === 'current' ? 'FY 2027' : 'FY 2026',
    kind: pair.kind === 'fiscal_year' ? 'year' : pair.kind,
  };
}

function nativeReport(
  pair: (typeof periodPairs)[number],
  side: 'current' | 'prior',
  statement: Statement,
  projectId: string | null,
  mode: 'populated' | 'empty' | 'mixed' = 'populated',
) {
  const reportName = statement === 'trial_balance'
    ? 'Trial Balance'
    : statement === 'balance_sheet' ? 'Balance Sheet' : 'Profit and Loss Statement';
  const displayRows = mode === 'empty' || (mode === 'mixed' && side === 'current') ? [] : [
    {
      account: '6210-OPERATING-COST',
      account_name: 'Long native account label for responsive wrapping across narrow screens',
      closing_debit: side === 'current' ? '12345678901234567890.01' : '76543210987654321098.76',
      closing_credit: side === 'current' ? null : '0.00',
    },
    {},
    { account: '7999-NET-RESULT', account_name: 'Net result', closing_debit: null, closing_credit: '12345.67' },
  ];
  const period = nativePeriod(pair, side);
  return {
    reportName,
    company: COMPANY_NAME,
    side,
    period,
    periodPair: { current: nativePeriod(pair, 'current'), prior: nativePeriod(pair, 'prior') },
    project: projectId === null ? null : { projectId, erpProjectName: 'Example delivery project' },
    language: 'en',
    profile: { erpVersion: '16.33.0', frappeVersion: '16.31.0' },
    columns: [
      { fieldname: 'account', label: 'Account', type: 'text' },
      { fieldname: 'closing_debit', label: 'Closing debit', type: 'currency' },
      { fieldname: 'closing_credit', label: 'Closing credit', type: 'currency' },
    ],
    rows: displayRows,
    summary: null,
    provenance: {
      endpoint: '/api/method/frappe.desk.query_report.run',
      method: 'GET',
      ignorePreparedReport: 1,
      rawSha256: 'f'.repeat(64),
      acquiredAt: side === 'current' ? '2026-10-17T12:30:00.000Z' : '2026-10-17T12:31:00.000Z',
      filters: {},
    },
  };
}

type ReadMode = 'populated' | 'empty' | 'mixed' | 'delayed' | 'error' | 'persistent-error';

async function installRoutes(page: Page, options: { projectId: string | null; mode?: ReadMode }) {
  let reads = 0;
  const { projectId, mode = 'populated' } = options;
  await page.route('**/rest/v1/rpc/get_financial_statement_catalogue', async (route) => {
    const body = route.request().postDataJSON() as { p_project_id?: string | null };
    const requestedProject = body.p_project_id === projectId ? projectId : null;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(catalogue(requestedProject)) });
  });
  await page.route('**/rest/v1/rpc/get_financial_statement', async (route) => {
    reads += 1;
    if (mode === 'persistent-error' || (mode === 'error' && reads === 1)) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Private backend details must stay hidden.', code: 'e2e-display-failure' }),
      });
      return;
    }
    const input = route.request().postDataJSON() as {
      p_period_kind: PeriodKind;
      p_period_start: string;
      p_statement: Statement;
      p_project_id: string | null;
      p_view_kind: 'account_breakdown' | 'project_totals';
    };
    const pair = periodPairs.find((candidate) => candidate.kind === input.p_period_kind && candidate.currentStart === input.p_period_start);
    if (!pair) {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'Fixture period not found.' }) });
      return;
    }
    if (input.p_view_kind === 'project_totals') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          state: 'complete',
          companyLabel: COMPANY_NAME,
          generation: generation(mode === 'delayed'),
          selection: {
            periodKind: input.p_period_kind,
            periodStart: input.p_period_start,
            statement: input.p_statement,
            scopeKind: 'project',
            projectId: input.p_project_id,
            viewKind: input.p_view_kind,
          },
          result: {
            viewKind: 'project_totals',
            period: pair,
            hasActivity: true,
            payload: {
              current: { income: '12345678901234567890.01', expense: '876543210987654321.09', net: '11469135690246913568.92' },
              prior: { income: '76543210987654321098.76', expense: '76543210987654321.98', net: '76466667776666666776.78' },
            },
          },
        }),
      });
      return;
    }
    const detailMode = mode === 'empty' || mode === 'mixed' ? mode : 'populated';
    const current = nativeReport(pair, 'current', input.p_statement, input.p_project_id, detailMode);
    const prior = nativeReport(pair, 'prior', input.p_statement, input.p_project_id, detailMode);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        state: 'complete',
        companyLabel: COMPANY_NAME,
        generation: generation(mode === 'delayed'),
        selection: {
          periodKind: input.p_period_kind,
          periodStart: input.p_period_start,
          statement: input.p_statement,
          scopeKind: input.p_project_id === null ? 'company' : 'project',
          projectId: input.p_project_id,
          viewKind: input.p_view_kind,
        },
        result: {
          viewKind: 'account_breakdown',
          period: pair,
          hasActivity: detailMode !== 'empty',
          payload: { current, prior },
          provenance: {
            sourceReport: current.reportName,
            reportVersion: current.profile.erpVersion,
            filters: { current: {}, prior: {} },
            settings: null,
          },
        },
      }),
    });
  });
  return { readCount: () => reads };
}

async function forceLocale(page: Page, locale: Locale) {
  await page.route('**/rest/v1/profiles?*', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET' || !url.searchParams.has('id')) return route.fallback();
    const response = await route.fetch();
    const body: unknown = await response.json();
    const patch = (row: unknown) => row && !Array.isArray(row) && typeof row === 'object'
      ? { ...(row as Record<string, unknown>), locale, number_locale: locale === 'id' ? 'id-ID' : 'en-US' }
      : row;
    return route.fulfill({ response, json: Array.isArray(body) ? body.map(patch) : patch(body) });
  });
}

async function openCompanyStatements(
  page: Page,
  locale: Locale,
  theme: Theme,
  mode: ReadMode = 'populated',
  width = 390,
) {
  const routes = await installRoutes(page, { projectId: null, mode });
  await forceLocale(page, locale);
  await signIn(page, FINANCE);
  await page.evaluate((value) => localStorage.setItem('theme', value), theme);
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.goto('/financial-statements');
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
  else await expect(page.locator('html')).not.toHaveClass(/dark/);
  await waitForFonts(page);
  return routes;
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll, `document overflowed by ${dimensions.scroll - dimensions.client}px`).toBeLessThanOrEqual(dimensions.client + 1);
}

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

async function saveMountedScreenshot(page: Page, surface: 'company' | 'project', width: number, locale: Locale, theme: Theme) {
  const directory = process.env.PMO_DISPLAY_SCREENSHOT_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${surface}-${width}-${locale}-${theme}.png`);
  await page.screenshot({ path, fullPage: true });
  if (surface === 'project' || width === 390) {
    const title = surface === 'project'
      ? locale === 'id' ? 'Laba rugi proyek' : 'Project profit and loss'
      : locale === 'id' ? 'Neraca saldo' : 'Trial balance';
    const sectionHeading = page.getByRole('heading', { level: 2, name: title });
    await sectionHeading.locator('xpath=../../..').screenshot({ path: join(directory, `${surface}-${width}-${locale}-${theme}-section.png`) });
  }
  if (surface === 'company' && width === 390) {
    await page.getByRole('button', { name: /Previous period|Periode sebelumnya/ }).click();
    const statementTable = page.getByRole('table');
    await statementTable.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(directory, `${surface}-${width}-${locale}-${theme}-prior-viewport.png`) });
    await page.getByRole('button', { name: /Current period|Periode berjalan/ }).click();
  }
}

async function expectCompanyAccountLabel(page: Page) {
  // Statement format: one table, each account listed once.
  const accountLabel = page.getByText('Long native account label for responsive wrapping across narrow screens');
  await expect(page.getByRole('table')).toHaveCount(1);
  await expect(accountLabel).toHaveCount(1);
  await expect(accountLabel.first()).toBeVisible();
}

for (const width of [390, 1440] as const) {
  for (const locale of ['en', 'id'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      test(`AC-008 support: company native trial balance fits at ${width}px in ${locale}/${theme}`, async ({ page }) => {
        const routes = await openCompanyStatements(page, locale, theme, 'populated', width);
        await expect(page.getByRole('heading', { level: 1, name: locale === 'id' ? 'Laporan keuangan' : 'Financial statements' })).toBeVisible();
        await expectCompanyAccountLabel(page);
        await expectNoHorizontalOverflow(page);
        await expect.poll(routes.readCount).toBeGreaterThan(0);
        await saveMountedScreenshot(page, 'company', width, locale, theme);
      });

      test(`AC-008 support: project totals fit at ${width}px in ${locale}/${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        const routes = await installRoutes(page, { projectId: PROJECT_ID });
        await forceLocale(page, locale);
        await signIn(page, FINANCE);
        await page.evaluate((value) => localStorage.setItem('theme', value), theme);
        await page.goto(`/projects/${PROJECT_ID}/overview`);
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
        await saveMountedScreenshot(page, 'project', width, locale, theme);
      });
    }
  }
}

test('AC-008 support: company profit and loss preserves both native sides and source labels in Bahasa', async ({ page }) => {
  await openCompanyStatements(page, 'id', 'light');
  await page.getByRole('combobox', { name: 'Laporan' }).selectOption('profit_and_loss');
  await expectCompanyAccountLabel(page);
  await expect(page.getByRole('columnheader', { name: /Periode berjalan/ }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Periode sebelumnya/ }).first()).toBeVisible();
  // No project is admitted for this Company, so there is nothing to scope.
  await expect(page.getByRole('combobox', { name: 'Cakupan' })).toHaveCount(0);
});

test('AC-008 support: balance sheet states its supplied as-at date once', async ({ page }) => {
  await openCompanyStatements(page, 'en', 'light');
  await page.getByRole('combobox', { name: 'Statement' }).selectOption('balance_sheet');
  await expect(page.getByText(/As at Sep 30, 2026/)).toBeVisible();
  await expect(page.getByText(/As at/)).toHaveCount(1);
});

test('AC-008 support: mixed native emptiness keeps both periods reachable', async ({ page }) => {
  await openCompanyStatements(page, 'en', 'light', 'mixed');
  await expect(page.getByText('No activity in this period')).toBeVisible();
  await page.getByRole('button', { name: 'Previous period' }).click();
  await expect(page.getByText('Net result')).toBeVisible();
});

test('AC-008 support: two empty native reports retain the safe no-activity state', async ({ page }) => {
  await openCompanyStatements(page, 'en', 'light', 'empty');
  await expect(page.getByText('No activity in this period')).toBeVisible();
  await expect(page.getByRole('heading', { level: 3 })).toHaveCount(0);
});

test('AC-008 support: delayed capture keeps data visible and labels the delay', async ({ page }) => {
  await openCompanyStatements(page, 'en', 'light', 'delayed');
  await expect(page.getByText('Update delayed')).toBeVisible();
  await expectCompanyAccountLabel(page);
});

test('AC-008 support: project Retry repeats the eligible totals read without dropping its saved values', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const routes = await installRoutes(page, { projectId: PROJECT_ID, mode: 'delayed' });
  await forceLocale(page, 'en');
  await signIn(page, FINANCE);
  await page.goto(`/projects/${PROJECT_ID}/overview`);
  await expect(page.getByRole('heading', { level: 2, name: 'Project profit and loss' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  const readsBeforeRetry = routes.readCount();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(routes.readCount).toBe(readsBeforeRetry + 1);
  await expect(page.getByText('12,345,678,901,234,567,890.01')).toBeVisible();
  await expect(page.getByText(/Capture window:/)).toBeVisible();
});

test('AC-008 support: initial read error hides backend detail and Retry restores the report', async ({ page }) => {
  const routes = await openCompanyStatements(page, 'en', 'light', 'error');
  await expect(page.getByText("Couldn't load financial statements")).toBeVisible();
  await expect(page.getByText('Private backend details must stay hidden.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expectCompanyAccountLabel(page);
  await expect.poll(routes.readCount).toBe(2);
});

test('AC-008 support: keyboard order stays period kind, period, statement, then Retry', async ({ page }) => {
  await openCompanyStatements(page, 'en', 'light', 'persistent-error');
  const statement = page.getByRole('combobox', { name: 'Statement' });
  await statement.selectOption('profit_and_loss');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  const kind = page.getByRole('combobox', { name: 'Period type' });
  await kind.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('combobox', { name: 'Period', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(statement).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeFocused();
});
