import { test, expect } from '@playwright/test';
import { login, pickComboboxOption } from './helpers';

/**
 * AC-W2-IXD-004 (B-3, Wave 2 IxD naturalness): A PM creates a new opportunity
 * FROM the Sales Pipeline — the natural origination point for deal creation.
 *
 * Natural journey: a PM is on the Sales Pipeline (where deals live) and wants to
 * start a new one. The "+ New opportunity" CTA exists on that page, opens a create
 * modal, and the created deal appears in the pipeline immediately after creation.
 *
 * This is a cross-screen create journey — the goal is "a new deal in the pipeline",
 * not "the create dialog closes".
 *
 * Owning layer: e2e (Playwright) — AC-W2-IXD-004.
 */

test.setTimeout(90_000);

test(
  'AC-W2-IXD-004: PM creates a new opportunity from the Sales Pipeline and it appears in the pipeline',
  async ({ page }) => {
    const runId = Date.now();
    const opportunityName = `E2E-Pipeline-CTA-${runId}`;

    await login(page, 'pm@acme.test');
    await page.goto('/sales');

    // Goal 1: The "+ New opportunity" CTA is present on the Sales Pipeline for a PM.
    const newOpportunityBtn = page.getByRole('button', { name: /new opportunity/i });
    await expect(newOpportunityBtn).toBeVisible({ timeout: 15_000 });

    // Goal 2: The CTA opens a create modal.
    await newOpportunityBtn.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8_000 });

    // Fill in the opportunity name and pick a client company.
    await dialog.getByLabel(/opportunity name/i).fill(opportunityName);
    await pickComboboxOption(dialog, page, /client company/i, 'first');

    // Submit.
    await dialog.getByRole('button', { name: /^Create deal$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });

    // Goal 3 (the oracle): the new deal appears in the Sales Pipeline — the user's
    // goal was to create a deal in the pipeline, and it's now there.
    // The pipeline renders as Kanban cards; the new deal should be in the Leads column.
    await expect(page.getByText(opportunityName).first()).toBeVisible({ timeout: 20_000 });
  },
);
