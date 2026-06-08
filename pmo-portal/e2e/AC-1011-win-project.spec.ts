import { test, expect } from '@playwright/test';
import { login, openPipelineCard } from './helpers';

// AC-1011 — Win a deal end-to-end (single curated journey).
//
// Model B (ADR-0020): a pre-win deal lives in the Sales Pipeline and opens at the ONE canonical
// detail route /projects/:id with the PIPELINE lens. A PM wins it there via "Mark won" → the
// inline SoD capture (customer contract ref + date) → Confirm won. The goal-oracle is unchanged:
// after the transition the deal is "Won, Pending KoM" with the entered customer ref, and — now
// that it satisfies the on-hand partition — it appears in the active Projects (delivery) list.
//
// ISOLATION (mirrors the P011 / AC-SP pattern): this journey PERMANENTLY transitions its deal to
// 'Won, Pending KoM', so it acts on P012 "Eastgate Depot Upgrade" (40000000-...-012) — a DEDICATED
// expendable Tender Submitted seed row that NO other spec reads. (It previously mutated the SHARED
// P002 "Northwind ERP Rollout", which the full-suite gate run proved breaks the downstream readers
// of P002: AC-1117, AC-IXD-PROJ-002, AC-1200.) Run after supabase db reset so P012 is back in
// Tender Submitted state.
//
// (FR-PR-001/004/005/011, NFR-PR-UI-001)

test.setTimeout(120_000);

const DEAL_NAME = 'Eastgate Depot Upgrade';

test('AC-1011: a PM wins a deal — open it from the Pipeline, Mark won, enter customer contract ref + date, confirm; the deal becomes Won and shows in the active Projects list with the entered ref', async ({ page }) => {
  await login(page, 'pm@acme.test');

  // The Tender-stage deal lives in the Sales Pipeline (not the active Projects list).
  await page.goto('/sales');
  await expect(page.getByLabel('Sales pipeline board')).toBeVisible({ timeout: 15_000 });

  // Model B: the deal opens at the canonical /projects/:id route with the pipeline lens.
  // openPipelineCard retries the click until that route is reached — the board re-renders as the
  // pipeline query resolves, so a click→navigate fired pre-hydration can be swallowed under load.
  await openPipelineCard(page, DEAL_NAME);
  await expect(page.getByLabel('Deal stage journey')).toBeVisible({ timeout: 15_000 });

  // Mark won → the inline SoD capture (no modal) reveals contract ref + date.
  await page.getByRole('button', { name: /Mark won/i }).click();
  await page.getByLabel(/customer contract reference/i).fill('CPO-E2E-1');
  await page.getByLabel(/contract date/i).fill('2026-04-01');
  await page.getByRole('button', { name: /Confirm won/i }).click();

  // The user sees the win acknowledged (success toast) before moving on — wait for it so the
  // transition has committed + the caches invalidated before we navigate away (natural journey:
  // you read the confirmation, then go look at your projects).
  await expect(page.getByRole('status').filter({ hasText: /Won, Pending KoM/i })).toBeVisible({
    timeout: 15_000,
  });

  // GOAL ORACLE: the deal is now Won, Pending KoM and appears in the active Projects list
  // (it satisfies the on-hand partition) with the entered customer contract ref.
  await page.goto('/projects');
  await expect(page.getByTestId('projects-loading')).not.toBeVisible({ timeout: 15_000 });
  const wonRow = page.getByRole('row').filter({ hasText: DEAL_NAME });
  await expect(wonRow).toBeVisible({ timeout: 15_000 });
  await expect(wonRow.getByText('Won, Pending KoM')).toBeVisible({ timeout: 15_000 });
  await expect(wonRow.getByText('CPO-E2E-1')).toBeVisible({ timeout: 10_000 });
});
