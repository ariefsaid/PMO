// @e2e-isolation: serial - turns the organisation's "validated daily reports issue stock" setting on for the journey (an org-wide switch the daily report and work order screens read); reset in afterEach.
/**
 * AC-DRS-019 — daily report material and stock (#2676), on a 390 px phone. An Admin sets the work order's site location from the work order
 * page; the Engineer then enters material on a draft report and names the contract item it went into, and the choice is saved with the report.
 * Goal oracle: the site location sticks to the work order, and the report remembers which contract item its material was used on.
 * The posting itself (validation needs the paper form's photo in Storage, which CI runs without) is proven at pgTAP (1320_dsr_stock_issue.test.sql,
 * AC-DRS-002..017) and the warning copy at unit level (SiteReportStock.test.tsx, AC-DRS-018, English and Bahasa Indonesia).
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signIn } from '../helpers';
import { serviceClient } from '../support/jobFixtures';
import { makeItem, runSuffix, userClient, SEED_PROJECT_ID } from '../support/stockFixture';

test.setTimeout(240_000);

let admin: SupabaseClient | undefined;
test.afterEach(async () => { if (admin) await admin.rpc('set_dsr_stock_issue', { p_on: false, p_items: 'all' }); });

test('AC-DRS-019 the site location is set on the work order and a material line remembers its contract item, on a phone', async ({ page }) => {
  const sfx = runSuffix();
  admin = await userClient('admin@acme.test');
  const engineer = await userClient('engineer@acme.test');
  const service = serviceClient('AC-DRS-019');
  const project = await service.from('projects').select('org_id,currency').eq('id', SEED_PROJECT_ID).single();
  if (project.error) throw project.error;
  const woId = randomUUID();
  const wo = await service.from('work_orders').insert({ id: woId, org_id: project.data.org_id, project_id: SEED_PROJECT_ID, title: `Report stock ${sfx}`, wo_number: `WO-DRS${sfx}`,
    status: 'Issued', issued_at: new Date().toISOString(), order_value: 10000, tax_treatment: 'exclusive', tax_amount: 0, currency: project.data.currency });
  if (wo.error) throw wo.error;
  const lines: { id: string; label: string }[] = [];
  for (const [n, desc] of [['A', 'Weld joints'], ['B', 'Paint coat']] as const) {
    const boq = await service.from('boq_items').insert({ org_id: project.data.org_id, project_id: SEED_PROJECT_ID, item_code: `E2E-${n}${sfx}`, description: desc, unit: 'm', quantity: 100, rate: 5 }).select('id').single();
    if (boq.error) throw boq.error;
    const line = await service.from('work_order_lines').insert({ org_id: project.data.org_id, work_order_id: woId, boq_item_id: boq.data.id, quantity: 100 }).select('id').single();
    if (line.error) throw line.error;
    lines.push({ id: line.data.id, label: `E2E-${n}${sfx} · ${desc}` });
  }
  const site = await admin.from('stock_warehouses').insert({ code: `E2E-DS${sfx}`, name: `Report site ${sfx}`, kind: 'site', project_id: SEED_PROJECT_ID }).select('id,name').single();
  if (site.error) throw site.error;
  const item = await makeItem(admin, sfx, 'R');
  const on = await admin.rpc('set_dsr_stock_issue', { p_on: true, p_items: 'all' });
  expect(on.error).toBeNull();
  const draft = await engineer.rpc('dsr_save_draft', { p: { work_order_id: woId, work_date: new Date().toISOString().slice(0, 10), consumables: [{ stock_item_id: item.id, quantity: '2' }] } });
  if (draft.error) throw draft.error;
  const reportId = String(draft.data);

  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'admin@acme.test');
  await page.goto(`/work-orders/${woId}`);
  const section = page.getByTestId('wo-site-location');
  await section.getByRole('combobox', { name: /Material for daily reports comes from/ }).selectOption({ label: site.data.name });
  await expect.poll(async () => (await service.from('work_orders').select('site_warehouse_id').eq('id', woId).single()).data?.site_warehouse_id, { timeout: 15_000 }).toBe(site.data.id);

  await signIn(page, 'engineer@acme.test');
  await page.goto(`/site-reports/${reportId}`);
  await page.getByRole('combobox', { name: 'Used on contract item' }).selectOption({ label: lines[1].label });
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect.poll(async () => (await service.from('dsr_consumables').select('work_order_line_id').eq('report_id', reportId).single()).data?.work_order_line_id, { timeout: 15_000 }).toBe(lines[1].id);
  await expect(page.getByTestId('dsr-stock')).toHaveCount(0);   // nothing is issued before validation
});
