import { test, expect } from '@playwright/test';
import { login } from './helpers';

// AC-1011 — Win a project end-to-end (single curated journey).
// PM opens the status control for the seed's P002 (Tender Submitted), chooses
// Won, Pending KoM, enters a customer contract ref + date, submits; asserts
// the project row shows the Won badge and the entered contract ref.
//
// Seed fixture: P002 "Northwind ERP Rollout" (40000000-...-002) is in 'Tender Submitted'.
// Run after supabase db reset so the project is back in Tender Submitted state.
// Mirrors auth + navigation setup of AC-911-timesheet-approval.spec.ts.
//
// (FR-PR-001/004/005/011, NFR-PR-UI-001, plan Phase F1)

test('AC-1011: a PM wins a project — open status control, choose Won, Pending KoM, enter customer contract ref + date, submit; status shows Won and the customer ref is displayed', async ({ page }) => {
  await login(page, 'pm@acme.test');
  await page.goto('/projects');

  // Wait for the loading skeleton to disappear.
  await expect(page.getByTestId('projects-loading')).not.toBeVisible({ timeout: 15_000 });

  // Locate P002 "Northwind ERP Rollout" (the Tender Submitted seed project).
  // Target the grid card that directly contains the project name in an h3.
  const projectCard = page.locator('div.rounded-xl').filter({ has: page.locator('h3', { hasText: 'Northwind ERP Rollout' }) });
  await expect(projectCard).toBeVisible({ timeout: 10_000 });

  // Click "Change status" inside the project card (stopPropagation prevents card navigation).
  const statusControl = projectCard.getByTestId('project-status-control');
  await expect(statusControl).toBeVisible();

  const changeBtn = statusControl.getByRole('button', { name: /change status/i });
  await expect(changeBtn).toBeVisible();
  await changeBtn.click();

  // The dropdown should now list the legal next statuses for Tender Submitted.
  // Choose "Won, Pending KoM".
  await page.getByRole('button', { name: 'Won, Pending KoM' }).click();

  // The win form should appear — fill in contract ref and date.
  await expect(page.getByLabel(/customer contract ref/i)).toBeVisible({ timeout: 5_000 });
  await page.getByLabel(/customer contract ref/i).fill('CPO-E2E-1');
  await page.getByLabel(/contract date/i).fill('2026-04-01');

  // Submit the win form.
  await page.getByRole('button', { name: /confirm/i }).click();

  // After the transition the list refetches. Wait for the project to show "Won, Pending KoM".
  // The status badge text appears in the refreshed card; also confirm the contract ref is visible.
  // Re-locate the card after refetch (the DOM may re-render).
  const updatedCard = page.locator('div.rounded-xl').filter({ has: page.locator('h3', { hasText: 'Northwind ERP Rollout' }) });
  await expect(updatedCard.getByText('Won, Pending KoM')).toBeVisible({ timeout: 15_000 });
  await expect(updatedCard.getByText('CPO-E2E-1')).toBeVisible({ timeout: 10_000 });
});
