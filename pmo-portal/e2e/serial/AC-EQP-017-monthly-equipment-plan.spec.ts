// @e2e-isolation: serial - switches the org-wide purchase-types flag and the monthly plan on and off (the rental-extension journey flips the same flag, so the two cannot share the parallel lane); each run creates its own uniquely named project, so its plan (append-only) never collides with another run's. It also names that run's own project approver (one `spend_approvers` row on the project it just created, removed in afterAll), which is project-scoped and reaches no other journey.
/** AC-EQP-017 — goal: a planner drafts and submits the month's equipment plan on a phone; the plan names the one approver its project lists, with that person's current role; an approver approves it; the rental orders appear as Drafts linked from the plan; approving again creates none. Also captures the evidence screenshots (phone 390 and desktop 1440, 2x) for the two new screens. */
import { test, expect } from '@playwright/test';
import { signIn } from '../helpers';
import { runSuffix, userClient } from '../support/stockFixture';

const EVIDENCE = '../docs/evidence/1215/2700';
test.setTimeout(240_000);

const ADMIN_EMAIL = 'admin@acme.test';
const AUTHOR_EMAIL = 'engineer@acme.test';
const sfx = runSuffix();
const projectName = `E2E plan project ${sfx}`;
let projectId = '';
/** The journey's own fixture facts for job 3's oracle: who the project lists, and who wrote the plan. */
let approverName = '';
let authorName = '';

test.beforeAll(async () => {
  const admin = await userClient(ADMIN_EMAIL);
  const types = await admin.rpc('set_purchase_types_enabled', { p_enabled: true });
  if (types.error) throw new Error('purchase types: ' + types.error.message);
  // spend_approvers: the project names the one approver below, so the journey knows EXACTLY who is eligible and can assert
  // the waiting sentence names that person and their current role (job 3's goal), not merely that something is waiting.
  const on = await admin.rpc('set_equipment_plan_settings', { p_enabled: true, p_approval_step: 'spend_approvers', p_allow_self_approval: false });
  if (on.error) throw new Error('plan settings: ' + on.error.message);
  const cat = await admin.rpc('upsert_equipment_plan_category', { p_id: null, p_name: `Cranes ${sfx}`, p_name_id: `Derek ${sfx}`, p_position: 1 });
  if (cat.error) throw new Error('category: ' + cat.error.message);
  const project = await admin.from('projects').insert({ name: projectName, status: 'Internal Project' }).select('id').single();
  if (project.error) throw new Error('project: ' + project.error.message);
  projectId = project.data.id as string;
  const people = await admin.from('profiles').select('id, full_name, email').in('email', [ADMIN_EMAIL, AUTHOR_EMAIL]);
  if (people.error) throw new Error('people: ' + people.error.message);
  const approver = (people.data ?? []).find((p) => p.email === ADMIN_EMAIL);
  const author = (people.data ?? []).find((p) => p.email === AUTHOR_EMAIL);
  if (!approver || !author) throw new Error('people: the seeded Admin and Engineer must both exist');
  approverName = approver.full_name as string;
  authorName = author.full_name as string;
  const named = await admin.from('spend_approvers').insert({ project_id: projectId, profile_id: approver.id });
  if (named.error) throw new Error('plan approver: ' + named.error.message);
});
test.afterAll(async () => {
  const admin = await userClient(ADMIN_EMAIL);
  await admin.from('spend_approvers').delete().eq('project_id', projectId);
  await admin.rpc('set_equipment_plan_settings', { p_enabled: false, p_approval_step: 'spend_approvers', p_allow_self_approval: false });
  // Purchase types stay on: they are on for every organisation (#2746).
});

const chooseProject = async (page: import('@playwright/test').Page) => {
  await page.getByLabel('Project', { exact: true }).click();
  await page.getByRole('option', { name: new RegExp(projectName) }).click();
};

test.describe('phone planner, desktop approver', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2 });

  test('AC-EQP-017: a plan is drafted and submitted on a phone, approved on a desktop, and its rental orders are Drafts linked from the plan; approving twice creates none', async ({ page, browser }) => {
    // planner
    await signIn(page, AUTHOR_EMAIL);
    await page.goto('/equipment-plans');
    await expect(page.getByRole('heading', { name: 'Monthly equipment plan', level: 1 })).toBeVisible();
    await chooseProject(page);
    await page.getByRole('button', { name: 'Add line' }).click();
    const line = page.getByTestId('plan-line');
    await line.getByLabel('What is needed').fill(`Mobile crane ${sfx}`);
    await line.getByLabel('Vendor', { exact: true }).click();
    await page.getByRole('option', { name: /SunVolt Modules/ }).click();
    await line.getByLabel('Category').selectOption({ label: `Cranes ${sfx}` });
    await line.getByLabel('Rate').fill('1500');
    await expect(page.getByTestId('plan-total')).toContainText('1,500');
    await page.screenshot({ path: `${EVIDENCE}/plan-phone-390.png`, fullPage: true });
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(page.getByText('Waiting for approval').first()).toBeVisible({ timeout: 20_000 });
    // job 3's goal on this screen: the plan says WHO it waits for — the one approver this project lists, with that
    // person's current role, from the route the database computes. The name/role are this journey's own fixture facts
    // (the approver row above + the seeded profile), so a generic "Waiting for" substring cannot satisfy it.
    const waitingFor = page.getByTestId('plan-waiting-for');
    await expect(waitingFor).toHaveText(`Waiting for ${approverName}, Admin`, { timeout: 20_000 });
    await expect(waitingFor).not.toContainText(authorName); // self-approval is off: the author is not named
    // the author cannot approve their own plan: no approve control
    await expect(page.getByRole('button', { name: 'Approve and create orders' })).toHaveCount(0);

    // approver, on a desktop
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const dp = await desktop.newPage();
    await signIn(dp, ADMIN_EMAIL);
    await dp.goto('/equipment-plans');
    await chooseProject(dp);
    await expect(dp.getByTestId('plan-line')).toHaveCount(1);
    await dp.screenshot({ path: `${EVIDENCE}/plan-desktop-1440.png`, fullPage: true });
    await dp.getByRole('button', { name: 'Approve and create orders' }).first().click();
    await dp.getByRole('dialog').getByRole('button', { name: 'Approve and create orders' }).click();
    await expect(dp.getByText('Approved').first()).toBeVisible({ timeout: 30_000 });
    const link = dp.getByTestId('plan-line-order');
    await expect(link).toBeVisible();
    await expect(dp.getByRole('button', { name: 'Approve and create orders' })).toHaveCount(0);

    // the order is a separate Draft purchase of the rental type
    await link.click();
    await expect(dp).toHaveURL(/\/procurement\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await expect(dp.getByText('Draft').first()).toBeVisible();
    await expect(dp.getByText(`Mobile crane ${sfx}`).first()).toBeVisible();

    // approving again (a retry) creates nothing more: one purchase on the project still
    const admin = await userClient(ADMIN_EMAIL);
    const plan = await admin.from('equipment_plans').select('id').eq('project_id', projectId).single();
    expect(plan.error).toBeNull();
    const again = await admin.rpc('approve_equipment_plan', { p_id: plan.data!.id });
    expect(again.error).toBeNull();
    const orders = await admin.from('procurements').select('id').eq('project_id', projectId);
    expect(orders.data).toHaveLength(1);
    await desktop.close();
  });

  test('AC-EQP-017: the Admin settings screen on a phone (evidence)', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/equipment-plans/settings');
    await expect(page.getByRole('heading', { name: 'Monthly plan settings', level: 1 })).toBeVisible();
    await expect(page.getByTestId('plan-category-row').first()).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/settings-phone-390.png`, fullPage: true });
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  test('AC-EQP-017: the Admin settings screen on a desktop (evidence)', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/equipment-plans/settings');
    await expect(page.getByTestId('plan-category-row').first()).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/settings-desktop-1440.png`, fullPage: true });
  });
});
