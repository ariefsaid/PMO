// @e2e-isolation: serial — turns the org-wide "hide prices from requesters" setting and the monthly plan on (Admin) and restores them; the project and its plan are this run's own.
/**
 * JOB-HPG plan (#2788) — with prices hidden, the Engineer who wrote a month's equipment plan opens it, moves a line's end date and
 * saves: the rate and vendor they cannot see stay as stored. Finance reads the original rate afterwards.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signIn } from '../helpers';
import { ORG_ID, serviceClient } from '../support/jobFixtures';
import { orgToday } from '../support/jobJourney';
import { runSuffix, userClient } from '../support/stockFixture';

test.setTimeout(120_000);

const ENGINEER_EMAIL = 'engineer@acme.test';
const sfx = runSuffix();
const projectName = `E2E hidden plan ${sfx}`;
const lineId = randomUUID();
const month = `${orgToday().slice(0, 7)}-01`;
let vendorId = '';
let pricesWereHidden = false;

test.beforeAll(async () => {
  const admin = await userClient('admin@acme.test');
  const org = await serviceClient('JOB-HPG plan').from('organizations').select('hide_prices_from_requesters').eq('id', ORG_ID).single();
  if (org.error) throw new Error('hide-prices setting read: ' + org.error.message);
  pricesWereHidden = Boolean((org.data as { hide_prices_from_requesters: boolean }).hide_prices_from_requesters);
  const on = await admin.rpc('set_equipment_plan_settings', { p_enabled: true, p_approval_step: 'spend_approvers', p_allow_self_approval: false });
  if (on.error) throw new Error('plan settings: ' + on.error.message);
  const project = await admin.from('projects').insert({ name: projectName, status: 'Internal Project' }).select('id').single();
  if (project.error) throw new Error('project: ' + project.error.message);
  const vendor = await admin.from('companies').select('id').eq('type', 'Vendor').limit(1).single();
  if (vendor.error) throw new Error('vendor: ' + vendor.error.message);
  vendorId = vendor.data.id as string;
  // The Engineer's saved Draft: one line at 1,500 from that vendor.
  const engineer = await userClient(ENGINEER_EMAIL);
  const saved = await engineer.rpc('save_equipment_plan', { p_id: randomUUID(), p_project: project.data.id, p_month: month, p_lines: [
    { id: lineId, description: `Crane ${sfx}`, quantity: 1, rate: 1500, vendor_id: vendorId, date_from: month.replace(/01$/, '03'), date_to: month.replace(/01$/, '10') }] });
  if (saved.error) throw new Error('plan: ' + saved.error.message);
  const hide = await admin.rpc('set_hide_prices_enabled', { p_enabled: true });
  if (hide.error) throw new Error('hide prices: ' + hide.error.message);
});

test.afterAll(async () => {
  const admin = await userClient('admin@acme.test');
  const problems: string[] = [];
  if (!pricesWereHidden) {
    const r = await admin.rpc('set_hide_prices_enabled', { p_enabled: false });
    if (r.error) problems.push('restore hide prices: ' + r.error.message);
  }
  const off = await admin.rpc('set_equipment_plan_settings', { p_enabled: false, p_approval_step: 'spend_approvers', p_allow_self_approval: false });
  if (off.error) problems.push('plan settings reset: ' + off.error.message);
  if (problems.length) throw new Error(problems.join('; '));
});

test('JOB-HPG the Engineer moves a date on their saved plan while prices are hidden, and the stored rate stays', async ({ page }) => {
  await signIn(page, ENGINEER_EMAIL);
  await page.goto('/equipment-plans');
  await page.getByLabel('Project', { exact: true }).click();
  await page.getByRole('option', { name: new RegExp(projectName) }).click();
  const line = page.getByTestId('plan-line');
  await line.getByRole('button', { name: 'Edit line 1', exact: true }).click();
  await expect(line.getByLabel('What is needed')).toHaveValue(`Crane ${sfx}`, { timeout: 20_000 });
  await expect(line.getByLabel('Rate')).toHaveValue('');
  const newEnd = month.replace(/01$/, '12');
  await line.getByLabel('To').fill(newEnd);
  await page.getByRole('button', { name: 'Save draft' }).click();

  const finance = await userClient('finance@acme.test');
  await expect.poll(async () => {
    const r = await finance.from('equipment_plan_lines').select('rate, vendor_id, date_to').eq('id', lineId).single();
    return r.error ? r.error.message : [Number(r.data.rate), r.data.vendor_id, r.data.date_to];
  }, { timeout: 20_000 }).toEqual([1500, vendorId, newEnd]);
});
