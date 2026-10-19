// @e2e-isolation: read-only — mocks synthetic accounting reads in the browser and only measures the rendered report.
/**
 * AC-S35-008 — current-position identities, source scopes, and controls remain reachable at narrow and wide widths.
 * Route fixtures are geometry inputs only; they do not certify persisted accounting or ERP output.
 */
import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signIn, waitForFonts } from './helpers';

const COMPANY_ID = 'b0000000-0000-4000-8000-000000000001';
const SNAPSHOT_ID = 'c0000000-0000-4000-8000-000000000001';
const projectId = (index: number) => `a0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;

const projects = Array.from({ length: 20 }, (_, index) => ({
  id: projectId(index),
  name: index === 0
    ? 'Fixture project with a deliberately long identity that must wrap cleanly at narrow widths'
    : `Fixture project ${String(index + 1).padStart(2, '0')}`,
  pmo_project_number: null,
  code: null,
  status: 'Ongoing Project',
  currency: 'USD',
  contract_net: 10_000,
  start_date: null,
  end_date: null,
  project_manager_id: null,
  client_name: null,
}));

const managementPack = {
  from: '2026-01-01',
  to: '2026-01-01',
  timezone: 'UTC',
  org_currency: 'USD',
  undated_invoice_count: 0,
  projects,
  invoiced: [{ project_id: projectId(0), currency: 'USD', month: '2026-01-01', net: 250, invoice_count: 1 }],
  invoiced_before: [],
  progress: [],
};

function moneyRows(ids: readonly string[]) {
  return ids.map((id) => {
    const index = Number(id.slice(-12)) - 1;
    const amount = index === 0 ? '50.00'
      : index === 1 ? '-25.00'
        : index === 2 ? '30.00'
          : index === 3 ? null
            : index === 4 ? '9007199254740993.01'
              : index === 5 ? '0.00' : '100.00';
    return {
      project_id: id,
      ledger_basis: index === 2 ? 'erp' : 'pmo',
      actuals: {
        currency: 'USD',
        total: amount,
        as_of: '2026-10-18T08:00:00Z',
        excludes_restricted_rows: false,
        complete: index !== 2 && index !== 3,
        categories: index === 2 ? [{ category: 'fixture-unmapped', mapped: false, amount: '30.00' }] : [],
      },
      active_budget_amount: null,
      active_budget_currency: null,
      has_active_budget: false,
    };
  });
}

async function installReadFixtures(page: Page) {
  await page.route('**/rest/v1/rpc/get_management_pack*', (route) => route.fulfill({ json: managementPack }));
  await page.route('**/rest/v1/rpc/get_projects_money_collection*', async (route) => {
    const body = route.request().postDataJSON() as { p_project_ids?: string[] };
    await route.fulfill({ json: moneyRows(body.p_project_ids ?? []) });
  });
  await page.route('**/rest/v1/rpc/get_projects_delivery*', (route) => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/rpc/get_project_finances*', async (route) => {
    const body = route.request().postDataJSON() as { p_project_id?: string };
    const id = body.p_project_id ?? projectId(0);
    const index = Number(id.slice(-12)) - 1;
    const actuals = moneyRows([id])[0].actuals;
    await route.fulfill({
      json: {
        project_id: id,
        contract_invoiced: '1110.00',
        remaining_to_invoice: null,
        invoices: [{
          currency: 'USD', invoice_count: 1, invoiced: '1110.00', settled: '1110.00', outstanding: '200.00',
          missing_amount: 0, missing_outstanding: 0, tax_basis: 'exclusive',
          work_revenue: index === 0 ? '1200.00' : '100.00', missing_work: 0,
        }],
        budget: null,
        actuals: {
          currency: actuals.currency,
          as_of: actuals.as_of,
          total: actuals.total,
          excludes_restricted_rows: actuals.excludes_restricted_rows,
          categories: actuals.categories,
        },
        cash_received: { state: 'known', buckets: [{ currency: 'USD', amount: '1000.00' }], receipt_count: 1 },
      },
    });
  });
  await page.route('**/rest/v1/projects?*', async (route) => {
    const url = new URL(route.request().url());
    const filter = url.searchParams.get('id');
    if (!filter) return route.fallback();
    const id = filter.replace(/^eq\./, '');
    const project = projects.find((candidate) => candidate.id === id) ?? projects[0];
    await route.fulfill({ json: {
      id, client_id: COMPANY_ID, currency: 'USD', name: project.name, status: 'Ongoing Project',
      client: null, end_client: null, pm: null,
    } });
  });
  await page.route('**/rest/v1/erp_ar_aging_snapshot?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('select') === 'snapshot_id') {
      return route.fulfill({ json: [{ snapshot_id: SNAPSHOT_ID }] });
    }
    return route.fulfill({ json: [{
      id: 'd0000000-0000-4000-8000-000000000001',
      party: 'Customer:fixture',
      party_type: 'Customer',
      currency: 'USD',
      total_outstanding: 200,
      current: null,
      b_0_30: 0,
      b_31_60: null,
      b_61_90: null,
      b_90_plus: null,
      range_labels: { b_0_30: 'ERP supplied window' },
      report_date: '2026-10-18',
      ageing_based_on: 'Due Date',
      as_of: '2026-10-18T00:00:00Z',
      source_report: 'Accounts Receivable',
      report_version: 'fixture',
      snapshot_id: SNAPSHOT_ID,
    }] });
  });
  await page.route('**/rest/v1/external_refs?*', (route) => route.fulfill({ json: [{
    id: 'e0000000-0000-4000-8000-000000000001',
    pmo_record_id: COMPANY_ID,
    external_record_id: 'Customer:fixture',
  }] }));
}

async function forceProfileLocale(page: Page, locale: 'en' | 'id') {
  await page.route('**/rest/v1/profiles?*', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET' || !url.searchParams.has('id')) return route.fallback();
    const response = await route.fetch();
    const profile = await response.json() as unknown;
    const numberLocale = locale === 'id' ? 'id-ID' : 'en-US';
    if (Array.isArray(profile)) {
      const localized = profile.map((row) => row !== null && typeof row === 'object'
        ? { ...row, locale, number_locale: numberLocale }
        : row);
      return route.fulfill({ response, json: localized });
    }
    if (profile === null || typeof profile !== 'object') return route.fulfill({ response });
    return route.fulfill({ response, json: { ...profile, locale, number_locale: numberLocale } });
  });
}

async function capturePositionFrame(section: Locator, testInfo: TestInfo, name: string) {
  await section.screenshot({ path: testInfo.outputPath(name) });
}

async function readGeometry(page: Page) {
  return page.evaluate(() => {
    const section = document.querySelector<HTMLElement>('[aria-labelledby="management-position-heading"]');
    const actionable = section ? Array.from(section.querySelectorAll<HTMLElement>('a.touch-target,button')) : [];
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      sectionWidth: section?.getBoundingClientRect().width ?? 0,
      actionRects: actionable.map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
      }),
    };
  });
}

const locales = ['en', 'id'] as const;
const themes = ['light', 'dark'] as const;
const widths = [390, 1440] as const;

for (const locale of locales) {
  for (const theme of themes) {
    for (const width of widths) {
      test(`AC-S35-008: ${locale}/${theme} current-position geometry at ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 844 });
        await page.addInitScript((storedTheme) => window.localStorage.setItem('theme', storedTheme), theme);
        await forceProfileLocale(page, locale);
        await signIn(page, 'finance@acme.test');
        await installReadFixtures(page);
        await page.goto('/reports');

        const section = page.locator('[aria-labelledby="management-position-heading"]');
        await expect(section.getByRole('heading', { name: locale === 'id' ? 'Posisi proyek terkini' : 'Current project position' })).toBeVisible();
        await expect(section.getByText(locale === 'id'
          ? 'Posisi tercatat terbaru; terpisah dari pendapatan periode terpilih.'
          : 'Latest recorded position; separate from selected-period revenue.')).toBeVisible();
        await expect(section.getByText(/Fixture project with a deliberately long identity/)).toBeVisible();
        await expect(section.getByRole('link', { name: locale === 'id' ? 'Laporan keuangan perusahaan' : 'Company statements' })).toHaveAttribute('href', '/financial-statements');
        await expect(section.getByRole('button', { name: locale === 'id' ? 'Rincian posisi' : 'Position details' }).first()).toBeVisible();
        await expect(page.getByRole('heading', { name: /Projects as at|Proyek per/ })).toBeVisible();

        await section.scrollIntoViewIfNeeded();
        await waitForFonts(page);
        await capturePositionFrame(section, testInfo, 'management-position-collapsed.png');
        const disclosure = section.locator(`button[aria-controls="position-detail-${encodeURIComponent(projectId(0))}"]`);
        await disclosure.focus();
        await page.keyboard.press('Enter');
        await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
        await expect(section.getByText(locale === 'id'
          ? 'Saldo pelanggan — termasuk proyek lain'
          : 'Customer balance — includes other projects')).toBeVisible();
        await expect(section.getByText(locale === 'id'
          ? 'Waktu pembaruan sumber tidak tersedia'
          : 'Source update time not supplied')).toBeVisible();
        await expect(section.getByText(locale === 'id'
          ? 'Margin pekerjaan tertagih hingga kini'
          : 'Billed-work margin to date')).toBeVisible();
        await expect(section.getByText(locale === 'id' ? /1\.150,00/ : /1,150\.00/)).toBeVisible();
        const a11y = await new AxeBuilder({ page })
          .include('[aria-labelledby="management-position-heading"]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();
        expect(a11y.violations.map(({ id, impact, description }) => ({ id, impact, description })))
          .toEqual([]);

        await waitForFonts(page);
        await capturePositionFrame(section, testInfo, 'management-position-expanded.png');
        const geometry = await readGeometry(page);
        expect(geometry.documentWidth, 'the report must not create page-level horizontal scrolling').toBeLessThanOrEqual(geometry.viewportWidth);
        expect(geometry.sectionWidth).toBeGreaterThan(0);
        for (const rect of geometry.actionRects) {
          expect(rect.width).toBeGreaterThan(0);
          expect(rect.left).toBeGreaterThanOrEqual(-1);
          expect(rect.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
          expect(rect.height).toBeGreaterThanOrEqual(width === 390 ? 44 : 32);
        }
        await expect(section.getByText('Customer:fixture')).toBeVisible();
        await expect(width === 390
          ? section.getByTestId('dt-card-branch')
          : section.locator('table')).toHaveCount(1);

        await disclosure.click();
        const incompleteDisclosure = section.locator(`button[aria-controls="position-detail-${encodeURIComponent(projectId(3))}"]`);
        await incompleteDisclosure.focus();
        await page.keyboard.press('Enter');
        await expect(section.getByText(locale === 'id'
          ? 'Cakupan Actual kanonis tidak lengkap atau tidak tersedia.'
          : 'Canonical Actual coverage is incomplete or unavailable.')).toBeVisible();
        await expect(section.getByRole('heading', {
          level: 5,
          name: locale === 'id' ? 'Margin pekerjaan tertagih hingga kini' : 'Billed-work margin to date',
        }).locator('..').getByText(locale === 'id' ? 'Tidak tersedia' : 'Unavailable', { exact: true })).toBeVisible();
        const incompleteGeometry = await readGeometry(page);
        expect(incompleteGeometry.documentWidth).toBeLessThanOrEqual(incompleteGeometry.viewportWidth);
      });
    }
  }
}
