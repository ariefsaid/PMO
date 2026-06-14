import { test, expect, type Page } from '@playwright/test';
import { login, pickComboboxOption, openPipelineCard } from './helpers';

/**
 * Model B — ONE canonical project/opportunity record (ADR-0020).
 *
 * AC-IXD-PROJ-001  (owner-verbatim): a PM creates a project then opens it from EITHER the
 *                  Projects list OR the Sales Pipeline → both resolve to ONE unified detail page at
 *                  the SAME URL (`/projects/:id`) — the delivery tabs (Overview/Budget/…) render at
 *                  every stage (ADR-0021), with a deal-progression banner added while pre-win and
 *                  the contract-value SoD editor added once on-hand. Invariant: one entity → one URL.
 * AC-IXD-PROJ-001a (corollary): a newly created Leads deal appears in the Pipeline and is ABSENT
 *                  from the active Projects list (disjoint stage partitions).
 * AC-IXD-PROJ-002  the legacy `/sales/:id` route redirects (replace) to `/projects/:id`.
 *
 * Seed (seed.sql):
 *   • P002 "Northwind ERP Rollout" = Tender Submitted (pipeline → in Pipeline, NOT in Projects list,
 *     pipeline lens). pm@acme.test owns it.
 *   • P003 "Acme Internal Platform" = Ongoing Project (on-hand → in Projects list, delivery lens) is
 *     this spec's READ-ONLY on-hand example. It is NEVER mutated by any spec (AC-TSE-021 / AC-IXD-TS-001
 *     only reference it as a timesheet picker option — they create timesheet_entries, never touch the
 *     project row), so this spec's on-hand half is ordering-independent in the full parallel suite.
 *     P001 was the prior choice but AC-PRJ-006 mutates P001's contract_value, coupling the two specs;
 *     repointing to P003 decouples them. (A *new* dedicated on-hand row was rejected: the dashboard
 *     on_hand_margin formula sum(contract_value−spent)/sum(contract_value) means ANY extra on-hand
 *     project shifts on_hand_value + on_hand_margin + win-rate, so a new row could not be oracle-
 *     neutral; P003 already exists and is provably unmutated, so it adds zero pgTAP drift.)
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

    // ── A PM creates a new project (origination status = Leads) ──────────────────
    await login(page, 'pm@acme.test');
    await page.goto('/projects');
    await waitProjectsReady(page);

    await page.getByRole('button', { name: /new project/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8_000 });
    await dialog.getByLabel(/project name/i).fill(dealName);
    // Robust FK pick: wait for the async option list to settle before selecting (the bare
    // listbox.option.first().click() races the lazy load→ready re-render → a lost selection that
    // then blocks the Create-project submit on the "Select a company" validation error — the dominant
    // create-flow flake under the single-DB parallel suite). See helpers.pickComboboxOption.
    await pickComboboxOption(dialog, page, /client company/i, 'first');
    await dialog.getByRole('button', { name: /^Create project$/i }).click();
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
    // openPipelineCard retries the click until /projects/:id is reached (the card click→navigate
    // can be swallowed if fired pre-hydration under parallel-suite load).
    await openPipelineCard(page, dealName);
    await expect(page).not.toHaveURL(/\/sales\//);
    await expect(page.getByRole('heading', { name: dealName })).toBeVisible({ timeout: 15_000 });
    // project-progression banner markers: the project-stage journey + the Advance affordance
    // CW-1 r2fix-enforce: aria-label "Deal stage journey" → "Project stage journey"
    await expect(page.getByLabel('Project stage journey')).toBeVisible();
    await expect(page.getByRole('button', { name: /Advance to/i })).toBeVisible();
    // ADR-0021 (owner override of ADR-0020 §1): the delivery tabs ARE shown pre-win — a PM must be
    // able to plan budget/tasks/procurement while pursuing the deal. The banner sits ABOVE them.
    await expect(page.getByRole('tablist', { name: /project sections/i })).toBeVisible();
    // the owner's core journey: a Budget tab is reachable on a pipeline deal (was hidden pre-0021).
    await page.getByRole('tab', { name: 'Budget' }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/budget$/);
    const pipelineUrl = page.url().replace(/\/budget$/, '');

    // ── AC-IXD-PROJ-001 (projects half): an ON-HAND project opened from the Projects
    //    list lands on the SAME canonical /projects/:id route, with the DELIVERY lens. ──
    await page.goto('/projects');
    await waitProjectsReady(page);
    // P003 "Acme Internal Platform" — a READ-ONLY on-hand seed project no spec mutates (see header
    // note). Decoupled from P001 (which AC-PRJ-006 mutates) so this half is ordering-independent.
    const onHandName = 'Acme Internal Platform';
    await projectRow(page, onHandName).getByRole('button', { name: onHandName, exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+/);
    await expect(page.getByRole('heading', { name: onHandName })).toBeVisible({ timeout: 15_000 });
    // delivery lens markers: the section tabs + the contract-value SoD block
    await expect(page.getByRole('tablist', { name: /project sections/i })).toBeVisible();
    await expect(page.getByTestId('contract-value-sod')).toBeVisible();
    // and NOT the pipeline lens
    await expect(page.getByLabel('Project stage journey')).toHaveCount(0);

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
    // CW-1 r2fix-enforce: "Deal stage journey" → "Project stage journey"
    await expect(page.getByLabel('Project stage journey')).toBeVisible();
  },
);
