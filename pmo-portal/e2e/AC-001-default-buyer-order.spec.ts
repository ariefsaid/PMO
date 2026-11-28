// @e2e-isolation: self-isolated — owns its organisation, people, supplier and purchase.
import { test, expect } from '@playwright/test';
import { recordOrderWithConfirm } from './helpers';
import { need, ok, runId, serviceClient } from './support/jobFixtures';
import { createJobRoleUser, removeJobOrganization } from './support/jobRoleUser';

test.setTimeout(120_000);
const db = serviceClient('default Buyer order');
let orgId = '';
let buyer: Awaited<ReturnType<typeof createJobRoleUser>>;
let requester: Awaited<ReturnType<typeof createJobRoleUser>>;
let approver: Awaited<ReturnType<typeof createJobRoleUser>>;
let purchaseId = '';
let supplierName = '';

test.beforeEach(async () => {
  const tag = runId('buyer-default');
  orgId = crypto.randomUUID();
  ok('organisation', await db.from('organizations').insert({ id: orgId, name: tag, built_in_roles_enabled: true }));
  buyer = await createJobRoleUser(db, orgId, 'buyer');
  requester = await createJobRoleUser(db, orgId, 'project_manager');
  approver = await createJobRoleUser(db, orgId, 'finance_manager');
  supplierName = `${tag} Supplier`;
  const vendor = need('supplier', await db.from('companies').insert({ org_id: orgId, name: supplierName, type: 'Vendor' }).select('id').single());
  const purchase = need('approved purchase', await db.from('procurements').insert({ org_id: orgId, title: `${tag} approved`, status: 'Approved', requested_by_id: requester.id, approved_by_id: approver.id, vendor_id: vendor.id, total_value: 100 }).select('id').single());
  purchaseId = purchase.id;
});

test.afterEach(async () => {
  if (orgId) removeJobOrganization(orgId);
  for (const id of [buyer?.id, requester?.id, approver?.id].filter(Boolean)) ok('login cleanup', await db.auth.admin.deleteUser(id));
});

test('AC-001 Buyer orders an approved purchase without an Admin configuring ordering roles', async ({ page }) => {
  await buyer.signIn(page);
  await page.goto(`/procurement/${purchaseId}`);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Approved');
  await recordOrderWithConfirm(page, supplierName);
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Ordered', { timeout: 15_000 });
});
