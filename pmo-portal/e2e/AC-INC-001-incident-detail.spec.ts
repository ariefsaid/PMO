import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * AC-INC-001  Incident detail page — the dead-end is gone (CW-4a, coherence-wave §4).
 *
 * Before CW-4a, `/incidents` rows were inert: an Engineer could File an incident but could not
 * OPEN it — a functional dead-end (whole-app coherence audit, P1 + "Incidents is a dead-end").
 * This journey proves the fix end-to-end: an Engineer files an incident, OPENS it from the list
 * to a real `/incidents/:id` detail page, sees its detail, and gets BACK to the register.
 *
 * GOAL ORACLE: the incident opens to a real detail page (a routable record with the shared
 * RecordHeader showing the incident + its severity/status pills) and Back returns to the list.
 *
 * Role: engineer@acme.test (any member may file AND read an incident; RLS scopes visibility).
 */

test.setTimeout(120_000);

/** Wait for the Incidents page to finish its initial data fetch. */
async function waitReady(page: Page) {
  await expect(page.getByTestId('liststate-loading')).not.toBeVisible({ timeout: 20_000 });
}

test(
  'AC-INC-001: an Engineer opens an incident from the list to its detail page and returns — goal oracle: the incident opens to a real /incidents/:id page (dead-end gone)',
  async ({ page }) => {
    const runId = Date.now();
    const inType = `E2E-Detail-${runId}`;

    await login(page, 'engineer@acme.test');
    await page.goto('/incidents');
    await waitReady(page);

    // Self-seed: file the incident so the journey owns its own sentinel row.
    await page.getByRole('button', { name: /file incident/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8_000 });
    await dialog.getByLabel(/date/i).fill('2026-06-08');
    await dialog.getByLabel(/^type/i).fill(inType);
    await dialog.locator('select').first().selectOption('High');
    await dialog.getByLabel(/location/i).fill('Regional Site B');
    await dialog.getByLabel(/description/i).fill('E2E incident for the detail-page journey');
    await dialog.getByRole('button', { name: /^file incident$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });

    // OPEN the row — the activation control opens the routable detail page (was inert).
    await page.getByRole('button', { name: new RegExp(`open ${inType}`, 'i') }).click();

    // GOAL ORACLE: a real /incidents/:id detail page rendered with the shared RecordHeader,
    // the incident's name (its type), and BOTH its severity + workflow-status pills.
    await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]+$/i, { timeout: 15_000 });
    const header = page.getByTestId('record-header');
    await expect(header).toBeVisible({ timeout: 10_000 });
    await expect(header.getByText(inType)).toBeVisible();
    await expect(header.getByText('High')).toBeVisible();
    await expect(header.getByText('Open')).toBeVisible();
    // The detail body shows the incident's fields — no longer a dead-end.
    await expect(page.getByText('Regional Site B')).toBeVisible();
    await expect(page.getByText('E2E incident for the detail-page journey')).toBeVisible();

    // GET BACK: the breadcrumb "Incidents" crumb returns to the register (the desktop back
    // affordance; the in-content BackBar is the mobile-only escape). Either way the journey's
    // goal-oracle is the same: the user can get back out of the record to the list.
    await page.getByRole('navigation', { name: /breadcrumb/i }).getByRole('button', { name: /^incidents$/i }).click();
    await expect(page).toHaveURL(/\/incidents$/, { timeout: 10_000 });
    await waitReady(page);
    // The just-filed incident's row is still in the register (the activation control names it
    // "Open <type>" — opening it again would re-enter the detail page).
    await expect(
      page.getByRole('button', { name: new RegExp(`open ${inType}`, 'i') }),
    ).toBeVisible({ timeout: 15_000 });
  },
);
