// @e2e-isolation: serial — shared seed for the #775 phase B served journey (AC-EXP-140).
// Flips org-global state of the shared seed org: its ERPNext binding, the `expenses` ownership row and the account
// map, plus the Engineer's confirmed ERP Employee link. The org row itself is NEVER touched — the claims, the
// advance and the project state their currency (IDR, the bench company's books) explicitly instead.
import { type SupabaseClient } from '@supabase/supabase-js';
import { benchGet, benchPost, createErpProject, ERP_COMPANY, ERPNEXT_SITE_URL, ORG_ID } from './_tspHelpers';
import { SAR_CURRENCY } from './_sarHelpers';

export const ENGINEER_ID = '00000000-0000-0000-0000-0000000000a4'; // engineer@acme.test — the claimant
export const ENGINEER_EMAIL = 'engineer@acme.test';
export const PM_EMAIL = 'pm@acme.test';
export const FINANCE_EMAIL = 'finance@acme.test';
export const EXP_CURRENCY = SAR_CURRENCY;
export const EMPLOYEE_PAYABLE = 'PMO E2E Employee Payable - PSC';
/** Bench Standard-COA account, re-typed Asset/Payable by the 2026-10-07 spike (§2 accounts table). */
export const EMPLOYEE_ADVANCE = 'Employee Advances - PSC';
export const TRAVEL_ACCOUNT = 'Travel Expenses - PSC';
export const CASH_ACCOUNT = 'Cash - PSC';
const CLAIMANT_FIRST_NAME = 'PMO E2E Expense Claimant';

export interface ExpSeed {
  projectId: string;
  erpProject: string;
  /** The bench Employee the claimant is linked to. */
  employee: string;
  employeeRowId: string;
  previousBinding: Record<string, unknown> | null;
}

async function benchExists(path: string): Promise<boolean> {
  try {
    await benchGet(path);
    return true;
  } catch {
    return false;
  }
}

/** The bench fixtures this journey needs, created once and reused (the bench is disposable). */
async function ensureBenchFixtures(): Promise<string> {
  if (!(await benchExists(`/api/resource/Account/${encodeURIComponent(EMPLOYEE_PAYABLE)}`))) {
    await benchPost('Account', {
      account_name: 'PMO E2E Employee Payable', parent_account: 'Accounts Payable - PSC', company: ERP_COMPANY,
      root_type: 'Liability', account_type: 'Payable', is_group: 0,
    });
  }
  const filters = encodeURIComponent(JSON.stringify([['first_name', '=', CLAIMANT_FIRST_NAME], ['company', '=', ERP_COMPANY]]));
  const found = (await benchGet(`/api/resource/Employee?filters=${filters}&fields=${encodeURIComponent('["name"]')}`)) as Array<{ name: string }>;
  if (found.length > 0) return found[0].name;
  const created = (await benchPost('Employee', {
    first_name: CLAIMANT_FIRST_NAME, gender: 'Male', date_of_birth: '1990-01-01', date_of_joining: '2024-01-01',
    company: ERP_COMPANY, status: 'Active',
  })) as { name: string };
  return created.name;
}

export async function seedExp(admin: SupabaseClient, suffix: string): Promise<ExpSeed> {
  const employee = await ensureBenchFixtures();
  const erpProject = await createErpProject(`PMO E2E EXP ${suffix}`);

  // The journey decides on the FLAT route (no budget, no senior set). An org-level approver left by another spec
  // would route the claim away from the PM — refuse loudly rather than fail mysteriously.
  const { count } = await admin.from('spend_approvers').select('id', { count: 'exact', head: true })
    .eq('org_id', ORG_ID).is('project_id', null);
  if ((count ?? 0) > 0) throw new Error('AC-EXP-140 needs the flat approval route: remove org-level spend_approvers first');

  const projectId = crypto.randomUUID();
  const { error: projectErr } = await admin.from('projects').insert({
    id: projectId, org_id: ORG_ID, name: `EXP-B-${suffix}`, status: 'Ongoing Project',
    // Stated, never stamped from the org: the bench company keeps IDR books; expenses carry no VAT.
    currency: EXP_CURRENCY, subject_to_vat: false,
  });
  if (projectErr) throw new Error(`seed project failed: ${projectErr.message}`);

  // One binding row per (org, tier) is shared by every domain — MERGE this run's config over it, and put the
  // previous row back exactly at cleanup.
  const { data: previous } = await admin.from('external_org_bindings').select('*')
    .eq('org_id', ORG_ID).eq('external_tier', 'erpnext').maybeSingle();
  const priorConfig = ((previous as { config?: Record<string, unknown> } | null)?.config ?? {}) as Record<string, unknown>;
  const priorMap = (priorConfig.project_map as Record<string, string> | undefined) ?? {};
  const { error: bindingErr } = await admin.from('external_org_bindings').upsert({
    org_id: ORG_ID, external_tier: 'erpnext', site_url: ERPNEXT_SITE_URL, secret_ref: 'local-bench',
    webhook_secret_ref: 'DEMO_ERP_WEBHOOK_SECRET', version_major: 15, activated_at: new Date().toISOString(),
    config: {
      ...priorConfig, company: ERP_COMPANY, default_cash_account: CASH_ACCOUNT, default_payable_account: 'Creditors - PSC',
      cost_center: 'Main - PSC', project_map: { ...priorMap, [projectId]: erpProject },
    },
  }, { onConflict: 'org_id,external_tier' });
  if (bindingErr) throw new Error(`seed binding failed: ${bindingErr.message}`);
  const { error: ownErr } = await admin.from('external_domain_ownership')
    .upsert({ org_id: ORG_ID, external_tier: 'erpnext', domain: 'expenses' }, { onConflict: 'org_id,external_tier,domain' });
  if (ownErr) throw new Error(`seed expenses ownership failed: ${ownErr.message}`);

  // The Engineer's CONFIRMED ERP Employee link (0148 semantics; seeded, as every served spec does). Residue from a
  // run that died mid-way would violate the one-confirmed-link-per-user index, so clear it first.
  await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'timesheets').eq('external_record_id', `Employee:${employee}`);
  await admin.from('erp_employees').delete().eq('org_id', ORG_ID).eq('profile_id', ENGINEER_ID);
  const employeeRowId = crypto.randomUUID();
  const { error: empErr } = await admin.from('erp_employees').insert({
    id: employeeRowId, org_id: ORG_ID, employee_number: employee, employee_name: CLAIMANT_FIRST_NAME,
    profile_id: ENGINEER_ID, link_state: 'confirmed', linked_at: new Date().toISOString(),
  });
  if (empErr) throw new Error(`seed erp_employees failed: ${empErr.message}`);
  const { error: refErr } = await admin.from('external_refs').upsert({
    org_id: ORG_ID, domain: 'timesheets', pmo_record_id: employeeRowId, external_tier: 'erpnext',
    external_record_id: `Employee:${employee}`,
  }, { onConflict: 'org_id,domain,external_record_id' });
  if (refErr) throw new Error(`seed external_refs (employee) failed: ${refErr.message}`);

  await admin.from('expense_account_map').delete().eq('org_id', ORG_ID);
  const { error: mapErr } = await admin.from('expense_account_map').insert([
    { org_id: ORG_ID, account_key: 'employee_payable', erp_account: EMPLOYEE_PAYABLE },
    { org_id: ORG_ID, account_key: 'employee_advance', erp_account: EMPLOYEE_ADVANCE },
    { org_id: ORG_ID, account_key: 'Travel', erp_account: TRAVEL_ACCOUNT },
  ]);
  if (mapErr) throw new Error(`seed expense_account_map failed: ${mapErr.message}`);

  return { projectId, erpProject, employee, employeeRowId, previousBinding: (previous as Record<string, unknown> | null) ?? null };
}

/** A Draft claim or advance for the Engineer, with its currency STATED (the client grant cannot state it, and the
 *  org default is not the bench's currency). Created as service role exactly as an importer would. */
export async function createDraft(
  admin: SupabaseClient,
  row: { id: string; kind: 'claim' | 'advance'; title: string; projectId: string; amount?: number; advanceId?: string },
): Promise<void> {
  const { error } = await admin.from('expense_claims').insert({
    id: row.id, org_id: ORG_ID, claimant_id: ENGINEER_ID, kind: row.kind, title: row.title, project_id: row.projectId,
    currency: EXP_CURRENCY, amount: row.amount ?? 0, ...(row.advanceId ? { advance_id: row.advanceId } : {}),
  });
  if (error) throw new Error(`seed ${row.kind} ${row.id} failed: ${error.message}`);
}

export async function cleanupExp(admin: SupabaseClient, seed: ExpSeed, claimIds: string[]): Promise<void> {
  const { data: intents } = await admin.from('expense_posting_erp_mirror').select('posting_identity')
    .eq('org_id', ORG_ID).in('claim_id', claimIds.length ? claimIds : ['00000000-0000-0000-0000-000000000000']);
  for (const { posting_identity: identity } of (intents as Array<{ posting_identity: string }> | null) ?? []) {
    await admin.from('notifications').delete().eq('org_id', ORG_ID).contains('metadata', { postingIdentity: identity });
  }
  for (const id of claimIds) {
    await admin.from('external_command_outbox').delete().eq('org_id', ORG_ID).eq('domain', 'expenses').like('pmo_record_id', `${id}%`);
    await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'expenses').like('pmo_record_id', `${id}%`);
  }
  // A claim before the advance it settles (FK); lines, files, returns and intents cascade.
  for (const id of claimIds) await admin.from('expense_claims').delete().eq('id', id);
  await admin.from('expense_account_map').delete().eq('org_id', ORG_ID);
  await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'timesheets').eq('pmo_record_id', seed.employeeRowId);
  await admin.from('erp_employees').delete().eq('id', seed.employeeRowId);
  await admin.from('external_domain_ownership').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext').eq('domain', 'expenses');
  if (seed.previousBinding) {
    await admin.from('external_org_bindings').upsert(seed.previousBinding, { onConflict: 'org_id,external_tier' });
  } else {
    await admin.from('external_org_bindings').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
  }
  await admin.from('projects').delete().eq('id', seed.projectId);
}
