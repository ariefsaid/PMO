// @e2e-isolation: self-isolated — disposable job-role logins and two disposable projects, all removed after.
import { test, expect, type Page } from '@playwright/test';
import { roleJobUser } from './support/roleJobUser';
import { need, ORG_ID, PM_ID, serviceClient, orgToday, inDays } from './support/jobJourney';
import { pinEnglishLocale } from './helpers';

// AC-PS1-001 — a Project Manager reads money for their own projects only (owner rulings DD-R1125-14/15).
// AC-004 (PS3) — a job role at the same access level that works across projects (Procurement Manager) keeps those reads.
// Project A is managed by the journey's Project Manager, project B by the seeded one. Each has one submitted invoice.

type Fixture = { db: ReturnType<typeof serviceClient>; nameA: string; nameB: string; own: string; other: string };

async function withProjects(label: string, managerOfA: (db: Fixture['db']) => Promise<string>, body: (f: Fixture) => Promise<void>) {
  const db = serviceClient(label); const must = need(label);
  const short = crypto.randomUUID().slice(0, 8);
  const nameA = `PS1 own ${short}`; const nameB = `PS1 other ${short}`;
  const ids: string[] = []; const invoices: string[] = [];
  try {
    const managerA = await managerOfA(db);
    for (const [name, manager, amount] of [[nameA, managerA, 100], [nameB, PM_ID, 200]] as const) {
      const project = must('project', await db.from('projects').insert({ org_id: ORG_ID, name, status: 'Ongoing Project', currency: 'USD',
        contract_value: 1000, tax_treatment: 'exclusive', tax_amount: 0, project_manager_id: manager, start_date: inDays(-30), end_date: inDays(60) }).select('id').single()).id;
      ids.push(project);
      invoices.push(must('invoice', await db.from('sales_invoices').insert({ org_id: ORG_ID, project_id: project, si_number: `SI-PS1-${short}-${amount}`,
        invoice_date: orgToday(), amount, erp_outstanding_amount: amount, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
        status: 'Submitted', erp_docstatus: 1, pmo_native: false, author_user_id: null }).select('id').single()).id);
    }
    await body({ db, nameA, nameB, own: ids[0], other: ids[1] });
  } finally {
    for (const id of invoices) await db.from('sales_invoices').delete().eq('id', id);
    for (const id of ids) { await db.from('record_changes').delete().eq('entity_id', id); await db.from('projects').delete().eq('id', id); }
  }
}

const errorsOn = (page: Page) => page.getByRole('alert').filter({ hasText: /\S/ });   // the app keeps one empty live region
const tabs = (page: Page) => page.getByTestId('project-section-tabs').getByRole('tab');

async function invoicedOnOverview(page: Page, projectId: string, name: string) {
  await page.goto(`/projects/${projectId}`);
  await expect(page.getByRole('heading', { name }).first()).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('money-position-details').getByRole('button', { name: 'Details' }).click();
  const finances = page.getByTestId('project-finances');
  await expect(finances).toBeVisible({ timeout: 20_000 });
  return finances.locator('dl > div').filter({ hasText: 'Invoiced' }).locator('dd').first();
}

test('AC-PS1-001 a Project Manager sees the money of their own project and none of another project, with no error', async ({ page }) => {
  const pm = await roleJobUser(serviceClient('AC-PS1-001'), 'project_manager', `ps1-${crypto.randomUUID()}`);
  try {
    await withProjects('AC-PS1-001', async () => pm.id, async ({ nameA, nameB, own, other }) => {
      const errors = errorsOn(page);
      await pm.signIn(page);
      await pinEnglishLocale(page);

      // Lists and the dashboard show both projects without an error.
      await page.goto('/projects');
      await expect(page.getByText(nameA)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(nameB)).toBeVisible();
      await expect(errors).toHaveCount(0);
      await page.goto('/');
      await expect(errors).toHaveCount(0);

      // Own project: the finance figures and the money areas are there; the Budget area opens.
      await expect(await invoicedOnOverview(page, own, nameA)).toHaveText('100');
      await expect(tabs(page).filter({ hasText: 'Budget' })).toHaveCount(1);
      await tabs(page).filter({ hasText: 'Budget' }).click();
      await expect(page).toHaveURL(new RegExp(`/projects/${own}/budget`));
      await expect(errors).toHaveCount(0);

      // Another project by typed URL: it opens with its delivery areas; no money area, no money figure, nothing errors.
      await page.goto(`/projects/${other}`);
      await expect(page.getByRole('heading', { name: nameB }).first()).toBeVisible({ timeout: 20_000 });
      await expect(tabs(page).filter({ hasText: 'Tasks' })).toHaveCount(1);
      for (const money of ['Budget', 'Contract', 'Procurement']) await expect(tabs(page).filter({ hasText: money })).toHaveCount(0);
      await expect(page.getByTestId('project-finances')).toHaveCount(0);
      await expect(page.getByTestId('money-position-details')).toHaveCount(0);
      await expect(errors).toHaveCount(0);
      // A deep link to its budget lands on the Overview, as for a role with no money.
      await page.goto(`/projects/${other}/budget`);
      await expect(page.getByRole('heading', { name: nameB }).first()).toBeVisible({ timeout: 20_000 });
      await expect(tabs(page).filter({ hasText: 'Overview' })).toHaveAttribute('aria-selected', 'true');
      await expect(errors).toHaveCount(0);
    });
  } finally { await pm.cleanup(); }
});

test('AC-PS1-001 a Procurement Manager reads the money of a project they do not manage, as their job needs', async ({ page }) => {
  const buyer = await roleJobUser(serviceClient('AC-PS1-001'), 'procurement_manager', `ps3-pcm-${crypto.randomUUID()}`);
  try {
    await withProjects('AC-PS1-001', async () => PM_ID, async ({ nameB, other }) => {
      const errors = errorsOn(page);
      await buyer.signIn(page);
      await pinEnglishLocale(page);
      // Project B is managed by someone else: its money and its Procurement area are there for the buyer.
      await expect(await invoicedOnOverview(page, other, nameB)).toHaveText('200');
      await tabs(page).filter({ hasText: 'Procurement' }).click();
      await expect(page).toHaveURL(new RegExp(`/projects/${other}/procurement`));
      await expect(errors).toHaveCount(0);
    });
  } finally { await buyer.cleanup(); }
});
