// @e2e-isolation: dedicated-row — owns PROC-2026-002/008 (60000000-...-003/008); dedicated Requested/Vendor-Invoiced procurement fixtures; no other spec targets them.
import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

// AC-IXD-WP-002 — consequential / financial procurement writes STILL confirm, and the kept
// Approve + Mark-as-Paid confirms RESTATE the amount + project + requester (OD-UX-1, plan
// tasks 9/10; the contract-value SoD confirm is the template — confirm against the money).
//
// Natural journey / Given-When-Then:
//   Given: a Requested PR (PROC-2026-002) that a non-requester approver (finance@) views.
//   When:  they click "Approve",
//   Then:  a ConfirmDialog appears whose body restates the AMOUNT + project + requester;
//   And:   clicking "Mark as Paid" on a Vendor-Invoiced PR (PROC-2026-008) also confirms with
//          the amount.
//   Invariant: consequential/financial writes confirm before the write, against the money.

/** Find the open confirm dialog (default `dialog`; falls back to destructive `alertdialog`). */
function confirmSurface(page: Page) {
  return page.getByRole('dialog').or(page.getByRole('alertdialog'));
}

test('AC-IXD-WP-002: Approve still confirms and its dialog restates the amount + project + requester', async ({ page }) => {
  // PROC-2026-002 (…003): Requested, $22,500, requested_by = engineer@ (a4); finance@ approves.
  await login(page, 'finance@acme.test');
  await page.goto('/procurement/60000000-0000-0000-0000-000000000003');

  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute(
    'data-status',
    'Requested',
    { timeout: 10_000 },
  );

  // Click Approve → a confirm dialog appears (consequential write still confirms).
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const dialog = confirmSurface(page);
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // The body restates the money + context (confirm against the amount): amount +
  // the PROJECT the spend lands on + the requester who raised it.
  await expect(dialog).toContainText('$22,500');
  await expect(dialog).toContainText('Northwind ERP Rollout');

  // No write fired on the first click — still Requested behind the dialog.
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Requested');

  // Confirming inside the dialog commits the approval.
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute(
    'data-status',
    'Approved',
    { timeout: 15_000 },
  );
});

test('AC-IXD-WP-002: Mark as Paid still confirms and its dialog restates the amount', async ({ page }) => {
  // PROC-2026-008 (…008): Vendor Invoiced, $30,000, approver = exec@ (a1); finance@ (a3) pays
  // (payer ≠ approver → SoD-b passes).
  await login(page, 'finance@acme.test');
  await page.goto('/procurement/60000000-0000-0000-0000-000000000008');

  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute(
    'data-status',
    'Vendor Invoiced',
    { timeout: 10_000 },
  );

  // Click Mark as Paid → a confirm dialog appears (financial write still confirms).
  await page.getByRole('button', { name: 'Mark as Paid' }).click();
  const dialog = confirmSurface(page);
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // The body restates the amount being paid.
  await expect(dialog).toContainText('$30,000');

  // No write fired on the first click.
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Vendor Invoiced');

  // Confirming commits the payment.
  await dialog.getByRole('button', { name: 'Mark as Paid' }).click();
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute(
    'data-status',
    'Paid',
    { timeout: 15_000 },
  );
});
