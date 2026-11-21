// @e2e-isolation: self-isolated — creates its own uniquely named item, contract line (with a unique work unit no other standard matches), work order, site location and standard each run; archives its standard afterwards; sets the org's material-request chain (read only by this feature) to a single Project Manager step.
/** AC-CUS-015 — goal: a planner turns a usage standard into a consumable plan for a work order, and a site user's request is checked against that plan: the form shows the generated figure with its source, asks for a reason when over it, and the request goes through. */
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signIn, requireServiceRoleKey } from './helpers';
import { SEED_PROJECT_ID, SEED_PROJECT_NAME, makeItem, runSuffix, userClient } from './support/stockFixture';

test.setTimeout(180_000);

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';

async function fixture() {
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  const orgId = (await admin.from('projects').select('org_id').eq('id', SEED_PROJECT_ID).single()).data?.org_id as string;
  const rod = await makeItem(admin, sfx, 'R');
  const gas = await makeItem(admin, `${sfx}G`, 'G');
  // The work unit is unique to this run, so no other organisation-wide standard can match this work order's line.
  const unit = `weld${sfx.toLowerCase()}`;
  const boq = await admin.from('boq_items').insert({ project_id: SEED_PROJECT_ID, item_code: `WLD-${sfx}`, description: `E2E weld ${sfx}`, unit, quantity: 160, rate: 1000 }).select('id').single();
  if (boq.error) throw new Error('boq: ' + boq.error.message);
  const draft = await admin.from('work_orders').insert({
    org_id: orgId, project_id: SEED_PROJECT_ID, title: `E2E CUS ${sfx}`, order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0,
  }).select('id').single();
  if (draft.error) throw new Error('work order: ' + draft.error.message);
  // The allocation of a contract line to the work order is written by the service role (no client grant on the table here, as in the other journeys).
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-CUS-015 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  const service = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  const lines = await service.from('work_order_lines').insert({ org_id: orgId, work_order_id: draft.data.id, boq_item_id: boq.data.id, quantity: 160 });
  if (lines.error) throw new Error('allocation: ' + lines.error.message);
  let issue = await admin.rpc('transition_work_order', { p_id: draft.data.id, p_to: 'Issued' });
  if (issue.error && /acknowledg/i.test(issue.error.message)) issue = await admin.rpc('transition_work_order', { p_id: draft.data.id, p_to: 'Issued', p_over_commit_ack: true });
  if (issue.error) throw new Error('work order issue: ' + issue.error.message);
  const wo = await admin.from('work_orders').select('id, title, wo_number').eq('id', draft.data.id).single();
  if (wo.error) throw new Error('work order: ' + wo.error.message);
  const chain = await admin.rpc('mrq_set_chain', { p_steps: [{ role: 'Project Manager', label: 'Plan check', only_over_plan: false }] });
  if (chain.error) throw new Error('chain: ' + chain.error.message);
  // The journey's own delivery location. With it the seed project always has several, so the form asks where the
  // material goes and the journey answers — instead of relying on no other test having added a location (they do).
  const site = await admin.from('stock_warehouses').insert({ code: `E2E-CU${sfx}`, name: `E2E site ${sfx}`, kind: 'site', org_id: orgId, project_id: SEED_PROJECT_ID }).select('id, code, name').single();
  if (site.error) throw new Error('site: ' + site.error.message);
  return { admin, sfx, rod, gas, unit, wo: wo.data, site: site.data };
}

async function pick(page: Page, label: RegExp, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).click();
}

test('AC-CUS-015: a planner adds a standard, generates the work order\'s consumable plan and adjusts a line; a site user\'s request shows the plan figure and its source, asks for a reason when over it, and submits', async ({ page }) => {
  const { admin, rod, gas, unit, wo, site } = await fixture();
  try {
    // Planner: the standard (welding rod per unit of work, 10% waste, for contract lines starting WLD).
    await signIn(page, 'admin@acme.test');
    await page.goto('/stock/usage-standards');
    await page.getByRole('button', { name: 'New standard' }).click();
    await page.getByLabel(/^Consumable/).selectOption({ label: `${rod.code} · ${rod.name}` });
    await page.getByLabel(/^Unit of work/).fill(unit);
    await page.getByLabel(/^Contract line code starts with/).fill('WLD');
    await page.getByLabel(/^Quantity per unit of work/).fill('0.05');
    await page.getByLabel('Waste margin %').fill('10');
    await page.getByRole('button', { name: 'Add standard' }).click();
    await page.getByLabel('Work unit').fill(unit);
    await expect(page.getByRole('row').filter({ hasText: unit })).toContainText(rod.code, { timeout: 15_000 });
    await expect(page.getByRole('row').filter({ hasText: unit })).toContainText('1 lines');

    // Planner: generate the plan on the work order: (160 x 0.05 x 1.10) = 8.8.
    await page.goto(`/work-orders/${wo.id}`);
    const plan = page.getByTestId('consumable-plan');
    await plan.getByRole('button', { name: 'Generate plan' }).click();
    await expect(plan.getByTestId(`consumable-row-${rod.id}`)).toContainText('Plan 8.8', { timeout: 15_000 });
    await expect(plan.getByTestId(`consumable-row-${rod.id}`)).toContainText('From standards');

    // Planner: a consumable no standard covers is added with its reason.
    await plan.getByRole('button', { name: 'Add item' }).click();
    await page.getByLabel(/^Item/).selectOption({ label: `${gas.code} · ${gas.name}` });
    await page.getByLabel(/^Planned quantity/).fill('3');
    await page.getByLabel(/^Why is this different/).fill('Site gas, no standard yet');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(plan.getByTestId(`consumable-row-${gas.id}`)).toContainText('Adjusted', { timeout: 15_000 });
    await expect(plan.getByTestId(`consumable-row-${gas.id}`)).toContainText('Plan 3');

    // Site user raises a request for 9 of the rod: over the plan of 8.8, so a reason is asked for.
    await signIn(page, 'engineer@acme.test');
    await page.goto('/material-requests/new');
    await pick(page, /^project/i, SEED_PROJECT_NAME);
    await pick(page, /^work order/i, `${wo.wo_number} · ${wo.title}`);
    await page.getByLabel('Deliver to').selectOption({ label: `${site.code} · ${site.name}` });
    await page.getByLabel(/^item/i).selectOption({ label: `${rod.code} · ${rod.name}` });
    await page.getByLabel(/^quantity/i).fill('9');
    await expect(page.getByTestId('mrq-plan')).toContainText('Plan 8.8');
    await expect(page.getByTestId('mrq-plan-source')).toContainText('From usage standards');
    await expect(page.getByTestId('mrq-plan')).toContainText('Over plan');
    await page.getByRole('button', { name: 'Send for approval' }).click();
    await expect(page.getByText(/give a reason/i)).toBeVisible();
    await page.getByLabel(/why do you need more than the plan/i).fill('Extra pipe spools');
    await page.getByRole('button', { name: 'Send for approval' }).click();
    await expect(page).toHaveURL(/\/material-requests\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await expect(page.getByTestId('mrq-detail-plan-source')).toContainText('From usage standards');
  } finally {
    // Standards are archived, never deleted (ADR-0018); this run's unique unit keeps it from matching anything else.
    await admin.from('consumable_usage_standards').update({ archived_at: new Date().toISOString() }).eq('work_unit', unit);
  }
});
