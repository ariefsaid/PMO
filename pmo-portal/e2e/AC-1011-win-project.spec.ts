import { test, expect } from '@playwright/test';
import { login } from './helpers';

// AC-1011 — Win a project end-to-end (single curated journey).
// PM opens the inline status control for the seed's P002 (Tender Submitted) in
// the default Table view, chooses Won, Pending KoM, enters a customer contract
// ref + date, submits; asserts the row shows the Won pill and the entered ref.
//
// Seed fixture: P002 "Northwind ERP Rollout" (40000000-...-002) is in 'Tender Submitted'.
// Run after supabase db reset so the project is back in Tender Submitted state.
//
// IA-3 re-skin (OQ-3): the index default view is now Table and statuses render
// as StatusPills (no `div.rounded-xl`/`h3` cards). The journey targets the
// stable `project-status-control` testid scoped to the row that contains the
// project name — selector stability no longer depends on Tailwind class names.
//
// (FR-PR-001/004/005/011, NFR-PR-UI-001, plan Phase F1)

test('AC-1011: a PM wins a project — open status control, choose Won, Pending KoM, enter customer contract ref + date, submit; status shows Won and the customer ref is displayed', async ({ page }) => {
  await login(page, 'pm@acme.test');
  await page.goto('/projects');

  // Wait for the loading skeleton to disappear.
  await expect(page.getByTestId('projects-loading')).not.toBeVisible({ timeout: 15_000 });

  // Locate the table row for P002 "Northwind ERP Rollout" (default Table view).
  const projectRow = page.getByRole('row').filter({ hasText: 'Northwind ERP Rollout' });
  await expect(projectRow).toBeVisible({ timeout: 10_000 });

  // Click "Change status" inside that row (stopPropagation prevents row drill).
  const statusControl = projectRow.getByTestId('project-status-control');
  await expect(statusControl).toBeVisible();

  const changeBtn = statusControl.getByRole('button', { name: /change status/i });
  await expect(changeBtn).toBeVisible();
  await changeBtn.click();

  // The dropdown lists the legal next statuses for Tender Submitted — choose Won.
  await page.getByRole('button', { name: 'Won, Pending KoM' }).click();

  // The win form appears — fill in contract ref and date.
  await expect(page.getByLabel(/customer contract ref/i)).toBeVisible({ timeout: 5_000 });
  await page.getByLabel(/customer contract ref/i).fill('CPO-E2E-1');
  await page.getByLabel(/contract date/i).fill('2026-04-01');

  // Submit the win form.
  await page.getByRole('button', { name: /confirm/i }).click();

  // After the transition the list refetches. Re-locate the row and assert the
  // Won, Pending KoM status pill + the entered customer contract ref are shown.
  const updatedRow = page.getByRole('row').filter({ hasText: 'Northwind ERP Rollout' });
  await expect(updatedRow.getByText('Won, Pending KoM')).toBeVisible({ timeout: 15_000 });
  await expect(updatedRow.getByText('CPO-E2E-1')).toBeVisible({ timeout: 10_000 });
});
