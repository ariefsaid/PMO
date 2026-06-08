import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * Model B — ONE canonical project/opportunity record (ADR-0020).
 *
 * AC-IXD-PROJ-001  (owner-verbatim): a PM creates a project then opens it from EITHER the
 *                  Projects list OR the Sales Pipeline → both resolve to ONE detail page at the
 *                  SAME URL (`/projects/:id`), showing the stage-appropriate lens (pipeline lens
 *                  while pre-win, delivery lens once won). Invariant: one entity → one URL.
 * AC-IXD-PROJ-001a (corollary): a newly created Leads deal appears in the Pipeline and is ABSENT
 *                  from the active Projects list (disjoint stage partitions).
 * AC-IXD-PROJ-002  the legacy `/sales/:id` route redirects (replace) to `/projects/:id`.
 *
 * Seed (seed.sql): P001 "Innovate Corp HQ Fit-Out" = Ongoing Project (on-hand → in Projects list,
 * delivery lens); P002 "Northwind ERP Rollout" = Tender Submitted (pipeline → in Pipeline, NOT in
 * Projects list, pipeline lens). pm@acme.test owns them.
 */

test.setTimeout(120_000);

async function waitProjectsReady(page: Page) {
  await expect(page.getByTestId('projects-loading')).not.toBeVisible({ timeout: 20_000 });
}

function projectRow(page: Page, name: string) {
  return page.locator('table tbody tr').filter({ has: page.getByRole('button', { name, exact: true }) });
}

test(
  'AC-IXD-PROJ-001 + AC-IXD-PROJ-001a: a created Leads deal lives in the Pipeline (absent from Projects); both an on-hand project (from Projects) and a pipeline deal (from the Pipeline) open the ONE canonical /projects/:id detail with the stage-appropriate lens',
  async ({ page }) => {
    const runId = Date.now();
    const dealName = `E2E-Canonical-${runId}`;

    // ── A PM creates a new deal (origination status = Leads) ──────────────────
    await login(page, 'pm@acme.test');
    await page.goto('/projects');
    await waitProjectsReady(page);

    await page.getByRole('button', { name: /new deal/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8_000 });
    await dialog.getByLabel(/opportunity name/i).fill(dealName);
    await dialog.getByRole('combobox', { name: /client company/i }).click();
    await page.getByRole('listbox').getByRole('option').first().click();
    await dialog.getByRole('button', { name: /^Create deal$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });

    // ── AC-IXD-PROJ-001a: the new Lead is ABSENT from the active Projects list … ──
    await page.goto('/projects');
    await waitProjectsReady(page);
    await expect(projectRow(page, dealName)).toHaveCount(0);

    // … and PRESENT in the Sales Pipeline (the pre-win partition).
    await page.goto('/sales');
    await expect(page.getByText(dealName).first()).toBeVisible({ timeout: 15_000 });

    // ── AC-IXD-PROJ-001 (pipeline half): opening the deal from the Pipeline lands on
    //    the canonical /projects/:id detail with the PIPELINE lens. ───────────────
    await page.getByText(dealName).first().click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+/);
    await expect(page).not.toHaveURL(/\/sales\//);
    await expect(page.getByRole('heading', { name: dealName })).toBeVisible({ timeout: 15_000 });
    // pipeline lens markers: the deal-stage journey + the Advance affordance
    await expect(page.getByLabel('Deal stage journey')).toBeVisible();
    await expect(page.getByRole('button', { name: /Advance to/i })).toBeVisible();
    // delivery lens is NOT shown pre-win (no section tabs)
    await expect(page.getByRole('tablist', { name: /project sections/i })).toHaveCount(0);
    const pipelineUrl = page.url();

    // ── AC-IXD-PROJ-001 (projects half): an ON-HAND project opened from the Projects
    //    list lands on the SAME canonical /projects/:id route, with the DELIVERY lens. ──
    await page.goto('/projects');
    await waitProjectsReady(page);
    const onHandName = 'Innovate Corp HQ Fit-Out';
    await projectRow(page, onHandName).getByRole('button', { name: onHandName, exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+/);
    await expect(page.getByRole('heading', { name: onHandName })).toBeVisible({ timeout: 15_000 });
    // delivery lens markers: the section tabs + the contract-value SoD block
    await expect(page.getByRole('tablist', { name: /project sections/i })).toBeVisible();
    await expect(page.getByTestId('contract-value-sod')).toBeVisible();
    // and NOT the pipeline lens
    await expect(page.getByLabel('Deal stage journey')).toHaveCount(0);

    // ── one-URL invariant: both lenses live under the same /projects/:id pattern ──
    expect(pipelineUrl).toMatch(/\/projects\/[0-9a-f-]+$/);
    expect(page.url()).toMatch(/\/projects\/[0-9a-f-]+$/);
  },
);

test(
  'AC-IXD-PROJ-002: the legacy /sales/:id route redirects (replace) to the canonical /projects/:id — no OpportunityDetail page renders',
  async ({ page }) => {
    // P002 "Northwind ERP Rollout" is a Tender Submitted (pipeline) seed row.
    const id = '40000000-0000-0000-0000-000000000002';
    await login(page, 'exec@acme.test');

    // Visiting the OLD deep link redirects to the canonical project route.
    await page.goto(`/sales/${id}`);
    await page.waitForURL(`**/projects/${id}`, { timeout: 15_000 });
    await expect(page).toHaveURL(new RegExp(`/projects/${id}$`));
    await expect(page).not.toHaveURL(/\/sales\//);

    // It is a replace navigation: going Back does NOT return to /sales/:id.
    await page.goBack();
    await expect(page).not.toHaveURL(new RegExp(`/sales/${id}`));

    // The canonical page renders the pipeline lens for this pre-win deal.
    await page.goto(`/sales/${id}`);
    await page.waitForURL(`**/projects/${id}`, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /Northwind ERP Rollout/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('Deal stage journey')).toBeVisible();
  },
);
