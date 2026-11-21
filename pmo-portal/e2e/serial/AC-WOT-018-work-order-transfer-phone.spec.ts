// @e2e-isolation: serial - turns the organisation's "work-order transfers" setting on for the journey (an org-wide switch the Stock menu reads); reset in afterEach.
/** AC-WOT-018 — a keeper moves leftover from one work order to another on a phone, and both work orders' balances change as stated. */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signIn } from '../helpers';
import { serviceClient } from '../support/jobFixtures';
import { makeItem, makeWorkItem, postReceive, runSuffix, userClient, SEED_PROJECT_ID, SEED_PROJECT_NAME } from '../support/stockFixture';

test.setTimeout(240_000);

let admin: SupabaseClient | undefined;
test.afterEach(async () => { if (admin) await admin.rpc('set_stock_wo_transfers', { p_on: false }); });

test('AC-WOT-018 a keeper moves 4 leftover from one work order to another on a phone and both balances follow', async ({ page }) => {
  const sfx = runSuffix();
  admin = await userClient('admin@acme.test');
  const service = serviceClient('AC-WOT-018');
  const project = await service.from('projects').select('org_id,currency').eq('id', SEED_PROJECT_ID).single();
  if (project.error) throw project.error;
  const mkWo = async (tag: string) => {
    const id = randomUUID();
    const wo = await service.from('work_orders').insert({ id, org_id: project.data.org_id, project_id: SEED_PROJECT_ID, title: `Move ${tag} ${sfx}`, wo_number: `WO-${tag}${sfx}`,
      status: 'Issued', issued_at: new Date().toISOString(), order_value: 10000, tax_treatment: 'exclusive', tax_amount: 0, currency: project.data.currency });
    if (wo.error) throw wo.error;
    return { id, label: `WO-${tag}${sfx} - Move ${tag} ${sfx}` };
  };
  const a = await mkWo('A');
  const b = await mkWo('B');
  const item = await makeItem(admin, sfx, 'M');
  const work = await makeWorkItem(admin, sfx);
  const site = await admin.from('stock_warehouses').insert({ code: `E2E-WS${sfx}`, name: `Move site ${sfx}`, kind: 'site', project_id: SEED_PROJECT_ID }).select('id,code,name').single();
  if (site.error) throw site.error;
  await postReceive(admin, site.data.id, item.id, '10', '25');
  const issue = await admin.rpc('create_stock_document', { p_header: { kind: 'issue', warehouse_id: site.data.id, project_id: SEED_PROJECT_ID }, p_lines: [{ item_id: item.id, quantity: '6', boq_item_id: work.id }], p_post: true });
  if (issue.error) throw issue.error;
  const attr = await admin.rpc('set_cost_attribution', { p_source: 'stock_document', p_ids: [issue.data], p_work_order_id: a.id, p_discipline_id: null });
  if (attr.error) throw attr.error;
  const on = await admin.rpc('set_stock_wo_transfers', { p_on: true });
  expect(on.error).toBeNull();

  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'admin@acme.test');
  await page.goto('/stock/documents');
  await page.getByRole('button', { name: /New document/ }).click();
  await page.getByRole('menuitem', { name: 'Move leftover to another work order' }).click();
  await page.getByRole('combobox', { name: /^Project/ }).selectOption({ label: SEED_PROJECT_NAME });
  await page.getByRole('combobox', { name: /From work order/ }).selectOption({ label: a.label });
  await page.getByRole('combobox', { name: /To work order/ }).selectOption({ label: b.label });
  await page.getByRole('combobox', { name: /Where the material is/ }).selectOption({ label: `${site.data.code} - ${site.data.name}` });
  await page.getByRole('combobox', { name: /Item1/ }).selectOption({ label: `${item.code} - ${item.name}` });
  await expect(page.getByText(/Held by the work order: 6/)).toBeVisible();
  await page.getByRole('textbox', { name: /Quantity1/ }).fill('4');
  await page.getByRole('button', { name: 'Move to the other work order' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Move to the other work order' }).click();

  await expect(page.getByRole('heading', { name: /Work-order transfer WOT-/ })).toBeVisible();
  await expect(page.getByText('Return from the first work order')).toBeVisible();
  await expect(page.getByText('Issue to the second work order')).toBeVisible();

  // Both balances: A kept 2 of the 6 it was issued, B holds the 4; the site's stock did not move.
  const held = async (wo: string) => {
    const r = await admin!.rpc('get_work_order_returnable', { p_work_order_id: wo });
    if (r.error) throw r.error;
    return Number((r.data as { item_id: string; quantity: string }[]).find((x) => x.item_id === item.id)?.quantity ?? 0);
  };
  expect(await held(a.id)).toBe(2);
  expect(await held(b.id)).toBe(4);
  const bal = await admin.from('stock_balances').select('qty_on_hand').eq('warehouse_id', site.data.id).eq('item_id', item.id).single();
  expect(Number(bal.data?.qty_on_hand)).toBe(4);
});
