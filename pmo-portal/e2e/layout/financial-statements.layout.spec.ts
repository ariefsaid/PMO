// @e2e-isolation: read-only — stubbed statement reads and geometry assertions; no writes.
import { expect, test, type Page } from '@playwright/test';
import { signIn, waitForFonts } from '../helpers';
import { expectNoHorizontalOverflow } from '../support/layout-oracles';

type Locale = 'en' | 'id';
type Theme = 'light' | 'dark';
type PeriodKind = 'month' | 'quarter' | 'fiscal_year';
type Statement = 'trial_balance' | 'profit_and_loss' | 'balance_sheet';

const FINANCE = 'finance@acme.test';
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
      test(`@layout AC-008 support: company native trial balance fits at ${width}px in ${locale}/${theme}`, async ({ page }) => {
        const routes = await openCompanyStatements(page, locale, theme, 'populated', width);
        await expect(page.getByRole('heading', { level: 1, name: locale === 'id' ? 'Laporan keuangan' : 'Financial statements' })).toBeVisible();
        await expectCompanyAccountLabel(page);
        await expectNoHorizontalOverflow(page);
        await expect.poll(routes.readCount).toBeGreaterThan(0);
      });
    }
  }
}
