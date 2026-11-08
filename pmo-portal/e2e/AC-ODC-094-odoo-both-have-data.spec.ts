// @e2e-isolation: dedicated-row — owns a fresh PMO org and uniquely stamped Odoo records; nothing shared is mutated.
// AC-ODC-094 (scenario S-D; AC-ECA-051 Odoo parity): PMO and Odoo both hold data. Matching partners link, PMO-only ones are sent, Odoo-only ones brought in, an ambiguous name waits for a person.
// The Odoo section has no census/accept screen yet, so the journey calls the same setup verbs the Integrations screen calls (see s10-app-failures).
import { test, expect } from '@playwright/test';
import { accessToken, adminClient, must, provisionOdooOrg, scenarioGate, setup, sweep, sweepUntil, type ScenarioOrg } from './_connectScenario';

const gate = scenarioGate('AC-ODC-094');
test.skip(!gate.ready, gate.reason);
test.setTimeout(420_000);

let scenario: ScenarioOrg | undefined;
let bedIds: number[] = [];
test.afterAll(async () => {
  await scenario?.call('res.partner', 'unlink', { ids: bedIds }).catch(() => undefined);
  await scenario?.call('account.analytic.account', 'unlink', { ids: bedAccounts }).catch(() => undefined);
  await scenario?.cleanup();
});
let bedAccounts: number[] = [];

test('AC-ODC-094: matching partners link, PMO-only are sent, Odoo-only are brought in, two same-name companies stay for review, and a matching project code links', async () => {
  const admin = adminClient();
  const stamp = `ODC094-${Date.now().toString(36)}`;
  scenario = await provisionOdooOrg(admin, stamp);
  const { orgId, call } = scenario;
  const token = await accessToken(scenario.admin);
  const n = (s: string) => `${stamp} ${s}`;
  const taxId = `99.${String(Date.now()).slice(-9)}`;

  // PMO: A (tax id), B (name only), C (PMO-only), two companies named E.
  const A = crypto.randomUUID(), B = crypto.randomUUID(), C = crypto.randomUUID(), E1 = crypto.randomUUID(), E2 = crypto.randomUUID();
  await must('companies', admin.from('companies').insert([
    { id: A, org_id: orgId, name: n('PT Sinar Baja A'), type: 'Vendor' as const, erp_tax_id: taxId },
    { id: B, org_id: orgId, name: n('PT Sinar Baja B'), type: 'Vendor' as const },
    { id: C, org_id: orgId, name: n('PT Sinar Baja C'), type: 'Vendor' as const },
    { id: E1, org_id: orgId, name: n('PT Sinar Baja E'), type: 'Vendor' as const },
    { id: E2, org_id: orgId, name: n('PT Sinar Baja E'), type: 'Vendor' as const },
  ]).select('id'));
  // The project's number (the field the connect match uses for Odoo) matches an account that already exists on the bed.
  const project = crypto.randomUUID();
  const created = await must('project', admin.from('projects').insert({ id: project, org_id: orgId, code: `${stamp}-P1`.toUpperCase(), name: n('project'), status: 'Ongoing Project' as const }).select('id,pmo_project_number').single());
  const code = created.pmo_project_number;
  bedAccounts = await call<number[]>('account.analytic.account', 'create', { vals_list: [{ name: n('existing cost account'), code, plan_id: scenario.planId }] });

  // Odoo: A' (same tax id, other spelling), B' (same name as B), D (Odoo-only), E' (same name as E).
  bedIds = await call<number[]>('res.partner', 'create', { vals_list: [
    { name: n('Sinar Baja A (PT)'), is_company: true, supplier_rank: 1, vat: taxId },
    { name: n('PT Sinar Baja B'), is_company: true, supplier_rank: 1 },
    { name: n('PT Sinar Baja D'), is_company: true, supplier_rank: 1 },
    { name: n('PT Sinar Baja E'), is_company: true, supplier_rank: 1 },
  ] });
  const [aPrime, bPrime] = bedIds;
  const countByStamp = () => call<number>('res.partner', 'search_count', { domain: [['name', 'like', stamp]], context: { active_test: false } });

  await sweep();
  await setup(token, { setupAction: 'set-analytic-plan', planId: String(scenario.planId) });
  await sweep();
  await setup(token, { setupAction: 'census' });
  await sweepUntil(
    () => setup<{ proposalCounts: Record<string, { link: number; send: number; bring_in: number; review: number }> }>(token, { setupAction: 'connect-status' }),
    (s) => { const p = s.proposalCounts.party; return !!p && p.link >= 2 && p.send >= 1 && p.bring_in >= 1 && p.review >= 1; }, 'the proposals are ready',
  );
  await setup(token, { setupAction: 'accept-proposals' });
  await sweepUntil(
    async () => (await setup<{ waitingForSend: number }>(token, { setupAction: 'connect-status' })).waitingForSend,
    (w) => w === 0, 'sends finished',
  );

  const refs = await must('refs', admin.from('external_refs').select('pmo_record_id,external_record_id').eq('org_id', orgId).eq('external_tier', 'odoo').eq('domain', 'companies'));
  const ext = (pmo: string) => refs.filter((r) => r.pmo_record_id === pmo).map((r) => r.external_record_id);
  expect(ext(A)).toHaveLength(1);
  expect(ext(A)[0]).toMatch(new RegExp(`:${aPrime}$`));
  expect(ext(B)[0]).toMatch(new RegExp(`:${bPrime}$`));
  expect(ext(C)).toHaveLength(1);
  // One PMO row per partner: PMO-only C sent (+1), D brought in; bed holds A', B', C', D, E' = 5.
  const onBed = await call<Array<{ name: string; ref: string | false }>>('res.partner', 'search_read', { domain: [['name', 'like', stamp]], fields: ['name', 'ref'], context: { active_test: false } });
  expect(onBed, JSON.stringify(onBed)).toHaveLength(5);
  const { data: companies } = await admin.from('companies').select('name').eq('org_id', orgId);
  expect((companies ?? []).filter((c) => c.name === n('PT Sinar Baja D'))).toHaveLength(1);

  // E stays a review row; resolving it by linking records one link and creates nothing.
  const open = await setup<{ proposals: Array<{ id: string; outcome: string; pmo_ids: string[]; external_ids: string[] }> }>(token, { setupAction: 'list-proposals', state: 'open', outcome: 'review' });
  // Odoo's built-in partners (Administrator, the adapter user) may also be listed; the decision here is about the two PMO companies named E.
  const eReview = open.proposals.filter((p) => p.pmo_ids.length > 0);
  expect(eReview, JSON.stringify(open.proposals.map((p) => [p.pmo_ids, p.external_ids]))).toHaveLength(1);
  expect([...eReview[0].pmo_ids].sort()).toEqual([E1, E2].sort());
  await setup(token, { setupAction: 'decide-review', id: eReview[0].id, choice: { action: 'link', pmoId: E1, externalId: eReview[0].external_ids[0] } });
  expect(await countByStamp()).toBe(5);

  // The project links to the existing account; no second account is created.
  const accounts = await call<Array<{ id: number }>>('account.analytic.account', 'search_read', { domain: [['code', '=', code]], fields: ['id'] });
  expect(accounts).toHaveLength(1);
  const bound = await must('binding', admin.from('external_project_bindings').select('external_container_id').eq('org_id', orgId).eq('project_id', project).eq('external_tier', 'odoo'));
  const status = await setup<{ proposalCounts: unknown }>(token, { setupAction: 'connect-status' });
  const projRefs = await must('project refs', admin.from('external_refs').select('domain,external_record_id').eq('org_id', orgId).eq('pmo_record_id', project));
  const allProposals: unknown[] = [];
  for (const state of ['open', 'sending', 'applied', 'dismissed']) {
    const r = await setup<{ proposals: Array<{ kind: string; outcome: string; state: string; reason: string | null }> }>(token, { setupAction: 'list-proposals', state });
    allProposals.push(...r.proposals.map((p) => [p.kind, p.outcome, p.state, p.reason]));
  }
  const projectRows = await setup<{ proposals: Array<{ outcome: string; state: string; reason: string | null }> }>(token, { setupAction: 'list-proposals', kind: 'project', state: 'applied' });
  const projectOpen = await setup<{ proposals: Array<{ outcome: string; state: string; reason: string | null }> }>(token, { setupAction: 'list-proposals', kind: 'project', state: 'open' });
  expect(bound.map((b) => b.external_container_id), `all=${JSON.stringify(allProposals)} counts=${JSON.stringify(status.proposalCounts)} refs=${JSON.stringify(projRefs)} project proposals applied=${JSON.stringify(projectRows.proposals.map((p) => [p.outcome, p.state]))} open=${JSON.stringify(projectOpen.proposals.map((p) => [p.outcome, p.reason]))}`).toEqual([String(accounts[0].id)]);
});
