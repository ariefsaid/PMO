// @e2e-isolation: self-isolated — unique opportunity name (Date.now()), PM creates project from Pipeline; appears in Pipeline immediately; no seed coupling.
import { test, expect } from '@playwright/test';
import { login, pickComboboxOption } from './helpers';

/**
 * AC-W2-IXD-004 (B-3, Wave 2 IxD naturalness): A PM creates a new project
 * FROM the Pipeline — the natural origination point for pipeline project creation.
 *
 * Natural journey: a PM is on the Pipeline (where pre-win projects live) and wants to
 * start a new one. The "+ New project" CTA exists on that page, opens a create
 * modal, and the created project appears in the pipeline immediately after creation.
 *
 * This is a cross-screen create journey — the goal is "a new project in the pipeline",
 * not "the create dialog closes".
 *
 * Owning layer: e2e (Playwright) — AC-W2-IXD-004.
 */

test.setTimeout(90_000);

test(
  'AC-W2-IXD-004: PM creates a new project from the Pipeline and it appears in the pipeline',
  async ({ page }) => {
    const runId = Date.now();
    const opportunityName = `E2E-Pipeline-CTA-${runId}`;

    await login(page, 'pm@acme.test');
    await page.goto('/sales');

    // Goal 1: The "+ New project" CTA is present on the Pipeline for a PM.
    const newProjectBtn = page.getByRole('button', { name: /new project/i });
    await expect(newProjectBtn).toBeVisible({ timeout: 15_000 });

    // Goal 2: The CTA opens a create modal.
    await newProjectBtn.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8_000 });

    // Fill in the project name and pick a client company.
    await dialog.getByLabel(/project name/i).fill(opportunityName);
    await pickComboboxOption(dialog, page, /client company/i, 'first');

    // Submit.
    await dialog.getByRole('button', { name: /^Create project$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });

    // Goal 3 (the oracle): the new project appears in the Pipeline — the user's
    // goal was to create a project in the pipeline, and it's now there.
    // The pipeline renders as Board cards; the new project should be in the Leads column.
    await expect(page.getByText(opportunityName).first()).toBeVisible({ timeout: 20_000 });
  },
);
