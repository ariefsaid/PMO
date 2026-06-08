import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * AC-PROC-001  Procurement CRUD — real user journeys (binding BDD authoring principle).
 *
 * Journey A (any-member raise + line items, goal: a Draft PR with a line item):
 *   AC-PROC-006  Procurement index → "Raise request" CTA is visible to a write-role
 *   AC-PROC-001  Raise request (modal: title) → lands on the new PR detail page in Draft
 *   AC-PROC-003  add a line item on the Draft PR → it appears with a derived line total
 *
 * Journey B (gating, goal: an Engineer can raise but never approves):
 *   AC-PROC-006b an Engineer reaching /procurement still sees "Raise request"
 *
 * Isolation: the unique PR title is generated inside the test so all steps share
 * it with zero seed-coupling (P011 pattern). DB ops (this spec + migration 0015
 * + pgTAP 0052) are verified in per-PR CI, not locally (single shared Supabase).
 *
 * RBAC authority: docs/design/rbac-visibility.md §E/§E2.
 */

test.setTimeout(120_000);

/** Wait for the Procurement index to finish its initial fetch. */
async function waitIndexReady(page: Page) {
  await expect(page.getByTestId('liststate-loading')).not.toBeVisible({ timeout: 20_000 });
}

/** Wait for the procurement detail page to finish loading. */
async function waitDetailReady(page: Page) {
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 20_000 });
}

// ── Journey A — raise a PR then add a line item ──────────────────────────────

test(
  'AC-PROC-001 + AC-PROC-003 + AC-PROC-006: a PM raises a purchase request and adds a line item — goal oracle: lands on the Draft PR, the line item appears with its derived total',
  async ({ page }) => {
    const runId = Date.now();
    const prTitle = `E2E-PR-${runId}`;

    await login(page, 'pm@acme.test');
    await page.goto('/procurement');
    await waitIndexReady(page);

    // AC-PROC-006: the Raise request CTA is visible for a write-role.
    const raiseBtn = page.getByRole('button', { name: /raise request/i });
    await expect(raiseBtn).toBeVisible({ timeout: 10_000 });

    // AC-PROC-001: open the modal, fill the title, create the request.
    await raiseBtn.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8_000 });
    await dialog.getByLabel(/title/i).fill(prTitle);
    await dialog.getByRole('button', { name: /create request/i }).click();

    // GOAL ORACLE: we land on the new PR's detail page in Draft.
    await waitDetailReady(page);
    await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute(
      'data-status',
      'Draft',
      { timeout: 15_000 },
    );
    await expect(page.getByRole('heading', { name: prTitle })).toBeVisible({ timeout: 10_000 });

    // AC-PROC-003: add a line item via the inline add-row.
    const addRow = page.getByTestId('line-item-add-row');
    await expect(addRow).toBeVisible({ timeout: 10_000 });
    await addRow.getByLabel(/new item description/i).fill('Welding wire 1.2mm');
    await addRow.getByLabel(/new item quantity/i).fill('24');
    await addRow.getByLabel(/new item unit price/i).fill('86');
    await addRow.getByRole('button', { name: /add line item/i }).click();

    // GOAL ORACLE: the item appears in the table with its derived line total ($2,064).
    await expect(page.getByText('Welding wire 1.2mm')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/\$2,064/).first()).toBeVisible({ timeout: 10_000 });
  },
);

// ── Journey B — Engineer may raise (any member) ──────────────────────────────

test(
  'AC-PROC-006b gating: an Engineer reaching /procurement still sees Raise request (any member may raise)',
  async ({ page }) => {
    await login(page, 'engineer@acme.test');
    await page.goto('/procurement');
    await waitIndexReady(page);

    // GOAL ORACLE: the create path is open to an Engineer (requester server-stamped).
    await expect(page.getByRole('button', { name: /raise request/i })).toBeVisible({
      timeout: 10_000,
    });
  },
);
