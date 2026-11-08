// @e2e-isolation: dedicated-row — owns a fresh PMO org and uniquely stamped Odoo records; nothing shared is mutated.
// AC-ODC-080 (goal oracle): an Admin connects a new org to Odoo, maps once, links the pilot project by sending it, reviews a partner, employs companies;
// the setup checklist is complete after a fresh sign-in and the project's cost account equals the bed's value.
// The Odoo section has no census/accept/send/employ screen yet, so those steps call the same setup verbs the Integrations screen calls (see s10-app-failures).
import { test, expect } from '@playwright/test';
import { accessToken, adminClient, must, provisionOdooOrg, scenarioGate, setup, openOdooSection, signIn, sweep, sweepUntil, type ScenarioOrg } from './_connectScenario';

const gate = scenarioGate('AC-ODC-080');
test.skip(!gate.ready, gate.reason);
test.setTimeout(480_000);

let scenario: ScenarioOrg | undefined;
let partnerIds: number[] = [];
let sentCodes: string[] = [];
test.afterAll(async () => {
  const call = scenario?.call;
  if (call) {
    const sent = await call<number[]>('res.partner', 'search', { domain: [['name', 'like', scenario!.stamp]], context: { active_test: false } }).catch(() => []);
    await call('res.partner', 'unlink', { ids: [...new Set([...partnerIds, ...sent])] }).catch(() => undefined);
    const accounts = await call<number[]>('account.analytic.account', 'search', { domain: [['code', 'in', sentCodes]], context: { active_test: false } }).catch(() => []);
    await call('account.analytic.account', 'unlink', { ids: accounts }).catch(() => undefined);
  }
  await scenario?.cleanup();
});

test('AC-ODC-080: a new org reaches a complete Odoo setup, with the pilot project linked by sending it', async ({ page }) => {
  const admin = adminClient();
  const stamp = `ODC080-${Date.now().toString(36)}`;
  scenario = await provisionOdooOrg(admin, stamp);
  const { orgId, call } = scenario;
  const token = await accessToken(scenario.admin);

  const vendor = crypto.randomUUID(), project = crypto.randomUUID();
  const code = `${stamp}-P1`.toUpperCase();
  sentCodes = [code];
  await must('vendor', admin.from('companies').insert({ id: vendor, org_id: orgId, name: `${stamp} PT Sinar Baja`, type: 'Vendor' }).select('id'));
  await must('project', admin.from('projects').insert({ id: project, org_id: orgId, code, name: `${stamp} pilot`, status: 'Ongoing Project' }).select('id'));
  // A unit PMO uses (a BOQ line), so Map once has a unit to match.
  await must('boq', admin.from('boq_items').insert({ org_id: orgId, project_id: project, item_code: `${stamp}-1`, description: `${stamp} line`, quantity: 1, rate: 1000, unit: 'Units' }).select('id'));
  partnerIds = await call<number[]>('res.partner', 'create', { vals_list: [{ name: `${stamp} Odoo-only partner`, is_company: true, supplier_rank: 1 }] });
  await sweep();

  await signIn(page, scenario.admin);
  await openOdooSection(page);
  // Map once: accept the proposal in one step.
  const acceptAll = page.getByTestId('odoo-map-once').getByRole('button', { name: 'Accept all' });
  await expect(acceptAll).toBeVisible({ timeout: 60_000 });
  const unitRow = page.getByTestId('odoo-map-once').getByLabel('Unit "Units"');
  await expect(unitRow).toBeVisible();
  if (!(await unitRow.inputValue().catch(() => ''))) await unitRow.selectOption({ label: 'Units' }).catch(() => undefined);
  if (await acceptAll.isEnabled()) { await acceptAll.click(); await expect(page.getByText('Saved.')).toBeVisible(); }
  await setup(token, { setupAction: 'set-analytic-plan', planId: String(scenario.planId) });

  // Link the pilot project by sending it: census, accept, drain.
  await setup(token, { setupAction: 'census' });
  await sweepUntil(() => setup<{ proposalCounts: Record<string, { send: number; bring_in: number }> }>(token, { setupAction: 'connect-status' }),
    (s) => (s.proposalCounts.project?.send ?? 0) >= 1 && (s.proposalCounts.party?.bring_in ?? 0) >= 1, 'the proposals are ready');
  await setup(token, { setupAction: 'accept-proposals' });
  // Review the partners Odoo could not classify (its own login partners, s10-app-failures F2): a person dismisses them, which lets the run finish.
  const open = await setup<{ proposals: Array<{ id: string; pmo_ids: string[] }> }>(token, { setupAction: 'list-proposals', state: 'open', outcome: 'review' });
  for (const row of open.proposals.filter((r) => r.pmo_ids.length === 0)) await setup(token, { setupAction: 'decide-review', id: row.id, choice: { action: 'dismiss' } });
  await sweepUntil(async () => ({
    waiting: (await setup<{ waitingForSend: number }>(token, { setupAction: 'connect-status' })).waitingForSend,
    accounts: await call<number>('account.analytic.account', 'search_count', { domain: [['code', '=', code]] }),
  }), (s) => s.waiting === 0 && s.accounts === 1, 'sends finished');
  await setup(token, { setupAction: 'employ-domain', domain: 'companies' });

  // Fresh sign-in: every checklist step is Done.
  await page.context().clearCookies();
  await page.goto('/login');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await signIn(page, scenario.admin);
  await openOdooSection(page);
  const binding = await must('binding config', admin.from('external_org_bindings').select('config').eq('org_id', orgId).eq('external_tier', 'odoo'));
  const cfg = (binding[0]?.config ?? {}) as Record<string, unknown>;
  const saved = ['account_defaults', 'unit_map', 'default_warehouse_id'].map((k) => `${k}=${JSON.stringify(cfg[k] ?? null)}`).join(' ');
  const checklist = page.getByTestId('odoo-checklist');
  for (const step of ['Odoo connected', 'Company chosen', 'Odoo apps available', 'Map once', 'Sends finished', 'Vendors and clients managed in Odoo']) {
    await expect(checklist.getByRole('listitem', { name: step })).toContainText('Done', { timeout: 30_000 }).catch((e: Error) => { throw new Error(`${step}: saved config ${saved}\n${e.message}`); });
  }

  // Goal oracle: the project is linked to the one cost account the bed holds for its code.
  const accounts = await call<Array<{ id: number }>>('account.analytic.account', 'search_read', { domain: [['code', '=', code]], fields: ['id'] });
  expect(accounts).toHaveLength(1);
  const linked = await must('binding', admin.from('external_project_bindings').select('external_container_id').eq('org_id', orgId).eq('project_id', project).eq('external_tier', 'odoo'));
  expect(linked.map((b) => b.external_container_id)).toEqual([String(accounts[0].id)]);
});
