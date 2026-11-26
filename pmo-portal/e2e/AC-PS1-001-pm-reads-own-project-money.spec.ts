// @e2e-isolation: self-isolated — a disposable Project Manager login and two disposable projects, all removed after.
import { test, expect } from '@playwright/test';
import { roleJobUser } from './support/roleJobUser';
import { need, ORG_ID, PM_ID, serviceClient, orgToday, inDays } from './support/jobJourney';
import { pinEnglishLocale } from './helpers';

// AC-PS1-001 — a Project Manager reads project money for their own projects only (owner ruling 26 Nov 2026).
// The Project Manager manages project A; the seeded Project Manager manages project B. Both have one submitted invoice.
test('AC-PS1-001 a Project Manager sees the money of their own project and none of another project, with no error', async ({ page }) => {
  const db = serviceClient('AC-PS1-001'); const must = need('AC-PS1-001');
  const run = crypto.randomUUID(); const short = run.slice(0, 8);
  const pm = await roleJobUser(db, 'project_manager', `ps1-${run}`);
  const nameA = `PS1 own ${short}`; const nameB = `PS1 other ${short}`;
  const ids: string[] = []; const invoices: string[] = [];
  try {
    for (const [name, manager, amount] of [[nameA, pm.id, 100], [nameB, PM_ID, 200]] as const) {
      const project = must('project', await db.from('projects').insert({ org_id: ORG_ID, name, status: 'Ongoing Project', currency: 'USD',
        contract_value: 1000, tax_treatment: 'exclusive', tax_amount: 0, project_manager_id: manager, start_date: inDays(-30), end_date: inDays(60) }).select('id').single()).id;
      ids.push(project);
      invoices.push(must('invoice', await db.from('sales_invoices').insert({ org_id: ORG_ID, project_id: project, si_number: `SI-PS1-${short}-${amount}`,
        invoice_date: orgToday(), amount, erp_outstanding_amount: amount, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
        status: 'Submitted', erp_docstatus: 1, pmo_native: false, author_user_id: null }).select('id').single()).id);
    }
    const [own, other] = ids;
    const errors = page.getByRole('alert').filter({ hasText: /\S/ });   // the app keeps one empty live region; an error has words
    await pm.signIn(page);
    await pinEnglishLocale(page);

    // Lists and the dashboard show both projects without an error.
    await page.goto('/projects');
    await expect(page.getByText(nameA)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(nameB)).toBeVisible();
    await expect(errors).toHaveCount(0);
    await page.goto('/');
    await expect(errors).toHaveCount(0);

    // Own project: the finance figures are there.
    await page.goto(`/projects/${own}`);
    await expect(page.getByRole('heading', { name: nameA }).first()).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('money-position-details').getByRole('button', { name: 'Details' }).click();
    const finances = page.getByTestId('project-finances');
    await expect(finances).toBeVisible({ timeout: 20_000 });
    await expect(finances.locator('dl > div').filter({ hasText: 'Invoiced' }).locator('dd').first()).toHaveText('100');

    // Another project by typed URL: the project opens, its money is not shown, nothing errors.
    await page.goto(`/projects/${other}`);
    await expect(page.getByRole('heading', { name: nameB }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('project-finances')).toHaveCount(0);
    await expect(page.getByTestId('money-position-details')).toHaveCount(0);
    await expect(errors).toHaveCount(0);
  } finally {
    for (const id of invoices) await db.from('sales_invoices').delete().eq('id', id);
    for (const id of ids) { await db.from('record_changes').delete().eq('entity_id', id); await db.from('projects').delete().eq('id', id); }
    await pm.cleanup();
  }
});
