// @e2e-isolation: read-only — synthetic Sales Pipeline reads served by page.route; nothing is written.
/**
 * Shared synthetic Sales Pipeline fixtures for the /sales layout sweeps (AC-S24-004).
 *
 * The phone layout is the worst case for every geometry oracle: a long unbroken project name, a
 * long customer name and a trillion-scale IDR contract value render side by side on a 390px card.
 * The pipeline RPC and the Lost-scope projects read are answered at the route boundary, so specs
 * stay read-only and parallel-safe.
 */
import { expect, type Page } from '@playwright/test';
import { signIn } from '../helpers';

export const LONG_NAME = 'Integrated maintenance planning for regional facilities and remote teams';
export const LONG_CUSTOMER = 'PT Garuda Regional Infrastructure Services across island operations';

export const OPEN_PROJECTS = [
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

export const LOST_PROJECTS = [
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

export const STAGES = [
  { status: 'Leads', count: 1, total_value: 1_250_000_000_000, win_probability: 0.1, weighted_value: 125_000_000_000 },
  { status: 'PQ Submitted', count: 1, total_value: 800_000, win_probability: 0.25, weighted_value: 200_000 },
  { status: 'Quotation Submitted', count: 1, total_value: 560_000, win_probability: 0.4, weighted_value: 224_000 },
  { status: 'Tender Submitted', count: 1, total_value: 0, win_probability: 0.5, weighted_value: 0 },
  { status: 'Negotiation', count: 1, total_value: 3_400_000, win_probability: 0.75, weighted_value: 2_550_000 },
];

export async function installSyntheticPipeline(page: Page, locale: 'en' | 'id') {
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

export async function openSalesPipeline(
  page: Page,
  locale: 'en' | 'id',
  theme: 'light' | 'dark',
  viewport: { width: number; height: number },
) {
  await installSyntheticPipeline(page, locale);
  await signIn(page, 'admin@acme.test');
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((nextTheme) => {
    localStorage.setItem('theme', nextTheme);
    document.documentElement.classList.toggle('dark', nextTheme === 'dark');
  }, theme);
  await page.setViewportSize(viewport);
  await page.goto('/sales?view=kanban');
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
}
