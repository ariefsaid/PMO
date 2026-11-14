// @e2e-isolation: dedicated-row — a fresh tenant, project and uniquely named Odoo records.
import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { accessToken, adminClient, ANON_KEY, AUTH_URL, must, provisionOdooOrg, scenarioGate, setup, signIn, sweep, type ScenarioOrg } from './_connectScenario';

const gate = scenarioGate('AC-ODA-022');
test.skip(!gate.ready, gate.reason);
test.setTimeout(300_000);

test('AC-ODA-022: Finance sees the same Odoo project amount and reconciliation on budget and trial balance', async ({ page }) => {
  const admin = adminClient();
  const stamp = `ODA022-${Date.now().toString(36)}`;
  let scenario: ScenarioOrg | undefined;
  let partner = 0, account = 0, analytic = 0, move = 0;
  let financeId = '', budgetId = '';
  try {
    scenario = await provisionOdooOrg(admin, stamp);
    const { call, company, orgId } = scenario;
    const make = async (model: string, values: Record<string, unknown>) => (await call<number[]>(model, 'create', { vals_list: [values] }))[0];
    partner = await make('res.partner', { name: stamp });
    account = await make('account.account', { name: stamp, code: `${Date.now()}`.slice(-8), account_type: 'expense', company_ids: [[6, 0, [company.id]]] });
    analytic = await make('account.analytic.account', { name: stamp, plan_id: scenario.planId, company_id: company.id });
    move = await make('account.move', { move_type: 'in_invoice', partner_id: partner, invoice_date: new Date().toISOString().slice(0, 10),
      invoice_line_ids: [[0, 0, { name: stamp, quantity: 1, price_unit: 234500, account_id: account, tax_ids: [[5, 0, 0]], analytic_distribution: { [analytic]: 100 } }]] });
    await call('account.move', 'action_post', { ids: [move] });
    const projectId = crypto.randomUUID();
    await must('project', admin.from('projects').insert({ id: projectId, org_id: orgId, name: stamp, code: stamp, status: 'Ongoing Project' }).select('id'));
    const version = await must('budget', admin.from('budget_versions').insert({ org_id: orgId, project_id: projectId, name: stamp, version: 1, status: 'Draft', currency: company.currency }).select('id').single());
    budgetId = version.id;
    await must('budget line', admin.from('budget_line_items').insert({ org_id: orgId, budget_version_id: budgetId, category: 'Materials', budgeted_amount: 500000 }).select('id'));
    await must('activate budget', admin.from('budget_versions').update({ status: 'Active' }).eq('id', budgetId).select('id'));
    await sweep();
    const token = await accessToken(scenario.admin);
    await setup(token, { setupAction: 'set-analytic-plan', planId: String(scenario.planId) });
    const actorClient = createClient(AUTH_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const signed = await actorClient.auth.signInWithPassword({ email: scenario.admin.email, password: scenario.admin.password });
    if (signed.error) throw signed.error;
    const switched = await actorClient.rpc('switch_odoo_ledger_basis', { p_confirm_difference: false, p_reason: null });
    if (switched.error) throw switched.error;
    const serviceRpc = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
    await must('link project', serviceRpc('link_odoo_cost_account', { p_org_id: orgId, p_actor_id: scenario.admin.id, p_project_id: projectId, p_account_id: String(analytic) }));
    const [odooAccount] = await call<Array<{ code: string }>>('account.account', 'read', { ids: [account], fields: ['code'] });
    await must('map expense account', admin.from('budget_category_account_map').insert({ org_id: orgId, erp_account: odooAccount.code, category: 'Materials' }).select('id'));
    await sweep();
    const email = `${stamp.toLowerCase()}-finance@example.test`, password = `${crypto.randomUUID()}Aa1!`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error('could not create Finance user');
    financeId = created.data.user.id;
    await must('Finance profile', admin.from('profiles').insert({ id: financeId, org_id: orgId, email, full_name: stamp, role: 'Finance', status: 'active', locale: 'en', timezone: 'UTC' }).select('id'));
    await signIn(page, { id: financeId, email, password });
    await page.goto(`/projects/${projectId}/budget`);
    await expect(page.getByText(/Odoo ledger as of/i)).toBeVisible();
    await expect(page.getByText('Matches Odoo', { exact: true })).toBeVisible();
    const materialsRow = page.getByRole('row').filter({ hasText: 'Materials' });
    await expect(materialsRow).toContainText(/234[,.]500/);
    await page.goto('/finance/statements');
    await expect(page.getByText(/Odoo ledger as of/i)).toBeVisible();
    await expect(page.getByText('Matches Odoo', { exact: true })).toBeVisible();
    const accountRow = page.getByRole('row').filter({ hasText: odooAccount.code });
    await expect(accountRow).toContainText(/234[,.]500/);
  } finally {
    if (scenario) {
      if (financeId) { await admin.from('profiles').delete().eq('id', financeId); await admin.auth.admin.deleteUser(financeId); }
      if (budgetId) { await admin.from('budget_line_items').delete().eq('budget_version_id', budgetId); await admin.from('budget_versions').delete().eq('id', budgetId); }
      if (move) { await scenario.call('account.move', 'button_draft', { ids: [move] }); await scenario.call('account.move', 'unlink', { ids: [move] }); }
      if (analytic) await scenario.call('account.analytic.account', 'unlink', { ids: [analytic] });
      if (account) await scenario.call('account.account', 'unlink', { ids: [account] });
      if (partner) await scenario.call('res.partner', 'unlink', { ids: [partner] });
      await scenario.cleanup();
    }
  }
});
