// @e2e-isolation: read-only — the account request uses a stubbed endpoint; the seeded Admin session is real.
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

for (const locale of ['en', 'id'] as const) test(`AC-ECX-030 Admin requests a direct-cost account in ${locale}`, async ({ page }) => {
  if (locale === 'id') await page.route('**/rest/v1/profiles?*', async (route) => {
    const response = await route.fetch();
    const data: unknown = await response.json();
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      await route.fulfill({ response, json: { ...data, locale: 'id' } });
    } else await route.fulfill({ response, json: data });
  });
  const requests: Record<string, unknown>[] = [];
  await page.route('**/functions/v1/external-set-company', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (body.setupAction === 'readiness') {
      await route.fulfill({ json: {
        defaults: { company: 'Example', default_payable_account: 'Payable', default_expense_account: 'Expense', default_cash_account: 'Cash', default_bank_account: 'Bank', cost_center: 'Main', default_activity_type: 'Delivery', default_receivable_account: 'Receivable' },
        domains: ['companies'], unmappedProjects: [], budgetMappedCategories: ['Labor', 'Subcontractors', 'Equipment', 'Permits & Fees', 'Overheads', 'Contingency', 'Special expenses'], unlinkedEmployeeCount: 0,
      } });
    } else if (body.setupAction === 'account-groups') {
      await route.fulfill({ json: { groups: [{ erpName: 'Direct Expenses - EX', accountName: 'Direct Expenses', parentAccount: 'Expenses - EX' }] } });
    } else if (body.setupAction === 'send-account') {
      requests.push(body);
      await route.fulfill({ json: { id: 'account-send-example' } });
    } else {
      await route.continue();
    }
  });
  await signIn(page, 'admin@acme.test');
  await page.goto('/administration/integrations');
  const words = locale === 'en'
    ? { missing: 'No direct-cost account for: Materials', create: 'Create accounts', dialog: 'Create direct-cost accounts', group: 'Expense group', name: 'Account name for Materials' }
    : { missing: 'Belum ada akun biaya langsung untuk: Material', create: 'Buat akun', dialog: 'Buat akun biaya langsung', group: 'Grup beban', name: 'Nama akun untuk Material' };
  await expect(page.getByText(words.missing)).toBeVisible();
  await page.getByRole('button', { name: words.create }).click();
  const dialog = page.getByRole('dialog', { name: words.dialog });
  await dialog.getByLabel(words.group, { exact: false }).selectOption('Direct Expenses - EX');
  await dialog.getByLabel(words.name, { exact: false }).fill('Site materials');
  await test.info().attach(`direct-cost-account-dialog-${locale}`, { body: await page.screenshot(), contentType: 'image/png' });
  await dialog.getByRole('button', { name: words.create }).click();
  await expect(dialog).toBeHidden();
  expect(requests).toEqual([{ tier: 'erpnext', setupAction: 'send-account', category: 'Materials', parentAccount: 'Direct Expenses - EX', accountName: 'Site materials' }]);
});
