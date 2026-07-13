// @e2e-isolation: read-only — pure nav/assert; reads procurement list; no DB writes.
import { test, expect } from '@playwright/test';
import { login } from './helpers';

// AC-1200 — procurement list loads for non-Finance roles (regression: PGRST201 ambiguous FK embed).
//
// Root cause: procurements.ts SELECT used `requested_by:profiles(full_name)` which PostgREST
// rejects with HTTP 300 / PGRST201 when a table has two FKs to the same referenced table
// (procurements_requested_by_id_fkey and procurements_approved_by_id_fkey added by
// 0006/0010 migrations). Fix: disambiguate with explicit FK hint on every profiles embed.
//
// Logged in as pm@acme.test (Project Manager) — proves the bug affects ALL roles, not just Finance.

test('AC-1200 procurement list renders rows and does not show error for PM role', async ({ page }) => {
  await login(page, 'pm@acme.test');
  await page.goto('/procurement');

  // The list must NOT be in error state
  await expect(page.getByText("Couldn't load procurements")).not.toBeVisible({ timeout: 15_000 });

  // At least one procurement row must render (seeded data has several)
  // The list renders rows with a "PROC-" code pattern
  await expect(page.getByText(/PROC-/).first()).toBeVisible({ timeout: 15_000 });
});
