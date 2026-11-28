// @e2e-isolation: self-isolated — the journey creates its own uniquely named vendor company via service role and deletes it in afterEach; no shared seed row is read or mutated.
import { test, expect, type Page } from '@playwright/test';
import { need, ok, ORG_ID, serviceClient } from './support/jobFixtures';
import { signIn, visibleToast } from './helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * AC-3025 (#3025) — the ONE curated cross-stack journey: a finance user keeps a vendor's
 * code, address and payment terms on the vendor record itself, in the app, with no
 * accounting connection.
 *
 * The job (finance role — the vendor-edit role set is Admin/Executive/Project Manager/
 * Finance, unchanged by #3025): open the vendor, edit it, fill the Vendor details section,
 * save, and see the values on the record. The database-side rules (columns exist, write
 * policy and org seam unchanged) are owned by supabase/tests/vendor_record_fields.test.sql.
 */

test.setTimeout(120_000);

test('AC-3025: a finance user keeps a vendor code, address and payment terms on the vendor record', async ({ page }: { page: Page }) => {
  const admin: SupabaseClient = serviceClient('AC-3025');
  const run = `ac3025-${Date.now().toString(36)}`;
  const vendorName = `Paku Mas ${run}`;

  const vendor = need('vendor', await admin.from('companies')
    .insert({ org_id: ORG_ID, name: vendorName, type: 'Vendor' })
    .select('id')
    .single());

  try {
    await signIn(page, 'finance@acme.test');
    await page.setViewportSize({ width: 1280, height: 800 });

    // Find the run's own vendor in the directory and open its record.
    await page.goto('/companies');
    const search = page.getByPlaceholder(/search/i);
    await search.fill(vendorName);
    await page.getByRole('link', { name: vendorName }).first().click();
    await expect(page).toHaveURL(/\/companies\/[0-9a-f-]{36}/u, { timeout: 20_000 });

    // The job: edit the vendor, fill the PMO-native master data, save.
    await page.getByTestId('company-edit').click();
    await page.getByLabel(/Vendor code/i).fill(`VEN-${run}`);
    await page.getByLabel(/Payment terms \(days\)/i).fill('45');
    await page.getByLabel(/^Address/i).fill('Jl. Raya 12, Surabaya');
    await page.getByRole('button', { name: /^Save company$/i }).click();
    await expect(visibleToast(page, /Company updated/i)).toBeVisible({ timeout: 20_000 });

    // GOAL ORACLE: the record shows what was kept.
    await expect(page.getByText(`VEN-${run}`)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/^45$/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Jl. Raya 12, Surabaya')).toBeVisible({ timeout: 20_000 });
  } finally {
    ok('vendor cleanup', await admin.from('companies').delete().eq('id', vendor.id as string));
  }
});
