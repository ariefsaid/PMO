// @e2e-isolation: serial - sets the organisation's one usage warning threshold for the journey (an org-wide setting the request form and work order read); cleared in afterEach.
/**
 * AC-UW-012 — usage warning on installed material (docs/specs/usage-warning.spec.md). An Admin sets the first usage warning at 80 percent; a project manager names the Engineer the work order's responsible person. A work order plans 100
 * of an item; the Engineer's report carries 85 and is validated. The responsible Engineer is told and the work order card shows the item.
 * Goal oracle: the responsible person is told to go and check, and the warning names installed against plan.
 * Validation through the app needs the paper form's photo in Storage, which CI runs without, so the report is validated by the service role, which
 * fires the same database trigger the validate action does (proven at pgTAP, usage_warning.test.sql, AC-UW-001..009).
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signIn } from '../helpers';
import { need, ok, ORG_ID, PM_ID, serviceClient } from '../support/jobFixtures';
import { ENGINEER_ID, makeItem, runSuffix, SEED_PROJECT_ID, userClient } from '../support/stockFixture';

test.setTimeout(240_000);

let admin: SupabaseClient | undefined;
test.afterEach(async () => { if (admin) await admin.rpc('mrq_set_usage_thresholds', { p_pct_1: null, p_pct_2: null }); });

test('AC-UW-012 installed material past the share tells the engineer who reported it, and the work order card shows it', async ({ page }) => {
  const sfx = runSuffix();
  admin = await userClient('admin@acme.test');
  const service = serviceClient('AC-UW-012');
  const woId = randomUUID();
  const reportId = randomUUID();
  ok('work order', await service.from('work_orders').insert({ id: woId, org_id: ORG_ID, project_id: SEED_PROJECT_ID, title: `Usage warning ${sfx}`, wo_number: `WO-UW${sfx}`,
    status: 'Issued', issued_at: new Date().toISOString(), order_value: 10000, tax_treatment: 'exclusive', tax_amount: 0 }));
  const boq = need('contract line', await service.from('boq_items').insert({ org_id: ORG_ID, project_id: SEED_PROJECT_ID, item_code: `E2E-UW${sfx}`, description: 'Slab', unit: 'm3', quantity: 100, rate: 5 }).select('id').single());
  ok('allocation', await service.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: woId, boq_item_id: boq.id, quantity: 100 }));
  const item = await makeItem(admin, sfx, 'U');
  ok('allowance', await service.from('boq_material_allowances').insert({ org_id: ORG_ID, boq_item_id: boq.id, item_id: item.id, planned_quantity: 100 }));
  expect((await admin.rpc('mrq_set_usage_thresholds', { p_pct_1: 80, p_pct_2: null })).error).toBeNull();
  ok('responsible person', await service.from('work_orders').update({ responsible_person_id: ENGINEER_ID }).eq('id', woId));

  ok('report', await service.from('daily_site_reports').insert({ id: reportId, org_id: ORG_ID, project_id: SEED_PROJECT_ID, work_order_id: woId,
    work_date: new Date().toISOString().slice(0, 10), status: 'submitted', author_id: ENGINEER_ID, submitted_at: new Date().toISOString() }));
  ok('material line', await service.from('dsr_consumables').insert({ org_id: ORG_ID, report_id: reportId, position: 1, stock_item_id: item.id, quantity: 85, unit: 'BAG' }));
  ok('validate', await service.from('daily_site_reports').update({ status: 'validated', validated_by: PM_ID, validated_at: new Date().toISOString() }).eq('id', reportId));

  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'engineer@acme.test');
  await page.goto('/');
  await page.getByRole('button', { name: /^notifications/i }).click();
  await expect(page.getByRole('list', { name: 'Notifications' }).getByText(/has reached the 80% usage warning: 85 of 100/).first()).toBeVisible({ timeout: 20_000 });

  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'admin@acme.test');
  await page.goto(`/projects/${SEED_PROJECT_ID}/contract?wo=${woId}`);
  await expect(page.getByTestId(`customer-order-${woId}`).getByTestId('wo-usage-warning')).toContainText(/85 of 100 .* planned installed, past the 80% warning/, { timeout: 20_000 });
});
