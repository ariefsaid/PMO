// @e2e-isolation: self-isolated — owns an organisation, two job logins, its Admin, approved plan and generated purchases; changes no shared setting.
import { test, expect } from '@playwright/test';
import { serviceClient, need, ok, runId } from './support/jobFixtures';
import { createJobRoleUser, removeJobOrganization } from './support/jobRoleUser';

test.setTimeout(180_000);
const db = serviceClient('equipment-plan purchase submission');
let orgId = '';
let adminId = '';
let buyer: Awaited<ReturnType<typeof createJobRoleUser>>;
let officer: Awaited<ReturnType<typeof createJobRoleUser>>;
let purchases: { id: string; title: string }[] = [];
let tag = '';

test.beforeEach(async () => {
  tag = runId('buyer-plan');
  orgId = crypto.randomUUID();
  ok('organisation', await db.from('organizations').insert({ id: orgId, name: tag, built_in_roles_enabled: true }));
  buyer = await createJobRoleUser(db, orgId, 'buyer');
  officer = await createJobRoleUser(db, orgId, 'equipment_officer');
  const email = `${tag}-admin@example.test`;
  const password = crypto.randomUUID() + 'Aa1!';
  const user = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (user.error || !user.data.user) throw user.error ?? new Error('Admin fixture missing');
  adminId = user.data.user.id;
  ok('Admin profile', await db.from('profiles').upsert({ id: adminId, org_id: orgId, email, full_name: 'Journey Admin', role: 'Admin', status: 'active' }));
  const admin = serviceClient('equipment-plan fixture Admin');
  ok('Admin sign-in', await admin.auth.signInWithPassword({ email, password }));
  ok('ordering roles', await admin.rpc('po_set_order_job_roles', { p_keys: ['buyer'] }));
  ok('purchase types', await admin.rpc('set_purchase_types_enabled', { p_enabled: true }));
  ok('plan settings', await admin.rpc('set_equipment_plan_settings', { p_enabled: true, p_approval_step: 'senior_role', p_allow_self_approval: false }));
  const rental = await db.from('purchase_types').select('id').eq('org_id', orgId).eq('is_rental', true).eq('active', true).limit(1);
  if (rental.error) throw rental.error;
  if (!rental.data?.length) ok('rental type', await db.from('purchase_types').insert({ org_id: orgId, name: 'Equipment rental', is_rental: true, active: true }));
  const project = need('project', await db.from('projects').insert({ org_id: orgId, name: tag, status: 'Ongoing Project' }).select('id').single());
  const vendor = need('vendor', await db.from('companies').insert({ org_id: orgId, name: `${tag} Supplier`, type: 'Vendor' }).select('id').single());
  const plan = need('plan', await db.from('equipment_plans').insert({ org_id: orgId, project_id: project.id, plan_month: '2026-11-01', created_by: officer.id }).select('id').single());
  ok('plan lines', await db.from('equipment_plan_lines').insert([1, 2].map((n) => ({ id: crypto.randomUUID(), org_id: orgId, plan_id: plan.id, description: `${tag} unit ${n}`, quantity: 1, rate: 100, vendor_id: vendor.id, date_from: '2026-11-01', date_to: '2026-11-30' }))));
  ok('submitted plan', await db.from('equipment_plans').update({ status: 'Submitted', submitted_at: new Date().toISOString() }).eq('id', plan.id));
  ok('independent plan approval', await admin.rpc('approve_equipment_plan', { p_id: plan.id }));
  purchases = need('generated purchases', await db.from('procurements').select('id,title').eq('org_id', orgId));
  expect(purchases).toHaveLength(2);
});

test.afterEach(async () => {
  if (orgId) removeJobOrganization(orgId);
  for (const id of [buyer?.id, officer?.id, adminId].filter(Boolean)) ok('login cleanup', await db.auth.admin.deleteUser(id));
});

test('AC-EPS-006 Buyer submits the equipment officer’s two generated rental purchases for normal approval', async ({ page }) => {
  await buyer.signIn(page);
  for (const purchase of purchases) {
    await page.goto('/procurement?view=table');
    await page.getByRole('button', { name: `Open ${purchase.title}`, exact: true }).click();
    await page.getByRole('link', { name: 'Open full page', exact: true }).click();
    await page.getByRole('button', { name: 'Submit for approval', exact: true }).click();
    await expect.poll(async () => need('submitted purchase', await db.from('procurements').select('status,requested_by_id').eq('id', purchase.id).single())).toEqual({ status: 'Requested', requested_by_id: officer.id });
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  }
});
