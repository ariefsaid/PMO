// @e2e-isolation: serial — switches the seed organization's ERP binding and account map, then activates a predecessor and a whole-project successor.
/**
 * AC-018: the author creates a normal whole-project Draft, reviews its yearly allocation, and a distinct approver activates it.
 * The owning oracle is the shipped adapter/outbox plus independent reads of the native TEST Budget documents and Forecast.
 */
import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { login } from '../helpers';
import {
  ACTIVATOR_EMAIL,
  BENCH_KEY,
  BENCH_SECRET,
  type BudSeed,
  ERP_COMPANY,
  LABOR_ACCOUNT,
  MATERIALS_ACCOUNT,
  ORG_ID,
  SECOND_ACTIVATOR_EMAIL,
  cancelOwnedErpBudgets,
  cleanupBud,
  listProjectErpBudgetNames,
  openBudgetTab,
  readBudgetRefs,
  readErpBudget,
  runSweepBud,
  seedBud,
  seedDraftVersion,
  twoAdjacentFiscalYears,
} from './_budHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const READY = Boolean(FUNCTIONS_URL && AUTH_URL);
if (FUNCTIONS_URL && !READY) {
  throw new Error('AC-018: the served lane is up but its Supabase URL is missing; this journey never silently skips a partial lane.');
}
if (READY && (!SERVICE_KEY || !BENCH_KEY || !BENCH_SECRET)) {
  throw new Error('AC-018: the served lane requires its service-role and ERP readback credentials.');
}
test.skip(!READY, 'AC-018 requires the local served-functions lane and its existing TEST ERP fixture.');
test.setTimeout(360_000);

const LABOR_TOTAL = '1234.56';
const MATERIALS_TOTAL = '2345.67';
const LEDGER_LABOR_ACTUAL = '17.25';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('AC-018: a reviewed whole-project budget replaces annual ERP budgets and appears in Forecast against recorded ledger actuals', async ({ page }) => {
  const admin = createClient(AUTH_URL, SERVICE_KEY);
  const suffix = `ac018-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const predecessorName = `AC-018 annual predecessor ${suffix}`;
  const successorName = `AC-018 whole-project ${suffix}`;
  let seededForCleanup: BudSeed | null = null;
  let ledgerFixtureId: string | null = null;
  let nativeCancellationConfirmed = false;
  let primaryError: unknown = null;
  const cleanupErrors: string[] = [];

  try {
    // This proof drives a full shipped sweep tick to settle the annual-budget removals. Fail before
    // fixture writes if that tick could touch another active ERP org or pre-existing queued work.
    const { data: activeErpBindings, error: activeBindingsError } = await admin
      .from('external_org_bindings').select('org_id').eq('external_tier', 'erpnext').not('activated_at', 'is', null);
    if (activeBindingsError) throw new Error(`read active ERP binding scope before the full sweep failed: ${activeBindingsError.message}`);
    expect((activeErpBindings ?? []).map((row) => row.org_id).filter((orgId) => orgId !== ORG_ID), 'the full sweep has no other active ERP organization in scope').toEqual([]);

    const { data: sweepDomains, error: sweepDomainsError } = await admin
      .from('external_domain_ownership').select('domain').eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
    if (sweepDomainsError) throw new Error(`read ERP sweep domains before fixture setup failed: ${sweepDomainsError.message}`);
    const ownsTimesheets = (sweepDomains ?? []).some((row) => row.domain === 'timesheets');

    const { data: unsettledCommands, error: unsettledCommandsError } = await admin
      .from('external_command_outbox').select('id, domain, state').eq('org_id', ORG_ID)
      .neq('state', 'confirmed').neq('state', 'held').limit(1000);
    if (unsettledCommandsError) throw new Error(`read outbox work before the full sweep failed: ${unsettledCommandsError.message}`);
    expect(unsettledCommands, 'the full sweep starts with no unrelated unsettled outbox command').toEqual([]);

    const { data: pendingBudgetPushes, error: pendingBudgetPushesError } = await admin
      .from('budget_version_erp_mirror').select('id, budget_version_id, push_state').eq('org_id', ORG_ID).in('push_state', ['pending', 'failed']).limit(1000);
    if (pendingBudgetPushesError) throw new Error(`read legacy budget push backlog before the full sweep failed: ${pendingBudgetPushesError.message}`);
    expect(pendingBudgetPushes, 'the full sweep starts with no unrelated legacy budget push').toEqual([]);
    const { data: pendingAccountBudgetPushes, error: pendingAccountBudgetPushesError } = await admin
      .from('budget_version_account_erp_mirror').select('id, budget_version_id, push_state').eq('org_id', ORG_ID).in('push_state', ['pending', 'failed']).limit(1000);
    if (pendingAccountBudgetPushesError) throw new Error(`read account budget push backlog before the full sweep failed: ${pendingAccountBudgetPushesError.message}`);
    expect(pendingAccountBudgetPushes, 'the full sweep starts with no unrelated account budget push').toEqual([]);
    const { data: pendingBudgetCancellations, error: pendingBudgetCancellationsError } = await admin
      .from('budget_archive_cancel_intents').select('id, budget_version_id, state').eq('org_id', ORG_ID).eq('state', 'pending').limit(1000);
    if (pendingBudgetCancellationsError) throw new Error(`read budget cancellation backlog before the full sweep failed: ${pendingBudgetCancellationsError.message}`);
    expect(pendingBudgetCancellations, 'the full sweep starts with no unrelated budget cancellation').toEqual([]);

    const { data: pendingTimesheets, error: pendingTimesheetsError } = await admin
      .from('timesheet_erp_mirror').select('id, timesheet_id, push_state').eq('org_id', ORG_ID)
      .in('push_state', ['pending', 'failed']).is('erp_cancelled_at', null).limit(1000);
    if (pendingTimesheetsError) throw new Error(`read timesheet push backlog before the full sweep failed: ${pendingTimesheetsError.message}`);
    expect(pendingTimesheets, 'the full sweep starts with no unrelated retryable timesheet push').toEqual([]);
    const { data: pendingExpensePostings, error: pendingExpensePostingsError } = await admin
      .from('expense_posting_erp_mirror').select('id, posting_identity, push_state').eq('org_id', ORG_ID)
      .in('push_state', ['pending', 'failed']).is('erp_cancelled_at', null).limit(1000);
    if (pendingExpensePostingsError) throw new Error(`read expense posting backlog before the full sweep failed: ${pendingExpensePostingsError.message}`);
    expect(pendingExpensePostings, 'the full sweep starts with no unrelated retryable expense posting').toEqual([]);
    const { data: pendingImprestPostings, error: pendingImprestPostingsError } = await admin
      .from('imprest_posting_erp_mirror').select('id, posting_identity, push_state').eq('org_id', ORG_ID)
      .in('push_state', ['pending', 'failed']).is('erp_cancelled_at', null).limit(1000);
    if (pendingImprestPostingsError) throw new Error(`read site-float posting backlog before the full sweep failed: ${pendingImprestPostingsError.message}`);
    expect(pendingImprestPostings, 'the full sweep starts with no unrelated retryable site-float posting').toEqual([]);

    const { data: openConnectRuns, error: openConnectRunsError } = await admin
      .from('erp_connect_runs').select('id, state').eq('org_id', ORG_ID).eq('external_tier', 'erpnext')
      .in('state', ['staging', 'proposing']).limit(1000);
    if (openConnectRunsError) throw new Error(`read ERP connect setup runs before the full sweep failed: ${openConnectRunsError.message}`);
    expect(openConnectRuns, 'the full sweep starts with no unrelated ERP connect setup run').toEqual([]);
    const { data: queuedConnectSends, error: queuedConnectSendsError } = await admin
      .from('erp_connect_proposals').select('id, kind').eq('org_id', ORG_ID).eq('external_tier', 'erpnext')
      .eq('state', 'sending').eq('outcome', 'send').limit(1000);
    if (queuedConnectSendsError) throw new Error(`read ERP connect sends before the full sweep failed: ${queuedConnectSendsError.message}`);
    expect(queuedConnectSends, 'the full sweep starts with no unrelated accepted ERP master send').toEqual([]);
    const { data: itemCensus, error: itemCensusError } = await admin
      .from('erp_connect_census').select('pmo_count, accepted_at').eq('org_id', ORG_ID)
      .eq('external_tier', 'erpnext').eq('kind', 'item').maybeSingle();
    if (itemCensusError) throw new Error(`read ERP item-connect census before the full sweep failed: ${itemCensusError.message}`);
    if (itemCensus && (itemCensus.accepted_at !== null || itemCensus.pmo_count === 0)) {
      const { data: currentBinding, error: currentBindingError } = await admin.from('external_org_bindings')
        .select('config').eq('org_id', ORG_ID).eq('external_tier', 'erpnext').maybeSingle();
      if (currentBindingError) throw new Error(`read ERP item map before the full sweep failed: ${currentBindingError.message}`);
      const config = (currentBinding?.config ?? {}) as { item_map?: Record<string, string> };
      const mappedItems = new Set(Object.keys(config.item_map ?? {}));
      const { data: items, error: itemsError } = await admin.from('procurement_items')
        .select('name, procurement_id').eq('org_id', ORG_ID).limit(10_000);
      if (itemsError) throw new Error(`read ERP item-send candidates before the full sweep failed: ${itemsError.message}`);
      expect((items ?? []).length, 'item-send preflight is not truncated').toBeLessThan(10_000);
      const procurementIds = [...new Set((items ?? []).map((item) => item.procurement_id))];
      const { data: procurements, error: procurementsError } = procurementIds.length === 0
        ? { data: [], error: null }
        : await admin.from('procurements').select('id, status').eq('org_id', ORG_ID).in('id', procurementIds).limit(10_000);
      if (procurementsError) throw new Error(`read procurement states before the full sweep failed: ${procurementsError.message}`);
      expect((procurements ?? []).length, 'procurement-state preflight is not truncated').toBeLessThan(10_000);
      const eligibleProcurements = new Set((procurements ?? [])
        .filter((procurement) => ['Approved', 'Vendor Quoted', 'Quote Selected', 'Ordered', 'Received', 'Vendor Invoiced'].includes(procurement.status))
        .map((procurement) => procurement.id));
      const { data: itemProposals, error: itemProposalsError } = await admin.from('erp_connect_proposals')
        .select('pmo_ids').eq('org_id', ORG_ID).eq('external_tier', 'erpnext').eq('kind', 'item').limit(10_000);
      if (itemProposalsError) throw new Error(`read existing ERP item proposals before the full sweep failed: ${itemProposalsError.message}`);
      expect((itemProposals ?? []).length, 'item-proposal preflight is not truncated').toBeLessThan(10_000);
      const alreadyQueued = new Set((itemProposals ?? []).flatMap((proposal) => proposal.pmo_ids ?? []));
      const wouldEnqueue = [...new Set((items ?? [])
        .filter((item) => item.name && eligibleProcurements.has(item.procurement_id))
        .map((item) => item.name))]
        .filter((name) => !mappedItems.has(name) && !alreadyQueued.has(name));
      expect(wouldEnqueue, 'the full sweep cannot enqueue unrelated new ERP Item sends').toEqual([]);
    }

    const [firstYear, secondYear] = await twoAdjacentFiscalYears();
    const seeded = await seedBud(admin, suffix, {
      projectStart: firstYear.year_start_date,
      projectEnd: secondYear.year_end_date,
      versionMajor: 16,
    });
    seededForCleanup = seeded;
    const usersResult = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (usersResult.error) throw new Error(`read the seeded actor identities failed: ${usersResult.error.message}`);
    const authorUser = usersResult.data.users.find((user) => user.email === ACTIVATOR_EMAIL);
    const approverUser = usersResult.data.users.find((user) => user.email === SECOND_ACTIVATOR_EMAIL);
    if (!authorUser || !approverUser) throw new Error('one of the two seeded budget actors is missing');
    const authorId = authorUser.id;
    const approverId = approverUser.id;
    expect(authorId).not.toBe(approverId);

    expect(await listProjectErpBudgetNames(seeded.erpProject), 'the namespaced ERP Project starts without Budget documents').toHaveLength(0);

    const predecessorId = await seedDraftVersion(admin, seeded, {
      name: predecessorName,
      version: 1,
      lines: [
        { category: 'Labor', amount: '500.01', fiscalYear: firstYear.name },
        { category: 'Materials', amount: '700.00', fiscalYear: firstYear.name },
        { category: 'Labor', amount: '800.00', fiscalYear: secondYear.name },
        { category: 'Materials', amount: '900.00', fiscalYear: secondYear.name },
      ],
    });

    // A supported annual v16 predecessor is created through the served handler before the actual user journey.
    await login(page, SECOND_ACTIVATOR_EMAIL);
    await openBudgetTab(page, seeded.projectId);
    const predecessorVersionsRegion = page.getByRole('region', { name: 'Budget versions' });
    const predecessorRow = predecessorVersionsRegion.getByRole('row', { name: new RegExp(escapeRegExp(predecessorName)) });
    await expect(predecessorRow).toContainText('Draft');
    const predecessorDraft = page.getByRole('region', { name: 'Draft waiting for approval' });
    await expect(predecessorDraft).toContainText(predecessorName);
    await predecessorDraft.getByRole('button', { name: /^Activate v\d+$/ }).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Activate version', exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 60_000 });
    await expect(predecessorDraft).not.toBeVisible({ timeout: 30_000 });
    await expect(predecessorRow).toContainText('Active', { timeout: 30_000 });

    const predecessorRefs = await readBudgetRefs(admin, predecessorId);
    expect(predecessorRefs, 'the annual predecessor has an external witness for each mapped account and fiscal year').toHaveLength(4);
    expect(new Set(predecessorRefs.map((ref) => ref.external_record_id)).size).toBe(4);
    const { data: predecessorOutbox, error: predecessorOutboxError } = await admin
      .from('external_command_outbox').select('state, actor_user_id, pmo_record_id')
      .eq('org_id', ORG_ID).eq('domain', 'budget').like('pmo_record_id', `${predecessorId}%`);
    if (predecessorOutboxError) throw new Error(`read annual predecessor outbox records failed: ${predecessorOutboxError.message}`);
    expect(predecessorOutbox, 'the shipped adapter confirms every annual account write').toHaveLength(4);
    expect((predecessorOutbox ?? []).every((row) => row.state === 'confirmed')).toBe(true);
    expect((predecessorOutbox ?? []).every((row) => row.actor_user_id === approverId)).toBe(true);
    const predecessorTargets: Array<{ name: string; account: string; year: string; amount: number }> = [];
    for (const ref of predecessorRefs) {
      const doc = await readErpBudget(ref.external_record_id);
      expect(doc.docstatus, 'every witnessed annual predecessor is submitted before replacement').toBe(1);
      expect(doc.company).toBe(ERP_COMPANY);
      expect(doc.project).toBe(seeded.erpProject);
      expect(doc.budget_against).toBe('Project');
      expect(doc.account).toBeTruthy();
      expect(doc.from_fiscal_year).toBe(doc.to_fiscal_year);
      predecessorTargets.push({
        name: doc.name,
        account: doc.account!,
        year: doc.from_fiscal_year!,
        amount: Number(doc.budget_amount),
      });
    }
    expect(predecessorTargets.map(({ account, year, amount }) => [account, year, amount]).sort()).toEqual([
      [LABOR_ACCOUNT, firstYear.name, 500.01],
      [MATERIALS_ACCOUNT, firstYear.name, 700],
      [LABOR_ACCOUNT, secondYear.name, 800],
      [MATERIALS_ACCOUNT, secondYear.name, 900],
    ].sort());

    // The finance author creates the successor in the normal UI; the UI default is the behavior under test.
    await login(page, ACTIVATOR_EMAIL);
    await openBudgetTab(page, seeded.projectId);
    const authorVersionsRegion = page.getByRole('region', { name: 'Budget versions' });
    await authorVersionsRegion.getByRole('button', { name: 'New version', exact: true }).click();
    await page.getByLabel('Version name').fill(successorName);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Create version', exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 30_000 });

    const { data: createdVersion, error: createdVersionError } = await admin
      .from('budget_versions').select('id, status, budget_mode, created_by')
      .eq('project_id', seeded.projectId).eq('name', successorName).single();
    if (createdVersionError || !createdVersion) throw new Error(`read UI-created whole-project Draft failed: ${createdVersionError?.message ?? 'no row'}`);
    const successorId = (createdVersion as { id: string }).id;
    expect((createdVersion as { status: string }).status).toBe('Draft');
    expect((createdVersion as { budget_mode: string }).budget_mode, 'a normal new version starts in whole-project mode').toBe('whole_project');
    seeded.versionIds.push(successorId);
    expect((createdVersion as { created_by: string }).created_by).toBe(authorId);

    const authorDraft = page.getByRole('region', { name: 'Draft waiting for approval' });
    const authorDraftRow = authorVersionsRegion.getByRole('row', { name: new RegExp(escapeRegExp(successorName)) });
    await expect(authorDraft).toContainText(successorName);
    await expect(authorDraftRow).toContainText('Draft');
    await authorDraft.getByRole('button', { name: 'Edit draft', exact: true }).click();
    const editor = page.getByTestId('budget-draft-editor');
    await expect(editor).toBeVisible();

    await editor.getByRole('button', { name: /Add line item/ }).click();
    await editor.getByLabel('Line item category').selectOption('Labor');
    await editor.getByLabel('Line item description').fill(`AC-018 Labor ${suffix}`);
    await editor.getByLabel('Line item amount').fill(LABOR_TOTAL);
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor.getByRole('row', { name: /Labor/ })).toContainText('1,234.56');

    await editor.getByRole('button', { name: /Add line item/ }).click();
    await editor.getByLabel('Line item category').selectOption('Materials');
    await editor.getByLabel('Line item description').fill(`AC-018 Materials ${suffix}`);
    await editor.getByLabel('Line item amount').fill(MATERIALS_TOTAL);
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor.getByRole('row', { name: /Materials/ })).toContainText('2,345.67');
    await expect(editor.getByTestId('budget-edit-total')).toContainText('3,580.23');

    const distribution = page.getByTestId('budget-distribution-grid');
    await expect(distribution.getByLabel('Distribution method')).toBeEnabled({ timeout: 30_000 });
    await distribution.getByLabel('Distribution method').selectOption('percent_by_year');
    await distribution.getByLabel(`Shared input for ${firstYear.name}`).fill('0');
    await distribution.getByLabel(`Shared input for ${secondYear.name}`).fill('100');
    await distribution.getByLabel('Use custom distribution for Materials').check();
    await distribution.getByLabel(`Materials input for ${firstYear.name}`).fill('40');
    await distribution.getByLabel(`Materials input for ${secondYear.name}`).fill('60');
    await distribution.getByRole('button', { name: 'Preview distribution', exact: true }).click();
    const distributionTable = distribution.getByRole('table', { name: 'Category fiscal-year distribution' });
    await expect(distribution.getByTestId('budget-distribution-preview-status')).toContainText('Preview ready');
    await expect(distributionTable.getByRole('row', { name: /Labor/ })).toContainText('0.00');
    await expect(distributionTable.getByRole('row', { name: /Labor/ })).toContainText('1,234.56');
    await expect(distributionTable.getByRole('row', { name: /Materials/ })).toContainText('938.27');
    await expect(distributionTable.getByRole('row', { name: /Materials/ })).toContainText('1,407.40');
    await distribution.getByRole('button', { name: 'Save reviewed distribution', exact: true }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Save distribution', exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 30_000 });

    const { data: savedYearRows, error: savedRowsError } = await admin
      .from('budget_year_distributions').select('category, fiscal_year, amount')
      .eq('budget_version_id', successorId);
    if (savedRowsError) throw new Error(`read persisted reviewed distribution failed: ${savedRowsError.message}`);
    const savedDistribution = (savedYearRows ?? []).map((row) => [row.category, row.fiscal_year, Number(row.amount).toFixed(2)] as const)
      .sort((left, right) => `${left[0]}:${left[1]}`.localeCompare(`${right[0]}:${right[1]}`));
    const expectedDistribution = [
      ['Labor', firstYear.name, '0.00'],
      ['Labor', secondYear.name, '1234.56'],
      ['Materials', firstYear.name, '938.27'],
      ['Materials', secondYear.name, '1407.40'],
    ].sort((left, right) => `${left[0]}:${left[1]}`.localeCompare(`${right[0]}:${right[1]}`));
    expect(savedDistribution).toEqual(expectedDistribution);

    // The Admin approver differs from the real Finance author. The UI activation invokes the shipped handler.
    await login(page, SECOND_ACTIVATOR_EMAIL);
    await openBudgetTab(page, seeded.projectId);
    const successorRow = page.getByRole('region', { name: 'Budget versions' })
      .getByRole('row', { name: new RegExp(escapeRegExp(successorName)) });
    await expect(successorRow).toContainText('Draft');
    const successorDraft = page.getByRole('region', { name: 'Draft waiting for approval' });
    await expect(successorDraft).toContainText(successorName);
    await successorDraft.getByRole('button', { name: /^Activate v\d+$/ }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Activate version', exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 60_000 });
    await expect(successorDraft).not.toBeVisible({ timeout: 30_000 });
    await expect(successorRow).toContainText('Active', { timeout: 30_000 });
    if (ownsTimesheets) {
      const { data: binding, error: bindingError } = await admin.from('external_org_bindings')
        .select('activated_at').eq('org_id', ORG_ID).eq('external_tier', 'erpnext').maybeSingle();
      if (bindingError || !binding?.activated_at) throw new Error(`read current ERP activation before the full sweep failed: ${bindingError?.message ?? 'no activation stamp'}`);
      const lookbackFloor = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const approvedAfter = lookbackFloor > binding.activated_at ? lookbackFloor : binding.activated_at;
      const { data: unmirroredApprovedTimesheets, error: unmirroredTimesheetsError } = await admin.from('timesheets')
        .select('id, timesheet_erp_mirror!left(timesheet_id)').eq('org_id', ORG_ID).eq('status', 'Approved')
        .gte('approved_at', approvedAfter).is('timesheet_erp_mirror', null).limit(1000);
      if (unmirroredTimesheetsError) throw new Error(`read newly eligible timesheet sends before the full sweep failed: ${unmirroredTimesheetsError.message}`);
      expect(unmirroredApprovedTimesheets, 'the full sweep starts with no newly eligible unmirrored timesheet send').toEqual([]);
    }
    const sweep = await runSweepBud(FUNCTIONS_URL);
    expect(sweep.status, `the shipped full sweep settles the actual budget push and predecessor removals: ${JSON.stringify(sweep.body)}`).toBe(200);

    const { data: finalVersion, error: finalVersionError } = await admin
      .from('budget_versions').select('status, budget_mode, created_by')
      .eq('id', successorId).single();
    if (finalVersionError || !finalVersion) throw new Error(`read active whole-project budget failed: ${finalVersionError?.message ?? 'no row'}`);
    expect(finalVersion).toMatchObject({ status: 'Active', budget_mode: 'whole_project', created_by: authorId });

    const successorRefs = await readBudgetRefs(admin, successorId);
    expect(successorRefs, 'the actual shipped adapter writes exactly one range unit per non-zero account').toHaveLength(2);
    const liveDocs = (await listProjectErpBudgetNames(seeded.erpProject)).filter((doc) => doc.docstatus < 2);
    expect(liveDocs, 'ERP enforces exactly two live range documents, one per mapped account').toHaveLength(2);
    expect(new Set(successorRefs.map((ref) => ref.external_record_id))).toEqual(new Set(liveDocs.map((doc) => doc.name)));

    const expectedRangeBudgets = [
      {
        account: LABOR_ACCOUNT,
        amount: 1234.56,
        rows: [
          { start: firstYear.year_start_date, end: firstYear.year_end_date, amount: 0 },
          { start: secondYear.year_start_date, end: secondYear.year_end_date, amount: 1234.56 },
        ],
      },
      {
        account: MATERIALS_ACCOUNT,
        amount: 2345.67,
        rows: [
          { start: firstYear.year_start_date, end: firstYear.year_end_date, amount: 938.27 },
          { start: secondYear.year_start_date, end: secondYear.year_end_date, amount: 1407.4 },
        ],
      },
    ];
    const successorDocuments = await Promise.all(successorRefs.map((ref) => readErpBudget(ref.external_record_id)));
    for (const expected of expectedRangeBudgets) {
      const doc = successorDocuments.find((candidate) => candidate.account === expected.account);
      expect(doc, `${expected.account} is read back from ERPNext`).toBeTruthy();
      expect(successorRefs.some((ref) => ref.external_record_id === doc!.name), `${expected.account} has its own actual external reference`).toBe(true);
      expect(doc!.docstatus).toBe(1);
      expect(doc!.company).toBe(ERP_COMPANY);
      expect(doc!.project).toBe(seeded.erpProject);
      expect(doc!.budget_against).toBe('Project');
      expect(doc!.from_fiscal_year).toBe(firstYear.name);
      expect(doc!.to_fiscal_year).toBe(secondYear.name);
      expect(doc!.distribution_frequency).toBe('Yearly');
      expect(Number(doc!.budget_amount)).toBe(expected.amount);
      expect((doc!.budget_distribution ?? []).map((row) => [row.start_date, row.end_date, Number(row.amount)])).toEqual(
        expected.rows.map((row) => [row.start, row.end, row.amount]),
      );
      expect((doc!.budget_distribution ?? []).reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0)).toBe(Math.round(expected.amount * 100));
    }

    const { data: successorOutbox, error: successorOutboxError } = await admin
      .from('external_command_outbox').select('state, actor_user_id, pmo_record_id')
      .eq('org_id', ORG_ID).eq('domain', 'budget').like('pmo_record_id', `${successorId}%`);
    if (successorOutboxError) throw new Error(`read actual budget outbox records failed: ${successorOutboxError.message}`);
    expect(successorOutbox, 'the shipped outbox records both account-range writes').toHaveLength(2);
    expect((successorOutbox ?? []).every((row) => row.state === 'confirmed')).toBe(true);
    expect((successorOutbox ?? []).every((row) => row.actor_user_id === approverId)).toBe(true);

    const { data: cancelIntents, error: cancelIntentsError } = await admin
      .from('budget_archive_cancel_intents').select('state, actor_user_id, erp_budget_name')
      .eq('org_id', ORG_ID).eq('budget_version_id', predecessorId);
    if (cancelIntentsError) throw new Error(`read predecessor cancellation witnesses failed: ${cancelIntentsError.message}`);
    expect(cancelIntents, 'each annual account target receives a durable cancellation witness').toHaveLength(4);
    expect((cancelIntents ?? []).every((intent) => intent.state === 'complete' && intent.actor_user_id === approverId)).toBe(true);
    expect(new Set((cancelIntents ?? []).map((intent) => intent.erp_budget_name))).toEqual(new Set(predecessorTargets.map((doc) => doc.name)));
    for (const predecessor of predecessorTargets) {
      expect((await readErpBudget(predecessor.name)).docstatus, 'every witnessed annual predecessor is cancelled in ERPNext').toBe(2);
    }

    // A canonical local ledger snapshot row feeds the real shipped Forecast read; no ERP Budget is seeded as an oracle.
    const { data: latestLedgerRow, error: latestLedgerError } = await admin
      .from('erp_actuals_snapshot').select('snapshot_id')
      .eq('org_id', ORG_ID).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).single();
    if (latestLedgerError || !latestLedgerRow) throw new Error(`read canonical local ledger generation failed: ${latestLedgerError?.message ?? 'no generation'}`);
    const { data: ledgerFixture, error: ledgerFixtureError } = await admin.from('erp_actuals_snapshot').insert({
      org_id: ORG_ID,
      project_id: seeded.projectId,
      account: LABOR_ACCOUNT,
      fiscal_year: firstYear.name,
      debit: LEDGER_LABOR_ACTUAL,
      credit: '0.00',
      net: LEDGER_LABOR_ACTUAL,
      as_of: new Date().toISOString(),
      source_report: 'GL Entry',
      snapshot_id: (latestLedgerRow as { snapshot_id: string }).snapshot_id,
    }).select('id, project_id, account, fiscal_year, net, snapshot_id').single();
    if (ledgerFixtureError || !ledgerFixture) throw new Error(`seed namespaced canonical ledger snapshot row failed: ${ledgerFixtureError?.message ?? 'no row'}`);
    ledgerFixtureId = (ledgerFixture as { id: string }).id;
    expect(ledgerFixture).toMatchObject({ project_id: seeded.projectId, account: LABOR_ACCOUNT, fiscal_year: firstYear.name, net: LEDGER_LABOR_ACTUAL });

    await openBudgetTab(page, seeded.projectId);
    await page.getByRole('button', { name: 'Forecast', exact: true }).click();
    const forecast = page.getByTestId('budget-forecast-view');
    await forecast.getByLabel('Fiscal year').selectOption({ label: 'All years (project to date)' });
    await expect(forecast.getByRole('table', { name: 'Approved budget compared with recorded spending' })).toBeVisible({ timeout: 30_000 });
    const allYearSummary = forecast.locator('dl').first();
    await expect(allYearSummary).toContainText('Approved total');
    await expect(allYearSummary).toContainText(/3,580\.23/);
    await expect(allYearSummary).toContainText('Recorded to date');
    await expect(allYearSummary).toContainText(/17\.25/);
    const comparison = forecast.getByRole('table', { name: 'Approved budget compared with recorded spending' });
    const laborRow = comparison.getByRole('row', { name: /Labor/ });
    const materialsRow = comparison.getByRole('row', { name: /Materials/ });
    await expect(laborRow).toContainText(/1,234\.56/);
    await expect(laborRow).toContainText(/17\.25/);
    await expect(materialsRow).toContainText(/2,345\.67/);
    await expect(materialsRow).toContainText(/0\.00/);
  } catch (error) {
    primaryError = error;
  } finally {
    const seeded = seededForCleanup;
    if (seeded) {
      try {
        await cancelOwnedErpBudgets(seeded.erpProject);
        nativeCancellationConfirmed = true;
      } catch (error) {
        cleanupErrors.push(`ERP Budget cancellation: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (ledgerFixtureId) {
      try {
        const { error } = await admin.from('erp_actuals_snapshot').delete().eq('org_id', ORG_ID).eq('id', ledgerFixtureId);
        if (error) cleanupErrors.push(`ledger fixture removal: ${error.message}`);
      } catch (error) {
        cleanupErrors.push(`ledger fixture removal: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (seeded) {
      try {
        await cleanupBud(admin, seeded, { preserveBudgetEvidence: !nativeCancellationConfirmed });
      } catch (error) {
        cleanupErrors.push(`PMO fixture/global-state restoration: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    try {
      if (seeded) {
        if (nativeCancellationConfirmed) {
          const cleanedErpBudgets = await listProjectErpBudgetNames(seeded.erpProject);
          if (!cleanedErpBudgets.every((doc) => doc.docstatus === 2)) cleanupErrors.push('an owned ERP Budget is not cancelled');
          const { data: remainingVersions, error: remainingVersionsError } = await admin.from('budget_versions').select('id').eq('project_id', seeded.projectId);
          if (remainingVersionsError) cleanupErrors.push(`read remaining PMO versions failed: ${remainingVersionsError.message}`);
          else if ((remainingVersions ?? []).length > 0) cleanupErrors.push('run-owned PMO budget versions remain after confirmed ERP cancellation');
        } else {
          const { data: preservedVersions, error: preservedVersionsError } = await admin.from('budget_versions').select('id').eq('project_id', seeded.projectId);
          if (preservedVersionsError) cleanupErrors.push(`read retained PMO recovery versions failed: ${preservedVersionsError.message}`);
          else {
            const actualIds = (preservedVersions ?? []).map((version) => version.id).sort();
            const expectedIds = [...seeded.versionIds].sort();
            if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) cleanupErrors.push('owned PMO recovery versions were not retained after incomplete native cancellation');
          }
        }
        const { data: restoredBinding, error: restoredBindingError } = await admin.from('external_org_bindings').select('*').eq('org_id', ORG_ID).eq('external_tier', 'erpnext').maybeSingle();
        if (restoredBindingError) cleanupErrors.push(`read restored binding failed: ${restoredBindingError.message}`);
        else if (JSON.stringify(restoredBinding) !== JSON.stringify(seeded.prior.binding)) cleanupErrors.push('org-global ERP binding did not restore exactly');
        const { data: restoredMap, error: restoredMapError } = await admin.from('budget_category_account_map').select('org_id, category, erp_account, is_push_target').eq('org_id', ORG_ID).in('category', ['Labor', 'Materials']);
        if (restoredMapError) cleanupErrors.push(`read restored category map failed: ${restoredMapError.message}`);
        else {
          const actualMap = (restoredMap ?? []).sort((a, b) => `${a.category}:${a.erp_account}:${a.is_push_target}`.localeCompare(`${b.category}:${b.erp_account}:${b.is_push_target}`));
          const expectedMap = [...seeded.prior.categoryMap].sort((a, b) => `${a.category}:${a.erp_account}:${a.is_push_target}`.localeCompare(`${b.category}:${b.erp_account}:${b.is_push_target}`));
          if (JSON.stringify(actualMap) !== JSON.stringify(expectedMap)) cleanupErrors.push('org-global category map did not restore exactly');
        }
      }
      if (ledgerFixtureId) {
        const { data: remainingLedger, error: remainingLedgerError } = await admin.from('erp_actuals_snapshot').select('id').eq('org_id', ORG_ID).eq('id', ledgerFixtureId).maybeSingle();
        if (remainingLedgerError) cleanupErrors.push(`read ledger fixture cleanup failed: ${remainingLedgerError.message}`);
        else if (remainingLedger) cleanupErrors.push('run-owned ledger snapshot row remains');
      }
    } catch (error) {
      cleanupErrors.push(`cleanup verification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (primaryError && cleanupErrors.length > 0) {
    throw new Error(`AC-018 journey failed (${primaryError instanceof Error ? primaryError.message : String(primaryError)}); owned cleanup failed: ${cleanupErrors.join('; ')}`, { cause: primaryError });
  }
  if (primaryError) throw primaryError;
  if (cleanupErrors.length > 0) throw new Error(`AC-018 owned cleanup failed: ${cleanupErrors.join('; ')}`);
});
