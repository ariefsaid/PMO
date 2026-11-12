// @e2e-isolation: dedicated-row — owns a fresh PMO org and uniquely stamped Odoo records; nothing shared is mutated.
// AC-ODC-080 (goal oracle): an Admin connects a new org to Odoo, maps once, links the pilot project by sending it, reviews the partner rows Odoo's own logins leave behind, employs companies;
// the setup checklist is complete after a fresh sign-in, the brought-in partner and the saved defaults are read back, and the project's cost account equals the bed's value.
// The Odoo section has no census/accept/send/employ screen yet, so those steps call the same setup verbs the Integrations screen calls (see s10-app-failures).
// The account-code oracle expects fix/odoo-send-project-number (FR-ODC-072: the send codes the analytic account with the PMO project number).
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
  await must('vendor', admin.from('companies').insert({ id: vendor, org_id: orgId, name: `${stamp} PT Sinar Baja`, type: 'Vendor' }).select('id'));
  // The PMO project number is what an Odoo send codes the analytic account with (FR-ODC-072), not the client code.
  // The minted number is per-org (every fresh org numbers its first project alike), so seed this run's stamped
  // number explicitly: on the shared bed the whole-bed `code =` searches below match only this run's account.
  const seeded = await must('project', admin.from('projects').insert({ id: project, org_id: orgId, code, name: `${stamp} pilot`, pmo_project_number: `${stamp}-P1`, status: 'Ongoing Project' }).select('id,pmo_project_number').single());
  const projectNumber = seeded.pmo_project_number;
  expect(projectNumber).toBe(`${stamp}-P1`);
  sentCodes = [projectNumber];
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
  // A blank match is a person's step on this screen, not a failure to swallow; then the screen must offer Accept all.
  if (!(await unitRow.inputValue())) await unitRow.selectOption({ label: 'Units' });
  await expect(acceptAll).toBeEnabled({ timeout: 30_000 });
  await acceptAll.click();
  await expect(page.getByText('Saved.')).toBeVisible();
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
    accounts: await call<number>('account.analytic.account', 'search_count', { domain: [['code', '=', projectNumber]] }),
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
  // The defaults half of the AC: Map once saved the account defaults, the PMO unit's match and the receiving warehouse, and they survive re-login.
  expect(Object.keys((cfg.account_defaults ?? {}) as Record<string, string>), `the account defaults Map once saved (${saved})`).not.toHaveLength(0);
  expect((cfg.unit_map as Record<string, string> | undefined)?.Units, `the "Units" match Map once saved (${saved})`).toBeTruthy();
  expect(cfg.default_warehouse_id, `the default warehouse Map once saved (${saved})`).toBeTruthy();
  // The partner half: the Odoo-only partner came into PMO as a company, so the review step and the bring-in both did their job.
  const broughtIn = await must('brought-in partner', admin.from('companies').select('name,type').eq('org_id', orgId).eq('name', `${stamp} Odoo-only partner`));
  expect(broughtIn, 'the Odoo-only partner is one PMO company').toHaveLength(1);
  expect(broughtIn[0].type).toBe('Vendor');
  const checklist = page.getByTestId('odoo-checklist');
  for (const step of ['Odoo connected', 'Company chosen', 'Odoo apps available', 'Map once', 'Sends finished', 'Vendors and clients managed in Odoo']) {
    // soft: a step that stays To do is reported with the saved config, and the remaining steps and the goal oracle still run
    await expect.soft(checklist.getByRole('listitem', { name: step }), `${step}: saved config ${saved}`).toContainText('Done', { timeout: 30_000 });
  }

  // Goal oracle: the project is linked to the one cost account the bed holds, and its code is the PMO project number (FR-ODC-072), not the client code.
  const accounts = await call<Array<{ id: number; code: string }>>('account.analytic.account', 'search_read', { domain: [['code', '=', projectNumber]], fields: ['id', 'code'] });
  expect(accounts).toHaveLength(1);
  expect(accounts[0].code).toBe(projectNumber);
  const linked = await must('binding', admin.from('external_project_bindings').select('external_container_id').eq('org_id', orgId).eq('project_id', project).eq('external_tier', 'odoo'));
  expect(linked.map((b) => b.external_container_id)).toEqual([String(accounts[0].id)]);
});
