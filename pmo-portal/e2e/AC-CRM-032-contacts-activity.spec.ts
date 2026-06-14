import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * AC-CRM-032  CRM Contacts + activity — real user journey (binding BDD authoring principle).
 *
 * A manager's intuitive path to the goal: sign in → open Contacts via the rail → create a
 * contact (name + company) → open its routable /contacts/:id record page → log a Call activity
 * → SEE it in the timeline. (CW-4b: the drawer-as-record is retired; the activity timeline +
 * Log-activity form now live on the record page.)
 *
 * GOAL ORACLE: the logged activity appears in the contact's timeline (not merely "a form exists").
 *
 * Role: admin@acme.test (a CRM writer; Admin·Exec·PM·Finance write, Engineer = ○).
 * RLS is the enforcement authority (migration 0030); this proves the real cross-stack flow.
 */

test.setTimeout(120_000);

async function waitReady(page: Page) {
  await expect(page.getByTestId('liststate-loading')).not.toBeVisible({ timeout: 20_000 });
}

function contactRow(page: Page, name: string) {
  // CW-4b: rows navigate to /contacts/:id — the activation button reads "Open <name>".
  return page.locator('table tbody tr').filter({
    has: page.getByRole('button', { name: `Open ${name}`, exact: true }),
  });
}

test(
  'AC-CRM-032: a manager creates a contact and logs an activity — goal oracle: the activity appears in the timeline',
  async ({ page }) => {
    const runId = Date.now();
    const name = `E2E-Contact-${runId}`;
    const subject = `Kickoff-${runId}`;

    await login(page, 'admin@acme.test');
    await page.goto('/contacts');
    await waitReady(page);

    // ── Step 1: open the create form ─────────────────────────────────────────
    const newBtn = page.getByRole('button', { name: /new contact/i });
    await expect(newBtn).toBeVisible({ timeout: 10_000 });
    await newBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8_000 });

    // ── Step 2: fill name + pick a company → save ────────────────────────────
    await dialog.getByLabel(/full name/i).fill(name);
    // The Company field is a native <select>; pick the first real option (index 1 skips the placeholder).
    const companySelect = dialog.getByLabel(/^Company/i);
    await companySelect.selectOption({ index: 1 });
    await dialog.getByRole('button', { name: /create contact/i }).click();

    // GOAL ORACLE (create): modal closes; the new row is in the list.
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });
    const row = contactRow(page, name);
    await expect(row).toBeVisible({ timeout: 15_000 });

    // ── Step 3: open the routable record page and log a Call ─────────────────
    await row.getByRole('button', { name: `Open ${name}`, exact: true }).click();
    // GOAL ORACLE (navigation): the routable /contacts/:id record page rendered.
    await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]+$/i, { timeout: 15_000 });
    const header = page.getByTestId('record-header');
    await expect(header).toBeVisible({ timeout: 10_000 });
    await expect(header.getByText(name)).toBeVisible();

    await page.getByLabel(/activity type/i).selectOption('Call');
    await page.getByLabel(/subject/i).fill(subject);
    await page.getByRole('button', { name: /log activity/i }).click();

    // GOAL ORACLE (the real goal): the logged activity appears in the timeline.
    await expect(page.getByText(subject)).toBeVisible({ timeout: 15_000 });
    // Scope to the rendered timeline list — avoids matching the invisible <option> in the log-activity <select>.
    const timeline = page.getByTestId('activity-timeline');
    await expect(timeline.getByText('Call').first()).toBeVisible();
  },
);
