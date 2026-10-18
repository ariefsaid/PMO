// @e2e-isolation: read-only — pipeline reads are route-stubbed with synthetic rows; no DB writes.
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';

const LONG_NAME = 'Integrated maintenance planning for regional facilities and remote teams';
const LONG_CUSTOMER = 'PT Garuda Regional Infrastructure Services across island operations';

const OPEN_PROJECTS = [
  {
    id: 'e0000000-0000-4000-8000-000000000001',
    name: LONG_NAME,
    client_name: LONG_CUSTOMER,
    pmo_project_number: 'PMO-26-0042',
    code: 'CLIENT-77',
    status: 'Leads',
    contract_value: 1_250_000_000_000,
    currency: 'IDR',
    tax_treatment: 'inclusive',
    tax_rate: 11,
    tax_base_numerator: 100,
    tax_base_denominator: 111,
    win_probability: 0.1,
    last_update: '2026-10-17T08:30:00.000Z',
    pm_name: null,
  },
  {
    id: 'e0000000-0000-4000-8000-000000000002',
    name: 'Regional Services Upgrade',
    client_name: 'Northwind Services',
    pmo_project_number: 'PMO-26-0043',
    code: 'CLIENT-78',
    status: 'PQ Submitted',
    contract_value: 800_000,
    currency: 'USD',
    tax_treatment: 'exclusive',
    tax_rate: 11,
    win_probability: 0.25,
    last_update: '2026-10-16T08:30:00.000Z',
    pm_name: null,
  },
  {
    id: 'e0000000-0000-4000-8000-000000000003',
    name: 'Quotation for Fleet Support',
    client_name: 'Meridian Transport',
    pmo_project_number: 'PMO-26-0044',
    code: 'CLIENT-79',
    status: 'Quotation Submitted',
    contract_value: 560_000,
    currency: 'USD',
    tax_treatment: 'inclusive',
    tax_rate: 11,
    win_probability: 0.4,
    last_update: '2026-10-15T08:30:00.000Z',
    pm_name: null,
  },
  {
    id: 'e0000000-0000-4000-8000-000000000004',
    name: 'Tender for Service Coverage',
    client_name: 'Atlas Contracting',
    pmo_project_number: 'PMO-26-0045',
    code: 'CLIENT-80',
    status: 'Tender Submitted',
    contract_value: 0,
    currency: 'IDR',
    tax_treatment: null,
    win_probability: 0.5,
    last_update: '2026-10-14T08:30:00.000Z',
    pm_name: null,
  },
  {
    id: 'e0000000-0000-4000-8000-000000000005',
    name: 'Negotiation for Network Maintenance',
    client_name: 'Horizon Network Group',
    pmo_project_number: 'PMO-26-0046',
    code: 'CLIENT-81',
    status: 'Negotiation',
    contract_value: 3_400_000,
    currency: 'USD',
    tax_treatment: 'exclusive',
    tax_rate: 11,
    win_probability: 0.75,
    last_update: '2026-10-13T08:30:00.000Z',
    pm_name: null,
  },
];

const LOST_PROJECTS = [
  {
    id: 'e0000000-0000-4000-8000-000000000006',
    name: 'Synthetic Lost Coverage Contract',
    status: 'Loss Tender',
    contract_value: 1_600_000,
    currency: 'USD',
    tax_treatment: 'exclusive',
    tax_amount: 176_000,
    tax_rate: 11,
    win_probability: 0,
    client: { name: 'Example Lost Customer', short_name: null },
    end_client: null,
    pm: null,
  },
  {
    id: 'e0000000-0000-4000-8000-000000000007',
    name: 'Synthetic Declined Service Bid',
    status: 'Declined',
    contract_value: 0,
    currency: 'IDR',
    tax_treatment: null,
    tax_amount: null,
    win_probability: 0,
    client: { name: 'Example Declined Customer', short_name: null },
    end_client: null,
    pm: null,
  },
];

const STAGES = [
  { status: 'Leads', count: 1, total_value: 1_250_000_000_000, win_probability: 0.1, weighted_value: 125_000_000_000 },
  { status: 'PQ Submitted', count: 1, total_value: 800_000, win_probability: 0.25, weighted_value: 200_000 },
  { status: 'Quotation Submitted', count: 1, total_value: 560_000, win_probability: 0.4, weighted_value: 224_000 },
  { status: 'Tender Submitted', count: 1, total_value: 0, win_probability: 0.5, weighted_value: 0 },
  { status: 'Negotiation', count: 1, total_value: 3_400_000, win_probability: 0.75, weighted_value: 2_550_000 },
];

async function installSyntheticPipeline(page: Page, locale: 'en' | 'id') {
  await page.route('**/rest/v1/rpc/get_sales_pipeline', (route) =>
    route.fulfill({ json: { stages: STAGES, projects: OPEN_PROJECTS } }),
  );
  await page.route('**/rest/v1/projects?*', (route) => {
    const url = new URL(route.request().url());
    if (!url.searchParams.get('status')?.includes('Loss Tender')) return route.fallback();
    return route.fulfill({ json: LOST_PROJECTS });
  });
  await page.route('**/rest/v1/profiles?*', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET' || !url.searchParams.has('id')) return route.fallback();
    const response = await route.fetch();
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return route.fulfill({ response });
    }
    const localized = (profile: unknown) =>
      profile && typeof profile === 'object'
        ? { ...(profile as Record<string, unknown>), locale, number_locale: locale === 'id' ? 'id-ID' : 'en-US' }
        : profile;
    return route.fulfill({
      response,
      json: Array.isArray(body) ? body.map(localized) : localized(body),
    });
  });
}

async function assertPhoneGeometry(page: Page) {
  const measure = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const pageWidth = document.documentElement.scrollWidth;
    const list = document.querySelector<HTMLElement>('[data-testid="sales-phone-stage-list"]');
    const card = list?.querySelector<HTMLElement>('[data-testid="project-card"]');
    const name = card?.querySelector<HTMLElement>('button');
    const customer = card?.querySelector<HTMLElement>('span.truncate');
    const listBox = list?.getBoundingClientRect();
    const cardBox = card?.getBoundingClientRect();
    const amount = Array.from(card?.querySelectorAll('span') ?? []).find(
      (el) => el.textContent?.replace(/\D/g, '') === '1250000000000',
    );
    const amountBox = amount?.getBoundingClientRect();
    return {
      viewportWidth,
      pageWidth,
      viewportHeight: document.documentElement.clientHeight,
      listBox: listBox ? { left: listBox.left, right: listBox.right, width: listBox.width } : null,
      cardBox: cardBox ? { top: cardBox.top, bottom: cardBox.bottom, left: cardBox.left, right: cardBox.right } : null,
      amountBox: amountBox ? { top: amountBox.top, bottom: amountBox.bottom, left: amountBox.left, right: amountBox.right } : null,
      name: name ? { clientWidth: name.clientWidth, scrollWidth: name.scrollWidth } : null,
      customer: customer ? { clientWidth: customer.clientWidth, scrollWidth: customer.scrollWidth } : null,
    };
  });
  expect(measure.pageWidth, 'the phone document must not pan sideways').toBeLessThanOrEqual(measure.viewportWidth);
  expect(measure.listBox, 'the selected-stage result list has a rendered box').not.toBeNull();
  expect(measure.listBox!.left).toBeGreaterThanOrEqual(0);
  expect(measure.listBox!.right).toBeLessThanOrEqual(measure.viewportWidth + 1);
  expect(measure.cardBox, 'the first phone opportunity is rendered above the fold').not.toBeNull();
  expect(measure.cardBox!.top).toBeGreaterThanOrEqual(0);
  expect(measure.cardBox!.bottom).toBeLessThanOrEqual(measure.viewportHeight);
  expect(measure.amountBox, 'the complete long source-currency amount has a rendered box').not.toBeNull();
  expect(measure.amountBox!.left).toBeGreaterThanOrEqual(measure.cardBox!.left - 1);
  expect(measure.amountBox!.right).toBeLessThanOrEqual(measure.cardBox!.right + 1);
  expect(measure.name?.scrollWidth).toBeLessThanOrEqual(measure.name?.clientWidth ?? 0);
  expect(measure.customer?.scrollWidth).toBeLessThanOrEqual(measure.customer?.clientWidth ?? 0);
}

for (const locale of ['en', 'id'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`AC-S24-004: phone selector/list and desktop board hold in ${locale}/${theme}`, async ({ page }, testInfo: TestInfo) => {
      await installSyntheticPipeline(page, locale);
      await signIn(page, 'admin@acme.test');
      await page.emulateMedia({ colorScheme: theme });
      await page.evaluate((nextTheme) => {
        localStorage.setItem('theme', nextTheme);
        document.documentElement.classList.toggle('dark', nextTheme === 'dark');
      }, theme);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/sales?view=kanban');
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      const selector = page.getByRole('combobox', { name: locale === 'id' ? 'Tahap pipeline' : 'Pipeline stage' });
      await expect(selector).toBeVisible();
      await expect(page.getByRole('combobox', { name: locale === 'id' ? 'Tahap pipeline' : 'Pipeline stage' })).toHaveCount(1);
      const phoneList = page.getByTestId('sales-phone-stage-list');
      await expect(phoneList.locator(':scope > li')).toHaveCount(OPEN_PROJECTS.length);
      const firstCard = phoneList.getByTestId('project-card').first();
      await expect(firstCard.getByText(LONG_NAME, { exact: true })).toBeVisible();
      await expect(firstCard.getByText(LONG_CUSTOMER, { exact: true })).toBeVisible();
      await expect(firstCard.getByText(/1[.,]250(?:[.,]000){3}/)).toBeVisible();
      await expect(firstCard.getByTestId('tax-basis')).toHaveAttribute('data-tax-basis', 'inclusive');
      await waitForFonts(page);
      await assertPhoneGeometry(page);
      const phoneShot = testInfo.outputPath(`S24-phone-${locale}-${theme}-390.png`);
      await phoneList.screenshot({ path: phoneShot, animations: 'disabled' });
      await testInfo.attach(`S24 phone list ${locale} ${theme} 390`, { path: phoneShot, contentType: 'image/png' });

      const details = firstCard.locator('details');
      await details.locator('summary').click();
      await expect(details).toContainText(/125[.,]000[.,]000[.,]000/);
      await expect(details).toContainText('PMO-26-0042');
      await expect(details).toContainText('CLIENT-77');

      await firstCard.getByRole('button', { name: LONG_NAME, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/projects/${OPEN_PROJECTS[0].id}$`));
      await page.goBack();
      await expect(page).toHaveURL(/\/sales\?view=kanban$/);
      await expect(phoneList.locator(':scope > li')).toHaveCount(OPEN_PROJECTS.length);

      await selector.selectOption('Negotiation');
      await expect(page).toHaveURL(/[?&]status=Negotiation/);
      await expect(phoneList.locator(':scope > li')).toHaveCount(1);
      await expect(phoneList.getByText('Negotiation for Network Maintenance')).toBeVisible();
      await expect(phoneList.getByText(LONG_NAME)).toHaveCount(0);

      await page.getByRole('searchbox', { name: locale === 'id' ? 'Cari proyek' : 'Search projects' }).fill('no synthetic match');
      await expect(page.getByText(locale === 'id' ? 'Tidak ada proyek pada tahap ini' : 'No projects in this stage')).toBeVisible();
      await page.getByRole('button', { name: locale === 'id' ? 'Hapus filter' : 'Clear filters' }).click();
      await expect(page).toHaveURL(/\/sales\?view=kanban$/);
      await expect(phoneList.locator(':scope > li')).toHaveCount(OPEN_PROJECTS.length);

      await page.getByRole('tab', { name: locale === 'id' ? /Kalah/ : /Lost/ }).click();
      await expect(page).toHaveURL(/[?&]scope=Lost/);
      await expect(page).toHaveURL(/[?&]view=table/);
      await expect(page.getByText('Synthetic Lost Coverage Contract')).toBeVisible();
      await expect(page.getByText('Synthetic Declined Service Bid')).toBeVisible();
      await expect(page.getByRole('combobox', { name: locale === 'id' ? 'Tahap pipeline' : 'Pipeline stage' })).toHaveCount(0);

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/sales?view=kanban');
      await expect(page.getByRole('region', { name: /Pipeline summary|Ringkasan pipeline/i })).toBeVisible();
      await expect(page.getByTestId('stage-Leads')).toBeVisible();
      await expect(page.getByTestId('stage-Tender Submitted')).toBeVisible();
      await expect(page.getByRole('combobox', { name: locale === 'id' ? 'Tahap pipeline' : 'Pipeline stage' })).toHaveCount(0);
      const desktopBoard = page.locator('.kanban-scroll');
      const desktopShot = testInfo.outputPath(`S24-desktop-${locale}-${theme}-1440.png`);
      await desktopBoard.screenshot({ path: desktopShot, animations: 'disabled' });
      await testInfo.attach(`S24 desktop board ${locale} ${theme} 1440`, { path: desktopShot, contentType: 'image/png' });
    });
  }
}
