// @e2e-isolation: serial — turns the org-wide built-in roles setting on, gives the seeded Engineer a built-in role and sets the org's material-request chain; restores all three (try/finally).
import { test, expect, type Page } from '@playwright/test';
import { signIn, pinEnglishLocale } from '../helpers';
import { ORG_ID, need, serviceClient } from '../support/jobFixtures';
import { mrqSetup, submittedRequest } from '../support/mrqJobFixture';
import { runSuffix, userClient } from '../support/stockFixture';

/**
 * AC-RTD-017 (roles that decide, docs/specs/roles-that-decide.spec.md) — goal: an Admin sets an approval step to a built-in role on
 * the settings screen, and the person who holds that role approves it in order, then the next step's approver finishes the request.
 */
test.setTimeout(240_000);

const ENGINEER = 'engineer@acme.test';

async function decide(page: Page, email: string, requestUrl: string, source?: string) {
  await signIn(page, email);
  await page.goto(requestUrl);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  if (source) await dialog.getByLabel(/warehouse the material leaves from/i).selectOption({ label: source });
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

test('AC-RTD-017: an Admin sets a step to a built-in role and its holder approves the request in order', async ({ page }) => {
  const svc = serviceClient('AC-RTD-017');
  const org = need('read the setting', await svc.from('organizations').select('built_in_roles_enabled').eq('id', ORG_ID).single());
  const engineer = need('read the engineer', await svc.from('profiles').select('id, built_in_role').eq('email', ENGINEER).single());
  const chainBefore = need('read the chain', await svc.from('approval_chain_steps').select('role, job_role, label, only_over_plan').eq('org_id', ORG_ID).order('position'));
  try {
    need('turn built-in roles on', await svc.from('organizations').update({ built_in_roles_enabled: true }).eq('id', ORG_ID).select('id').single());
    need('give the engineer a role', await svc.from('profiles').update({ built_in_role: 'material_coordinator' }).eq('id', engineer.id).select('id').single());
    // Two plain steps to start from: a stock check at the Engineer level, then the Admin.
    const { admin, item, wo } = await mrqSetup([{ role: 'Engineer', label: 'Stock check' }, { role: 'Admin', label: 'Stock' }]);
    const sfx = runSuffix();
    const wh = need('warehouse', await admin.from('stock_warehouses').insert({ code: `E2E-RTD${sfx}`, name: `E2E RTD ${sfx}`, kind: 'central' }).select('id, code, name').single());

    // The Admin points step 1 at the Material Coordinator role on the settings screen.
    await pinEnglishLocale(page);
    await signIn(page, 'admin@acme.test');
    await page.goto('/material-requests/settings');
    const step1 = page.getByTestId('chain-step').first();
    await step1.getByLabel('Built-in role that decides').selectOption('material_coordinator');
    await expect(step1.getByLabel('Role', { exact: true })).toBeDisabled();
    await expect(step1.getByText('Set by the built-in role.')).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Approval chain saved', { exact: true })).toBeVisible();

    // A Project Manager raises a request; the Material Coordinator approves step 1, then the Admin step 2.
    const requestId = await submittedRequest('pm@acme.test', wo.id, item.id);
    const requestUrl = `/material-requests/${requestId}`;
    await decide(page, ENGINEER, requestUrl);
    await decide(page, 'admin@acme.test', requestUrl, `${wh.code} · ${wh.name}`);

    await page.goto(requestUrl);
    await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('mrq-chain').getByText('Approved')).toHaveCount(2);
  } finally {
    const steps = chainBefore.map((s) => (s.job_role ? { job_role: s.job_role, label: s.label, only_over_plan: s.only_over_plan }
      : { role: s.role, label: s.label, only_over_plan: s.only_over_plan }));
    const admin = await userClient('admin@acme.test');
    await admin.rpc('mrq_set_chain', { p_steps: steps });
    await svc.from('profiles').update({ built_in_role: engineer.built_in_role }).eq('id', engineer.id);
    await svc.from('organizations').update({ built_in_roles_enabled: org.built_in_roles_enabled }).eq('id', ORG_ID);
  }
});
