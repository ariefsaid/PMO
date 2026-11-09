// @e2e-isolation: serial — rebinds the shared org's ERP binding to v16 and adds a ledger generation (org-global state); restored in afterAll.
/**
 * AC-018 — a whole-project budget goes from Draft to the client's ERP v16 ledger, and Forecast reads it back
 * (budget-whole-project.spec.md FR-005/-008/-013/-017/-018).
 *
 * Given an annual (per-year) Active predecessor already pushed to ERPNext v16 and an independent second approver,
 * When a user previews the yearly grid of a whole-project Draft, saves it, and the second approver activates it
 * through the real Budget tab (the real served `adapter-dispatch` + `erpnext-sweep`, no `page.route`),
 * Then ERPNext holds ONE range Budget per account (`from/to_fiscal_year`, yearly rows, total), the predecessor
 * documents are `docstatus 2`, and Forecast shows the approved category totals against recorded spending.
 *
 * ⚑ The goal oracles are DOCUMENTS read back from the bed and rendered figures, never a toast.
 * Three journeys, each far under 30 s (each page load costs about 2.5 s on CI, #1960); they share one fixture
 * built in `beforeAll` and removed in `afterAll`.
 *
 * Run: scripts/with-erpnext-lock.sh scripts/with-db-lock.sh scripts/serve-functions.sh -- scripts/e2e-local.sh AC-018
 * (bench API key + LOCAL_BENCH_* exported, v16 bed on ERPNEXT_BENCH_URL).
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { login } from '../helpers';
import {
  ORG_ID,
  ACTIVATOR_EMAIL,
  SECOND_ACTIVATOR_EMAIL,
  ERPNEXT_SITE_URL,
  activateVersionAs,
  benchGet,
  benchPost,
  dispatchBudgetPushRaw,
  openBudgetTab,
  runSweepBud,
  signInAsBud,
} from './_budHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY);
if (FUNCTIONS_URL && !READY) {
  throw new Error('AC-018: SUPABASE_FUNCTIONS_URL + SUPABASE_URL + VITE_SUPABASE_ANON_KEY are required once the served lane is up — never a silent skip');
}
if (READY && !SERVICE_KEY) throw new Error('AC-018: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available.');
test.skip(!READY, 'AC-018: served-fn lane not configured — run via scripts/serve-functions.sh against the ERPNext v16 bed');

// The v16 bed's own company, accounts and consecutive fiscal years 2026-2028.
const COMPANY = 'Rehearsal Company';
const LABOR_ACCOUNT = 'Salary - RHC';
const MATERIALS_ACCOUNT = 'Cost of Goods Sold - RHC';
const FY1 = '2026';
const FY2 = '2027';
const PROJECT_START = '2026-03-01';
const PROJECT_END = '2027-09-30';
const TAG = 'AC018';
// The sweep passes this journey does not exercise (ledger and statement feeds) read the whole bed and can exceed the local
// edge runtime's CPU limit, which kills the tick and leaks the org's sweep lease for 15 minutes; the budget reconcile still runs.
const SWEEP_PASSES_OFF = ['erp_sync', 'erp_purchases', 'financial_statements'];

test.describe.configure({ mode: 'serial' });

interface ErpBudget {
  name: string;
  docstatus: number;
  from_fiscal_year: string;
  to_fiscal_year: string;
  budget_amount: number;
  account: string;
  project: string;
  budget_distribution?: Array<{ amount: number; start_date: string; end_date: string }>;
}

const fx = {
  admin: undefined as unknown as SupabaseClient,
  projectId: '',
  erpProject: '',
  predecessorId: '',
  wholeId: '',
  wholeName: '',
  predecessorErp: [] as string[],
  snapshotId: '',
  prior: undefined as unknown as { binding: Record<string, unknown> | null; map: Array<Record<string, unknown>>; features: Array<Record<string, unknown>> },
};

async function listErpBudgets(erpProject: string, live: boolean): Promise<ErpBudget[]> {
  const filters = encodeURIComponent(JSON.stringify([['project', '=', erpProject], ...(live ? [['docstatus', '<', 2]] : [])]));
  const fields = encodeURIComponent(JSON.stringify(['name', 'docstatus', 'from_fiscal_year', 'to_fiscal_year', 'budget_amount', 'account', 'project']));
  return benchGet<ErpBudget[]>(`/api/resource/Budget?limit_page_length=0&filters=${filters}&fields=${fields}`);
}

const digits = (text: string): string => text.replace(/[^\d]/g, '');

/** Remove everything a previous (possibly crashed) run of this spec left behind. */
async function removeFixture(admin: SupabaseClient): Promise<void> {
  const { data: projects } = await admin.from('projects').select('id').like('name', `${TAG}-PROJ-%`);
  for (const { id } of projects ?? []) {
    const { data: versions } = await admin.from('budget_versions').select('id').eq('project_id', id);
    for (const { id: versionId } of versions ?? []) {
      await admin.from('external_command_outbox').delete().eq('org_id', ORG_ID).eq('domain', 'budget').like('pmo_record_id', `${versionId}%`);
      await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'budget').like('pmo_record_id', `${versionId}%`);
      await admin.from('external_ref_lineage').delete().eq('org_id', ORG_ID).eq('domain', 'budget').like('pmo_record_id', `${versionId}%`);
      await admin.from('budget_version_erp_mirror').delete().eq('budget_version_id', versionId);
      await admin.from('budget_line_items').delete().eq('budget_version_id', versionId);
    }
    await admin.from('budget_versions').delete().eq('project_id', id);
    await admin.from('erp_actuals_snapshot').delete().eq('project_id', id);
    await admin.from('projects').delete().eq('id', id);
  }
  await admin.from('notifications').delete().eq('org_id', ORG_ID).contains('metadata', { action_required: 'budget-push-failed' });
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  const admin = createClient(AUTH_URL, SERVICE_KEY);
  fx.admin = admin;
  await removeFixture(admin);

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  fx.erpProject = ((await benchPost('Project', { project_name: `PMO-E2E-${TAG}-${suffix}`, company: COMPANY })) as { name: string }).name;
  fx.projectId = crypto.randomUUID();
  const { error: projErr } = await admin.from('projects').insert({
    id: fx.projectId, org_id: ORG_ID, name: `${TAG}-PROJ-${suffix}`, status: 'Ongoing Project', start_date: PROJECT_START, end_date: PROJECT_END,
  });
  if (projErr) throw new Error(`seed project failed: ${projErr.message}`);

  // Org-global state is snapshotted and put back in afterAll; only this run's own rows are deleted.
  const { data: binding } = await admin.from('external_org_bindings').select('*').eq('org_id', ORG_ID).eq('external_tier', 'erpnext').maybeSingle();
  const priorConfig = ((binding?.config as Record<string, unknown> | undefined) ?? {});
  const { error: bindErr } = await admin.from('external_org_bindings').upsert({
    org_id: ORG_ID, external_tier: 'erpnext', site_url: ERPNEXT_SITE_URL, secret_ref: 'local-bench',
    webhook_secret_ref: 'DEMO_ERP_WEBHOOK_SECRET', version_major: 16,
    config: { ...priorConfig, company: COMPANY, project_map: { ...((priorConfig.project_map as object) ?? {}), [fx.projectId]: fx.erpProject } },
    activated_at: new Date().toISOString(),
  }, { onConflict: 'org_id,external_tier' });
  if (bindErr) throw new Error(`seed binding failed: ${bindErr.message}`);

  const { data: priorMap } = await admin.from('budget_category_account_map').select('org_id, category, erp_account, is_push_target')
    .eq('org_id', ORG_ID).in('category', ['Labor', 'Materials']);
  const { data: priorFeatures } = await admin.from('org_features').select('org_id, feature_key, enabled').eq('org_id', ORG_ID).in('feature_key', SWEEP_PASSES_OFF);
  fx.prior = { binding: binding as Record<string, unknown> | null, map: (priorMap ?? []) as Array<Record<string, unknown>>, features: (priorFeatures ?? []) as Array<Record<string, unknown>> };
  await admin.from('org_features').upsert(SWEEP_PASSES_OFF.map((feature_key) => ({ org_id: ORG_ID, feature_key, enabled: false })), { onConflict: 'org_id,feature_key' });
  await admin.from('erp_sweep_lock').delete().eq('org_id', ORG_ID);
  await admin.from('budget_category_account_map').delete().eq('org_id', ORG_ID).in('category', ['Labor', 'Materials']);
  const { error: mapErr } = await admin.from('budget_category_account_map').insert([
    { org_id: ORG_ID, category: 'Labor', erp_account: LABOR_ACCOUNT, is_push_target: true },
    { org_id: ORG_ID, category: 'Materials', erp_account: MATERIALS_ACCOUNT, is_push_target: true },
  ]);
  if (mapErr) throw new Error(`seed account map failed: ${mapErr.message}`);

  const { data: finance } = await admin.from('profiles').select('id').eq('email', ACTIVATOR_EMAIL).single();
  const drafter = (finance as { id: string }).id;

  // Annual predecessor: phased lines, activated by the second approver, pushed through the real handler.
  fx.predecessorId = crypto.randomUUID();
  const { error: pErr } = await admin.from('budget_versions').insert({
    id: fx.predecessorId, org_id: ORG_ID, project_id: fx.projectId, version: 1, name: `${TAG} annual ${suffix}`, status: 'Draft', created_by: drafter,
  });
  if (pErr) throw new Error(`seed predecessor failed: ${pErr.message}`);
  const { error: plErr } = await admin.from('budget_line_items').insert([
    { org_id: ORG_ID, budget_version_id: fx.predecessorId, category: 'Labor', budgeted_amount: '40000.00', fiscal_year: FY1 },
    { org_id: ORG_ID, budget_version_id: fx.predecessorId, category: 'Materials', budgeted_amount: '20000.00', fiscal_year: FY2 },
  ]);
  if (plErr) throw new Error(`seed predecessor lines failed: ${plErr.message}`);
  await activateVersionAs(AUTH_URL, ANON_KEY, SECOND_ACTIVATOR_EMAIL, fx.predecessorId);
  const token = await signInAsBud(AUTH_URL, ANON_KEY, SECOND_ACTIVATOR_EMAIL);
  const push = await dispatchBudgetPushRaw(FUNCTIONS_URL, ANON_KEY, token, fx.predecessorId);
  expect(push.status, `predecessor push: ${(await push.text()).slice(0, 300)}`).toBeLessThan(300);
  const live = await listErpBudgets(fx.erpProject, true);
  expect(live, 'the annual predecessor has live ERP targets, one per phased account').toHaveLength(2);
  fx.predecessorErp = live.map((b) => b.name);

  // The whole-project Draft the journey works on: no line carries a fiscal year.
  fx.wholeId = crypto.randomUUID();
  fx.wholeName = `${TAG} whole ${suffix}`;
  const { error: wErr } = await admin.from('budget_versions').insert({
    id: fx.wholeId, org_id: ORG_ID, project_id: fx.projectId, version: 2, name: fx.wholeName, status: 'Draft', created_by: drafter, budget_mode: 'whole_project',
  });
  if (wErr) throw new Error(`seed whole-project draft failed: ${wErr.message}`);
  const { error: wlErr } = await admin.from('budget_line_items').insert([
    { org_id: ORG_ID, budget_version_id: fx.wholeId, category: 'Labor', budgeted_amount: '60000.00' },
    { org_id: ORG_ID, budget_version_id: fx.wholeId, category: 'Materials', budgeted_amount: '30000.00' },
  ]);
  if (wlErr) throw new Error(`seed whole-project lines failed: ${wlErr.message}`);
});

test.afterAll(async () => {
  test.setTimeout(120_000);
  const admin = fx.admin ?? createClient(AUTH_URL, SERVICE_KEY);
  // Cancel what this run created on the bed (its Project is fresh, so nothing else is touched).
  if (fx.erpProject) {
    for (const b of await listErpBudgets(fx.erpProject, true).catch(() => [])) {
      await fetch(`${process.env.ERPNEXT_BENCH_URL}/api/resource/Budget/${encodeURIComponent(b.name)}`, {
        method: 'PUT',
        headers: { Authorization: `token ${process.env.ERPNEXT_BENCH_API_KEY}:${process.env.ERPNEXT_BENCH_API_SECRET}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ docstatus: 2 }),
      }).catch(() => undefined);
    }
  }
  await removeFixture(admin);
  await admin.from('budget_category_account_map').delete().eq('org_id', ORG_ID).in('category', ['Labor', 'Materials']);
  await admin.from('erp_sweep_lock').delete().eq('org_id', ORG_ID);
  await admin.from('org_features').delete().eq('org_id', ORG_ID).in('feature_key', SWEEP_PASSES_OFF);
  if (fx.prior?.features.length) await admin.from('org_features').insert(fx.prior.features);
  if (fx.prior?.map.length) await admin.from('budget_category_account_map').insert(fx.prior.map);
  if (fx.prior?.binding) await admin.from('external_org_bindings').upsert(fx.prior.binding, { onConflict: 'org_id,external_tier' });
  else await admin.from('external_org_bindings').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
});

async function openBudget(page: Page, email: string): Promise<void> {
  await login(page, email);
  await openBudgetTab(page, fx.projectId);
  await expect(page.getByTestId('budget-draft-banner')).toContainText(fx.wholeName, { timeout: 20_000 });
}

test.describe('AC-018: a whole-project budget reaches the client ERP and Forecast reads it back', () => {
  test('AC-018 the user previews the yearly grid, saves it, and the saved plan reconciles to the source lines', async ({ page }) => {
    test.setTimeout(60_000);
    await openBudget(page, ACTIVATOR_EMAIL);
    await page.getByTestId('budget-draft-banner').getByRole('button', { name: 'Edit draft' }).click();

    const grid = page.getByTestId('budget-distribution-grid');
    await expect(grid).toBeVisible({ timeout: 20_000 });
    await grid.getByLabel('Distribution method').selectOption('percent_by_year');
    await grid.getByLabel(`Shared input for ${FY1}`).fill('60');
    await grid.getByLabel(`Shared input for ${FY2}`).fill('40');
    await grid.getByRole('button', { name: 'Preview distribution' }).click();

    // Rendered figures: every category row and the year footer reconcile to the source totals.
    await expect(page.getByTestId('budget-distribution-preview-status')).toBeVisible({ timeout: 20_000 });
    const row = (category: string) => grid.getByRole('row', { name: new RegExp(`^${category}`) });
    const cells = async (category: string) => (await row(category).getByRole('cell').allInnerTexts()).map(digits);
    expect(await cells('Labor'), 'Labor 60,000 splits 60/40').toEqual(expect.arrayContaining(['6000000', '3600000', '2400000']));
    expect(await cells('Materials'), 'Materials 30,000 splits 60/40').toEqual(expect.arrayContaining(['3000000', '1800000', '1200000']));
    const footer = (await grid.locator('tfoot').getByRole('cell').allInnerTexts()).map(digits);
    expect(footer, 'year totals 54,000 and 36,000 add to 90,000').toEqual(expect.arrayContaining(['9000000', '5400000', '3600000']));

    await grid.getByRole('button', { name: 'Save reviewed distribution' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save distribution', exact: true }).click();
    await expect(grid.getByText('Saved distribution', { exact: true })).toBeVisible({ timeout: 20_000 });

    // DB oracle: the stored yearly rows are exact and sum to the source line.
    const { data: rows, error } = await fx.admin.from('budget_year_distributions')
      .select('category, fiscal_year, amount').eq('budget_version_id', fx.wholeId);
    expect(error).toBeNull();
    const byKey = Object.fromEntries((rows ?? []).map((r) => [`${r.category}:${r.fiscal_year}`, Number(r.amount)]));
    expect(byKey).toEqual({
      [`Labor:${FY1}`]: 36000, [`Labor:${FY2}`]: 24000, [`Materials:${FY1}`]: 18000, [`Materials:${FY2}`]: 12000,
    });
  });

  test('AC-018 the second approver activates it and ERPNext holds one range Budget per account, the predecessor cancelled', async ({ page }) => {
    test.setTimeout(120_000);
    await openBudget(page, SECOND_ACTIVATOR_EMAIL);
    await page.getByTestId('budget-draft-banner').getByRole('button', { name: /^Activate v2/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Activate version', exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 60_000 });
    // Not "…but ERPNext was not updated": the push itself must have landed (documents are asserted below).
    await expect(page.getByText('Version activated', { exact: true })).toBeVisible({ timeout: 60_000 });

    // The cancellation intents settle through the real sweep; poll the bed, not PMO's opinion of it.
    const settled = async (): Promise<boolean> => {
      // A tick the app's own background sweep overlaps reports lock-held; the next poll simply retries.
      await runSweepBud(FUNCTIONS_URL).catch(() => undefined);
      const live = await listErpBudgets(fx.erpProject, true);
      return live.length === 2 && live.every((b) => b.to_fiscal_year === FY2);
    };
    try {
      await expect.poll(settled, { timeout: 90_000, intervals: [3_000] }).toBe(true);
    } catch (error) {
      const ids = [fx.wholeId, fx.predecessorId];
      const outbox = await fx.admin.from('external_command_outbox').select('pmo_record_id, operation, state, last_error, created_at').eq('domain', 'budget').order('created_at', { ascending: false }).limit(8);
      const versions = await fx.admin.from('budget_versions').select('id, status, budget_mode, version').eq('project_id', fx.projectId);
      const mirrors = await fx.admin.from('budget_version_erp_mirror').select('*').in('budget_version_id', ids);
      throw new Error(`range Budgets did not settle: ${JSON.stringify({ whole: fx.wholeId, pred: fx.predecessorId, erp: await listErpBudgets(fx.erpProject, false), outbox, mirrors, versions })}`, { cause: error });
    }

    const all = await listErpBudgets(fx.erpProject, false);
    const live = all.filter((b) => b.docstatus === 1);
    expect(live.map((b) => b.account).sort(), 'one live Budget per account').toEqual([LABOR_ACCOUNT, MATERIALS_ACCOUNT].sort());
    const docs = await Promise.all(live.map((b) => benchGet<ErpBudget>(`/api/resource/Budget/${encodeURIComponent(b.name)}`)));
    const expectedYears: Record<string, [number, number]> = { [LABOR_ACCOUNT]: [36000, 24000], [MATERIALS_ACCOUNT]: [18000, 12000] };
    const expectedTotal: Record<string, number> = { [LABOR_ACCOUNT]: 60000, [MATERIALS_ACCOUNT]: 30000 };
    for (const doc of docs) {
      expect(doc.from_fiscal_year, `${doc.account} starts in the first year`).toBe(FY1);
      expect(doc.to_fiscal_year, `${doc.account} ends in the last year`).toBe(FY2);
      expect(Number(doc.budget_amount), `${doc.account} total`).toBe(expectedTotal[doc.account]);
      const yearly = (doc.budget_distribution ?? []).map((r) => Number(r.amount));
      expect(yearly, `${doc.account} yearly rows`).toEqual(expectedYears[doc.account]);
      expect((doc.budget_distribution ?? []).map((r) => r.start_date.slice(0, 4))).toEqual([FY1, FY2]);
    }

    // Predecessor documents are cancelled (docstatus 2), not left enforcing next to the range Budget.
    const predecessors = all.filter((b) => fx.predecessorErp.includes(b.name));
    expect(predecessors, 'both predecessor documents still exist as tombstones').toHaveLength(2);
    expect(predecessors.every((b) => b.docstatus === 2), 'predecessor documents are cancelled').toBe(true);

    // PMO's records: whole-project version Active, predecessor Archived, one pushed mirror row per account.
    const { data: versions } = await fx.admin.from('budget_versions').select('id, status').in('id', [fx.predecessorId, fx.wholeId]);
    expect(Object.fromEntries((versions ?? []).map((v) => [v.id, v.status]))).toEqual({ [fx.predecessorId]: 'Archived', [fx.wholeId]: 'Active' });
    // ⚑ The v16 binding mirrors a range budget per ACCOUNT (`budget_version_account_erp_mirror`, 0293/0578).
    // The legacy `budget_version_erp_mirror` has no `erp_account`/`to_fiscal_year` at all, so reading it here
    // erred on every column and `(data ?? [])` turned that error into "no mirror rows" — an oracle that could
    // never fail on the app's real state. The error is asserted, never swallowed.
    const { data: mirrors, error: mirrorErr } = await fx.admin.from('budget_version_account_erp_mirror')
      .select('erp_account, push_state, erp_budget_name, fiscal_year, to_fiscal_year').eq('budget_version_id', fx.wholeId);
    expect(mirrorErr, `mirror read: ${mirrorErr?.message}`).toBeNull();
    expect((mirrors ?? []).map((m) => m.erp_account).sort()).toEqual([LABOR_ACCOUNT, MATERIALS_ACCOUNT].sort());
    for (const m of mirrors ?? []) {
      expect(m.push_state, `mirror ${m.erp_account}: ${JSON.stringify(m)}`).toBe('pushed');
      expect(live.map((b) => b.name)).toContain(m.erp_budget_name);
    }
  });

  test('AC-018 Forecast shows the approved category totals against recorded spending', async ({ page }) => {
    test.setTimeout(60_000);
    // The ledger reading Forecast compares against: one current snapshot generation of mapped-account spending.
    fx.snapshotId = crypto.randomUUID();
    const { error } = await fx.admin.from('erp_actuals_snapshot').insert([
      { org_id: ORG_ID, project_id: fx.projectId, account: LABOR_ACCOUNT, fiscal_year: FY1, debit: 12000, credit: 0, net: 12000, snapshot_id: fx.snapshotId },
      { org_id: ORG_ID, project_id: fx.projectId, account: MATERIALS_ACCOUNT, fiscal_year: FY1, debit: 3000, credit: 0, net: 3000, snapshot_id: fx.snapshotId },
    ]);
    expect(error).toBeNull();

    await login(page, ACTIVATOR_EMAIL);
    await openBudgetTab(page, fx.projectId);
    await page.getByRole('tab', { name: 'Forecast' }).click();
    const forecast = page.getByTestId('budget-forecast-view');
    await expect(forecast.getByRole('combobox', { name: 'Fiscal year' })).toHaveValue(/all/i, { timeout: 30_000 });

    const table = forecast.getByRole('table', { name: 'Approved budget compared with recorded spending' });
    await expect(table).toBeVisible({ timeout: 20_000 });
    // ⚑ Read the FIGURE, not a digit string: read-only money surfaces print WHOLE currency units (#1437,
    // owner ruling 2026-10-27) — "60,000", never "60,000.00" — and the recorded cell carries its own
    // "As of <date>" line underneath the amount. The leading money token is the amount, in whole units.
    const amountIn = (text: string): number => Number((text.match(/\d[\d.,]*/) ?? [''])[0].replace(/[^\d]/g, ''));
    const rowCells = async (category: string) => table.getByRole('row', { name: new RegExp(category) }).getByRole('cell').allInnerTexts();
    const laborCells = await rowCells('Labor');
    expect(laborCells.map(amountIn), `Labor cells: ${JSON.stringify(laborCells)}`).toEqual(expect.arrayContaining([60_000, 12_000, 48_000]));
    const materialsCells = await rowCells('Materials');
    expect(materialsCells.map(amountIn), `Materials cells: ${JSON.stringify(materialsCells)}`).toEqual(expect.arrayContaining([30_000, 3_000, 27_000]));

    // ⚑ FR-018 — the comparison strip must WITHHOLD a total while any category's approved budget is
    // absent, never sum the categories that happen to carry a line. This whole-project version lines only
    // Labor and Materials (the two mapped accounts), so approved / remaining / % stay unavailable and the
    // surface NAME the absent categories; recorded spending is fully known, so its total is shown.
    const summaryDds = await forecast.locator('dl').first().locator('dd').allInnerTexts();
    expect(amountIn(summaryDds[1]), `recorded total in: ${JSON.stringify(summaryDds)}`).toBe(15_000);
    expect(summaryDds[0], 'approved total is withheld, never a partial sum').toBe('—');
    expect(summaryDds[2], 'remaining is withheld with the approved total').toBe('—');
    expect(summaryDds[3], 'the recorded percentage is unavailable with the approved total').toBe('Unavailable');
    const unknown = forecast.getByTestId('whole-project-unknown');
    await expect(unknown, 'the absent approved figures are named, not silently dropped').toContainText('approved budget for');
    await expect(unknown).toContainText('recorded spending for none');
  });
});
