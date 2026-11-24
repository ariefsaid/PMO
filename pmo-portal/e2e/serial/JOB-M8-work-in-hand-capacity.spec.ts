// @e2e-isolation: serial — sets the organisation-wide work_in_hand_monthly_capacity for the run and restores the previous capacity and removes owned rows in finally.
/**
 * JOB-M8 — Admin sets monthly work capacity; Executive views Value of work in hand and Months of work in hand
 * on the Management Dashboard and under Projects (including /projects/work-in-hand), with another currency
 * shown separately and stated as not included in months (no conversion).
 */
import { test, expect } from '@playwright/test';
import { signIn, visibleToast } from '../helpers';
import { ORG_ID, need, runId, serviceClient } from '../support/jobFixtures';

test.setTimeout(180_000);

test('JOB-M8 Admin sets monthly capacity and Executive checks work in hand on dashboard and under Projects', async ({ page }) => {
  const svc = serviceClient('JOB-M8');
  const run = runId('m8');
  const createdProjects: string[] = [];
  let previousCapacity: number | null = null;
  let capacityTouched = false;

  try {
    const org = need(
      'org read',
      await svc.from('organizations').select('default_currency, work_in_hand_monthly_capacity').eq('id', ORG_ID).single(),
    );
    const orgCurrency = org.default_currency ?? 'USD';
    const otherCurrency = orgCurrency === 'USD' ? 'IDR' : 'USD';
    previousCapacity = org.work_in_hand_monthly_capacity === null ? null : Number(org.work_in_hand_monthly_capacity);

    // Clear capacity first so Executive verifies the sensible empty state before Admin configures it.
    need('clear capacity', await svc.from('organizations').update({ work_in_hand_monthly_capacity: null }).eq('id', ORG_ID).select('id').single());
    capacityTouched = true;

    const orgProject = need(
      'org currency project',
      await svc.from('projects').insert({
        org_id: ORG_ID,
        name: `${run} org contract`,
        status: 'Ongoing Project',
        contract_value: 20_000_000,
        tax_treatment: 'exclusive',
        tax_amount: 0,
        currency: orgCurrency,
      }).select('id').single(),
    );
    createdProjects.push(orgProject.id);

    const foreignProject = need(
      'other currency project',
      await svc.from('projects').insert({
        org_id: ORG_ID,
        name: `${run} foreign contract`,
        status: 'Ongoing Project',
        contract_value: 500_000,
        tax_treatment: 'exclusive',
        tax_amount: 0,
        currency: otherCurrency,
      }).select('id').single(),
    );
    createdProjects.push(foreignProject.id);

    // 1. Admin verifies the empty state and sets monthly capacity in the organisation's currency.
    await signIn(page, 'admin@acme.test');
    await page.goto('/administration/projects#work-in-hand-capacity');
    const capacitySection = page.locator('#work-in-hand-capacity');
    await expect(capacitySection).toBeVisible();
    await expect(capacitySection).toContainText('Not set: months of work in hand is not calculated until a monthly capacity is entered.');

    const input = capacitySection.getByLabel(`Monthly capacity (${orgCurrency})`);
    await input.fill('5000000');
    await capacitySection.getByRole('button', { name: 'Save capacity' }).click();
    await expect(visibleToast(page, 'Monthly work capacity saved')).toBeVisible();

    // 2. Executive verifies Management Dashboard and Projects -> Work in hand.
    await signIn(page, 'exec@acme.test');
    await page.goto('/');
    const dashCard = page.getByTestId('dashboard-work-in-hand');
    await expect(dashCard).toBeVisible();
    await expect(dashCard.getByTestId('dashboard-work-in-hand-months')).toContainText(/\d+\.\d+\s+months/);
    await expect(dashCard.getByTestId('dashboard-work-in-hand-other-currencies')).toContainText('Other currencies (not included in months)');

    await page.goto('/projects');
    const projectsCard = page.getByTestId('projects-work-in-hand');
    await expect(projectsCard).toBeVisible();
    await expect(projectsCard.getByTestId('projects-work-in-hand-months')).toContainText(/\d+\.\d+\s+months/);
    await projectsCard.getByTestId('projects-work-in-hand-link').click();

    await expect(page).toHaveURL(/\/projects\/work-in-hand/);
    const wihSummary = page.getByTestId('wih-capacity-summary');
    await expect(wihSummary).toBeVisible();
    await expect(wihSummary.getByTestId('wih-capacity-summary-months')).toContainText(/\d+\.\d+\s+months/);
    await expect(wihSummary.getByTestId('wih-capacity-summary-other-currencies')).toContainText('Other currencies (not included in months)');
  } finally {
    if (capacityTouched) {
      await svc.from('organizations').update({ work_in_hand_monthly_capacity: previousCapacity }).eq('id', ORG_ID);
    }
    if (createdProjects.length > 0) {
      await svc.from('projects').delete().in('id', createdProjects);
    }
  }
});
