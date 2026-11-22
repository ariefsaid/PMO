// @e2e-isolation: self-isolated — creates its own client, project, contract line, work order, delivery record and document; deletes them in afterEach.
// JOB-PM-7 / AR-1 (billing can start): a client acceptance recorded by the Project Manager (the delivery record, BAST) names who confirms it, shows
// that person a visible confirm control on the work-order page, and once confirmed the billing claim can start. Goal oracle: the record reads
// Confirmed after Finance (a different person from the author) confirms it, and Finance reaches the claims board from the Finance page.
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signIn } from './helpers';
import { runId, serviceClient } from './support/jobFixtures';
import { PM_ID, inDays, sql } from './support/jobJourney';
import { cleanupBilling, createBillingFixture, type BillingFixture } from './support/billingFixture';

test.setTimeout(180_000);

let admin: SupabaseClient;
let fx: BillingFixture | undefined;
let acceptanceId = '';

test.afterEach(async () => {
  if (!admin || !fx) return;
  if (!/^[0-9a-f-]{36}$/.test(fx.projectId)) throw new Error('Invalid fixture project id');
  // Acceptances are append-only for the client; the local database is cleaned as superuser, scoped to this project.
  sql(`begin; set local session_replication_role = replica;
    delete from public.work_order_acceptance_lines where acceptance_id in (select id from public.work_order_acceptances where project_id = '${fx.projectId}');
    delete from public.work_order_acceptances where project_id = '${fx.projectId}'; commit;`);
  await cleanupBilling(admin, fx);
  fx = undefined;
});

test('JOB-PM-7 the delivery record names who confirms it, Finance confirms it from the work-order page, and finds the claims board in one tap', async ({ page }) => {
  admin = serviceClient('JOB-PM-7');
  fx = await createBillingFixture(admin, runId('JOBPM7'));
  acceptanceId = crypto.randomUUID();
  // The Project Manager prepared this record (author = PM, so Finance is a different person and may confirm it).
  sql(`begin; set local session_replication_role = replica;
    insert into public.work_order_acceptances (id, org_id, project_id, work_order_id, acceptance_date, is_final, prepared_by, document_id, status)
      values ('${acceptanceId}', '${'00000000-0000-0000-0000-000000000001'}', '${fx.projectId}', '${fx.workOrderId}', '${inDays(0)}', false, '${PM_ID}', '${fx.documentId}', 'Draft');
    insert into public.work_order_acceptance_lines (acceptance_id, boq_item_id, quantity) values ('${acceptanceId}', '${fx.boqId}', 4);
    commit;`);

  await signIn(page, 'finance@acme.test');
  await page.goto(`/work-orders/${fx.workOrderId}`);
  const row = page.getByTestId(`acceptance-${acceptanceId}`);
  // The chip names who it waits on: no unnamed "other party".
  await expect(row).toContainText(/Waiting for Finance or an Admin to confirm|Menunggu konfirmasi Keuangan atau Admin/);
  await row.getByRole('button', { name: /Confirm BAST|Konfirmasi BAST/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Confirm BAST|Konfirmasi BAST/ }).click();
  await expect(row).toContainText(/Confirmed|Dikonfirmasi/, { timeout: 15_000 });

  // Starting from the confirmed BAST carries its work order and accepted quantity into the claim.
  await page.goto(`/projects/${fx.projectId}/work-orders`);
  const order = page.getByTestId(`customer-order-${fx.workOrderId}`);
  await order.getByRole('button', { name: /Start a claim from this BAST|Mulai klaim dari BAST ini/ }).click();
  const claim = page.getByRole('dialog');
  await expect(claim.getByLabel(/^(Bills|Menagih)$/i)).toHaveValue(fx.workOrderId);
  await expect(claim.getByLabel(/SURVEY/)).toHaveValue('4');
  await claim.getByRole('button', { name: /Cancel|Batal/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: /Discard|Buang/ }).click();

  // The claims board is one tap from the Finance page.
  await page.goto('/finance');
  await page.getByTestId('finance-hub-claims-board-link').click();
  await expect(page).toHaveURL(/\/finance\/billing-board/);
});
