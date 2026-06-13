import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * AC-CRM-032  CRM Contacts + activity — real user journey (binding BDD authoring principle).
 *
 * A manager's intuitive path to the goal: sign in → open Contacts via the rail → create a
 * contact (name + company) → open its drawer → log a Call activity → SEE it in the timeline.
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
  return page.locator('table tbody tr').filter({
    has: page.getByRole('button', { name: `View ${name}`, exact: true }),
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

    // ── Step 3: open the drawer and log a Call ───────────────────────────────
    await row.getByRole('button', { name: `View ${name}`, exact: true }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible({ timeout: 8_000 });

    await drawer.getByLabel(/activity type/i).selectOption('Call');
    await drawer.getByLabel(/subject/i).fill(subject);
    await drawer.getByRole('button', { name: /log activity/i }).click();

    // GOAL ORACLE (the real goal): the logged activity appears in the timeline.
    await expect(drawer.getByText(subject)).toBeVisible({ timeout: 15_000 });
    await expect(drawer.getByText('Call').first()).toBeVisible();
  },
);
