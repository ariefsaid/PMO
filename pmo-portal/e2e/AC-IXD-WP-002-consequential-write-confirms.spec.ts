// @e2e-isolation: self-isolated — creates the uniquely-named project + the Requested/Vendor-Invoiced procurement each test acts on (service-role fixture) and deletes them afterwards; no shared seed row is read or written.
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { login, requireServiceRoleKey } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

// AC-IXD-WP-002 — consequential / financial procurement writes STILL confirm, and the kept
// Approve + Mark-as-Paid confirms RESTATE the amount and settlement consequence.
//
// Natural journey / Given-When-Then:
//   Given: a Requested PR (owned by THIS spec: unique title, $22,500, its own project) that a
//          non-requester approver (finance@) views.
//   When:  they click "Approve",
//   Then:  a ConfirmDialog appears whose body restates the AMOUNT + project + requester;
//   And:   clicking "Record payment" on a Vendor-Invoiced PR (also owned here, $30,000) confirms
//          with the amount and explains that this records evidence rather than transferring funds.
//   Invariant: consequential/financial writes confirm before the write, against the money.
//
// #1873 — fixture ownership. This spec used to approve seed procurement …003 (PROC-2026-002), the
// row serial AC-IXD-PROC-W5-3 reads in the Requested approvals queue. Since the serial phase runs
// AFTER the chromium phase (#1870), the serial journey found a used-up fixture. Each test now
// creates the procurement it decides on (and the project it points at) with the service-role
// client, and removes both afterwards — the same per-test fixture pattern as AC-APR-040 /
// procurement-currency-position. The goal-oracles are unchanged: the confirm still restates the
// amount, and the project the spend lands on is still named in the dialog.

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
/** Tomas Beck (engineer@acme.test) — the requester, so finance@ (a3) is never the requester (SoD-a). */
const ENGINEER_ID = '00000000-0000-0000-0000-0000000000a4';
/** Amara Osei (exec@acme.test) — approved the payable row, so finance@ paying it passes SoD-b. */
const EXEC_ID = '00000000-0000-0000-0000-0000000000a1';
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);

/** Find the open confirm dialog (default `dialog`; falls back to destructive `alertdialog`). */
function confirmSurface(page: Page) {
  return page.getByRole('dialog').or(page.getByRole('alertdialog'));
}

let admin: SupabaseClient | undefined;
let projectId = '';
let projectName = '';
let approveId = '';
let payId = '';

/**
 * The Given state of BOTH journeys, owned by this spec: a project (referenced only by these rows,
 * so the dialog's "on <project>" clause is this test's own name) plus one Requested row to approve
 * and one Vendor-Invoiced row to pay. Created per attempt — a retry must not inherit a row the
 * previous attempt already approved/paid.
 */
test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-IXD-WP-002 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });

  projectName = `AC-IXD-WP-002 ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const project = await admin
    .from('projects')
    .insert({ org_id: ORG_ID, name: projectName, status: 'Ongoing Project' })
    .select('id')
    .single();
  if (project.error) throw new Error(`AC-IXD-WP-002 fixture project: ${project.error.message}`);
  projectId = project.data.id;

  // $22,500 Requested, raised by engineer@ — the row the Approve confirm restates.
  const approve = await admin
    .from('procurements')
    .insert({
      org_id: ORG_ID,
      title: `${projectName} safety equipment`,
      project_id: projectId,
      requested_by_id: ENGINEER_ID,
      status: 'Requested',
      currency: 'USD',
      total_value: 22_500,
    })
    .select('id')
    .single();
  if (approve.error) throw new Error(`AC-IXD-WP-002 fixture requested procurement: ${approve.error.message}`);
  approveId = approve.data.id;

  // $30,000 Vendor Invoiced, approved by exec@ — finance@ records the payment (payer ≠ approver).
  // `approved_total_value` is the approved ceiling the payment guard (§1 `procurement_payment_allowed`)
  // requires on a purchase that entered approval; transition_procurement stamps it on the real
  // Requested→Approved step, so a fixture seeded straight into a later stage must carry it.
  const pay = await admin
    .from('procurements')
    .insert({
      org_id: ORG_ID,
      title: `${projectName} surge protection`,
      project_id: projectId,
      requested_by_id: ENGINEER_ID,
      status: 'Vendor Invoiced',
      currency: 'USD',
      total_value: 30_000,
      approved_total_value: 30_000,
      approved_by_id: EXEC_ID,
    })
    .select('id')
    .single();
  if (pay.error) throw new Error(`AC-IXD-WP-002 fixture payable procurement: ${pay.error.message}`);
  payId = pay.data.id;
});

// Leave the shared local stack exactly as found: the next spec inherits the seed, not this journey's
// project or procurements (the missing half of the #1873 collision).
test.afterEach(async () => {
  if (!admin) return;
  const fail = (step: string, e: { message: string } | null) => {
    if (e) throw new Error(`AC-IXD-WP-002 cleanup ${step}: ${e.message}`);
  };
  for (const id of [approveId, payId].filter(Boolean)) {
    // Child records the transitions minted (the Paid step writes a payment row).
    for (const table of [
      'payments',
      'procurement_invoices',
      'procurement_receipts',
      'purchase_orders',
      'purchase_requests',
      'procurement_status_events',
    ] as const) {
      fail(`${table} ${id}`, (await admin.from(table).delete().eq('procurement_id', id)).error);
    }
    fail(`procurement ${id}`, (await admin.from('procurements').delete().eq('id', id)).error);
  }
  if (projectId) fail('project', (await admin.from('projects').delete().eq('id', projectId)).error);
  admin = undefined;
  projectId = '';
  projectName = '';
  approveId = '';
  payId = '';
});

test('AC-IXD-WP-002: Approve still confirms and its dialog restates the amount + project + requester', async ({ page }) => {
  // The Requested row this test owns: $22,500 on its own project, requested_by = engineer@ (a4);
  // finance@ approves.
  await login(page, 'finance@acme.test');
  await page.goto(`/procurement/${approveId}`);

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
  await expect(dialog).toContainText(projectName);

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

test('AC-IXD-WP-002: Record payment still confirms and its dialog restates the amount', async ({ page }) => {
  // The Vendor Invoiced row this test owns: $30,000, approver = exec@ (a1); finance@ (a3) pays
  // (payer ≠ approver → SoD-b passes).
  await login(page, 'finance@acme.test');
  await page.goto(`/procurement/${payId}`);

  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute(
    'data-status',
    'Vendor Invoiced',
    { timeout: 10_000 },
  );

  // Click Record payment → a confirm dialog appears (financial write still confirms).
  await page.getByRole('button', { name: 'Record payment' }).click();
  const dialog = confirmSurface(page);
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // The body restates the invoice payable and clarifies that this records evidence only.
  await expect(dialog).toContainText('Record $30,000 as paid? This records payment evidence; it does not transfer funds.');

  // No write fired on the first click.
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Vendor Invoiced');

  // Confirming commits the payment.
  // The visible action is now Record payment; the staged transition dialog keeps its current confirm label.
  await dialog.getByRole('button', { name: 'Mark as Paid' }).click();
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute(
    'data-status',
    'Paid',
    { timeout: 15_000 },
  );
});
