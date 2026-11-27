// @e2e-isolation: self-isolated — creates its own uniquely named item, unit, BoQ line, work order, site location, sections and requests each run (stock, request and section history are append-only or referenced, so none is deleted); sets the org's material-request chain (read only by this feature) to one Project Manager step.
/** AC-WOS-019 — goal: a project manager splits a work order into sections with foremen and planned amounts, a field controller requests material on one, the manager sets it ready, and the page's figures add up to the work order's (400 + 350 + 250 = 1,000; cable 40 + 10 + 20 = 70). */
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { requireServiceRoleKey, signIn } from './helpers';
import { inDays } from './support/jobJourney';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';
import { formatExactMoney } from '../src/lib/format';
import { SEED_PROJECT_ID, SEED_PROJECT_NAME, makeItem, runSuffix, userClient } from './support/stockFixture';

test.setTimeout(180_000);

async function fixture() {
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  const orgId = (await admin.from('projects').select('org_id').eq('id', SEED_PROJECT_ID).single()).data?.org_id as string;
  const item = await makeItem(admin, sfx, 'S');
  const draft = await admin.from('work_orders').insert({
    org_id: orgId, project_id: SEED_PROJECT_ID, title: `E2E sections ${sfx}`, order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0,
  }).select('id').single();
  if (draft.error) throw new Error('work order: ' + draft.error.message);
  let issue = await admin.rpc('transition_work_order', { p_id: draft.data.id, p_to: 'Issued' });
  if (issue.error && /acknowledg/i.test(issue.error.message)) issue = await admin.rpc('transition_work_order', { p_id: draft.data.id, p_to: 'Issued', p_over_commit_ack: true });
  if (issue.error) throw new Error('work order issue: ' + issue.error.message);
  const wo = await admin.from('work_orders').select('id, title, wo_number, currency').eq('id', draft.data.id).single();
  if (wo.error) throw new Error('work order: ' + wo.error.message);
  // The work order's planned cable: 100, from a BoQ material allowance prorated by its work-order line (the shipped plan source).
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-WOS-019 requires the local fixture service client');
  const service = createClient(requireMatchingLocalSupabaseUrls(undefined, undefined), serviceKey, { auth: { persistSession: false } });
  const boq = await service.from('boq_items').insert({ org_id: orgId, project_id: SEED_PROJECT_ID, item_code: `E2E-S${sfx}`, description: `E2E sections work ${sfx}`, unit: 'm3', quantity: 10, rate: 100 }).select('id').single();
  if (boq.error) throw new Error('boq: ' + boq.error.message);
  const line = await service.from('work_order_lines').insert({ org_id: orgId, work_order_id: wo.data.id, boq_item_id: boq.data.id, quantity: 10 });
  if (line.error) throw new Error('work order line: ' + line.error.message);
  const allowance = await service.from('boq_material_allowances').insert({ org_id: orgId, boq_item_id: boq.data.id, item_id: item.id, planned_quantity: 100 });
  if (allowance.error) throw new Error('allowance: ' + allowance.error.message);
  const chain = await admin.rpc('mrq_set_chain', { p_steps: [{ role: 'Project Manager', label: 'Plan check', only_over_plan: false }] });
  if (chain.error) throw new Error('chain: ' + chain.error.message);
  const foreman = await admin.from('profiles').select('id, full_name').eq('email', 'engineer@acme.test').single();
  if (foreman.error) throw new Error('foreman: ' + foreman.error.message);
  // The journey's own delivery location. With it the seed project always has several, so the form asks where the
  // material goes and the journey answers — instead of relying on no other test having added a location (they do).
  const site = await admin.from('stock_warehouses').insert({ code: `E2E-WS${sfx}`, name: `E2E site ${sfx}`, kind: 'site', project_id: SEED_PROJECT_ID }).select('id, code, name').single();
  if (site.error) throw new Error('site: ' + site.error.message);
  return { sfx, admin, item, wo: wo.data, foreman: foreman.data, site: site.data };
}

async function pick(page: Page, label: RegExp, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).click();
}

test('AC-WOS-019: sections with foremen and planned amounts, a request on one, readiness, and a roll-up that adds up', async ({ page }) => {
  const { admin, item, wo, foreman, site } = await fixture();
  const money = (v: string) => formatExactMoney(v, wo.currency, 'en-US', { wholeUnits: true }) as string;

  // The project manager adds two sections, each with a foreman, from the work-order page.
  await signIn(page, 'pm@acme.test');
  await page.goto(`/work-orders/${wo.id}`);
  const block = page.getByTestId('wo-page-sections');
  await expect(block.getByTestId('wo-sections-empty')).toBeVisible();
  for (const [code, name] of [['A', 'North block'], ['B', 'South block']] as const) {
    await block.getByRole('button', { name: 'Add section' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Code').fill(code);
    await dialog.getByLabel('Name').fill(name);
    await pick(page, /^foreman/i, foreman.full_name);
    await dialog.getByRole('button', { name: 'Save section' }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(block.getByTestId(`wo-section-${code}`)).toBeVisible();
  }
  await expect(block.getByTestId('wo-section-A')).toContainText(foreman.full_name);

  // Planned amount and planned cable for section A through the screen.
  await block.getByRole('button', { name: 'Actions for A' }).click();
  await page.getByRole('menuitem', { name: 'Plan', exact: true }).click();
  await page.getByRole('dialog').getByLabel(/^Direct budget/).fill('400');
  await page.getByRole('dialog').getByRole('button', { name: 'Save plan' }).click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15_000 });
  await expect(block.getByTestId('wo-section-plan-A')).toContainText(money('400.00'));

  await block.getByRole('button', { name: 'Actions for A' }).click();
  await page.getByRole('menuitem', { name: 'Material' }).click();
  const material = page.getByRole('dialog');
  await material.getByLabel('Item').selectOption({ label: `${item.code} · ${item.name}` });
  await material.getByLabel('Planned quantity').fill('60');
  await material.getByRole('button', { name: 'Add' }).click();
  await expect(material.getByTestId('wos-allocations')).toContainText('60.000');
  await material.getByRole('button', { name: 'Close', exact: true }).last().click();

  // The rest of the fixture (section B's figures, the unsectioned plan, two more requests) is written through the same
  // database paths the screens use, as the people who own them.
  const sections = await admin.from('work_order_sections').select('id, code').eq('work_order_id', wo.id);
  const sectionId = (code: string) => (sections.data ?? []).find((s) => s.code === code)?.id as string;
  const pm = await userClient('pm@acme.test');
  const plan = await pm.rpc('set_work_order_plan', { p_project_id: SEED_PROJECT_ID, p_work_order_id: wo.id, p_changes: [
    { kind: 'direct_budget', value: '350.00', section_id: sectionId('B') },
    { kind: 'direct_budget', value: '250.00' },
  ] });
  if (plan.error) throw new Error('plan: ' + plan.error.message);
  const alloc = await pm.from('work_order_section_material_plan').insert({ work_order_id: wo.id, section_id: sectionId('B'), item_id: item.id, quantity: 30 });
  if (alloc.error) throw new Error('allocation: ' + alloc.error.message);
  const engineer = await userClient('engineer@acme.test');
  for (const [section, qty] of [['B', 10], [null, 20]] as const) {
    const draft = await engineer.rpc('mrq_save_draft', {
      p_request_id: null,
      p_header: { work_order_id: wo.id, needed_by: inDays(5), ...(section ? { section_id: sectionId(section) } : {}) },
      p_lines: [{ item_id: item.id, quantity: qty, over_plan_reason: null }],
    });
    if (draft.error) throw new Error('draft: ' + draft.error.message);
    const sent = await engineer.rpc('mrq_submit', { p_request_id: draft.data });
    if (sent.error) throw new Error('submit: ' + sent.error.message);
  }

  // The field controller raises 40 cable on section A from the request form: within A's 60 and the plan of 100, so no reason is asked.
  await signIn(page, 'engineer@acme.test');
  await page.goto('/material-requests/new');
  await pick(page, /^project/i, SEED_PROJECT_NAME);
  await pick(page, /^work order/i, `${wo.wo_number} · ${wo.title}`);
  await page.getByLabel('Section', { exact: true }).selectOption({ label: 'A · North block' });
  await page.getByLabel('Deliver to').selectOption({ label: `${site.code} · ${site.name}` });
  await page.getByLabel(/^item/i).selectOption({ label: `${item.code} · ${item.name}` });
  await page.getByLabel(/^quantity/i).fill('40');
  await expect(page.getByTestId('mrq-section-plan-qty')).toContainText(/^60\b/);
  await expect(page.getByLabel(/why do you need more than the plan/i)).toHaveCount(0);
  await page.getByRole('button', { name: 'Send for approval' }).click();
  await expect(page).toHaveURL(/\/material-requests\/[0-9a-f-]{36}$/, { timeout: 20_000 });

  // The manager marks section A ready and reads the roll-up.
  await signIn(page, 'pm@acme.test');
  await page.goto(`/work-orders/${wo.id}`);
  const roll = page.getByTestId('wo-page-sections');
  await roll.getByRole('combobox', { name: 'Readiness of A' }).selectOption('ready');
  await expect(roll.getByText('1 of 2 ready')).toBeVisible({ timeout: 15_000 });

  // AC-WOS-002: 400 + 350 + 250 = 1,000, and cable requested 40 + 10 + 20 = 70.
  await expect(roll.getByTestId('wo-section-plan-A')).toContainText(money('400.00'));
  await expect(roll.getByTestId('wo-section-plan-B')).toContainText(money('350.00'));
  await expect(roll.getByTestId('wo-section-plan-remainder')).toContainText(money('250.00'));
  await roll.getByTestId('wo-sections-material').locator('summary').click();
  const requested = async (testId: string) => Number((await roll.getByTestId(testId).locator('td').nth(2).innerText()).trim());
  const a = await requested(`wo-material-A-${item.id}`);
  const b = await requested(`wo-material-B-${item.id}`);
  const rest = await requested(`wo-material-remainder-${item.id}`);
  expect([a, b, rest]).toEqual([40, 10, 20]);
  expect(a + b + rest).toBe(70);
});


test('AC-WOS-020: the engineer reads section progress for live tasks only', async ({ page }) => {
  const { admin, wo } = await fixture();
  const section = await admin.from('work_order_sections').insert({ work_order_id: wo.id, code: 'P', name: 'Progress' }).select('id').single();
  if (section.error) throw section.error;
  const tasks = await admin.from('tasks').insert([
    { project_id: SEED_PROJECT_ID, work_order_id: wo.id, section_id: section.data.id, name: 'Live leaf', status: 'To Do' },
    { project_id: SEED_PROJECT_ID, work_order_id: wo.id, section_id: section.data.id, name: 'Deleted leaf', status: 'Done', tombstoned_at: new Date().toISOString() },
  ]);
  if (tasks.error) throw tasks.error;
  await signIn(page, 'engineer@acme.test');
  await page.goto(`/work-orders/${wo.id}`);
  await expect(page.getByTestId('wo-section-P')).toContainText('0 of 1 tasks done');
});
