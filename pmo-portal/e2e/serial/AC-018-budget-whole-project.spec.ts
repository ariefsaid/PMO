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

test('AC-018: a reviewed whole-project budget replaces annual ERP budgets and appears in Forecast against recorded ledger actuals', async ({ page }) => {
  const admin = createClient(AUTH_URL, SERVICE_KEY);
  const suffix = `ac018-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const [firstYear, secondYear] = await twoAdjacentFiscalYears();
  const seeded = await seedBud(admin, suffix, {
    projectStart: firstYear.year_start_date,
    projectEnd: secondYear.year_end_date,
    versionMajor: 16,
  });
  const predecessorName = `AC-018 annual predecessor ${suffix}`;
  const successorName = `AC-018 whole-project ${suffix}`;
  let ledgerFixtureId: string | null = null;
  let primaryError: unknown = null;
  const cleanupErrors: string[] = [];

  try {
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
    await expect(page.getByTestId('version-card')).toContainText(predecessorName);
    const predecessorCard = page.getByTestId('version-card');
    await predecessorCard.getByRole('button', { name: 'Activate', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Activate version', exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 60_000 });
    await expect(predecessorCard.getByTestId('version-status-active')).toBeVisible({ timeout: 30_000 });

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
    const versionsRegion = page.getByRole('region', { name: 'Budget versions' });
    await versionsRegion.getByRole('button', { name: 'New version', exact: true }).click();
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

    const card = page.getByTestId('version-card');
    await expect(card).toContainText(successorName);
    await card.getByRole('button', { name: 'Edit draft', exact: true }).click();
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
      .eq('budget_version_id', successorId).order('ordinal', { ascending: true });
    if (savedRowsError) throw new Error(`read persisted reviewed distribution failed: ${savedRowsError.message}`);
    expect((savedYearRows ?? []).map((row) => [row.category, row.fiscal_year, Number(row.amount)])).toEqual([
      ['Labor', firstYear.name, 0],
      ['Labor', secondYear.name, 1234.56],
      ['Materials', firstYear.name, 938.27],
      ['Materials', secondYear.name, 1407.4],
    ]);

    // The Admin approver differs from the real Finance author. The UI activation invokes the shipped handler.
    await login(page, SECOND_ACTIVATOR_EMAIL);
    await openBudgetTab(page, seeded.projectId);
    const successorCard = page.getByTestId('version-card');
    await expect(successorCard).toContainText(successorName);
    await successorCard.getByRole('button', { name: /^Activate v\d+$/ }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Activate version', exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 60_000 });
    await expect(successorCard.getByTestId('version-status-active')).toBeVisible({ timeout: 30_000 });
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
    try {
      await cancelOwnedErpBudgets(seeded.erpProject);
    } catch (error) {
      cleanupErrors.push(`ERP Budget cancellation: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (ledgerFixtureId) {
      try {
        const { error } = await admin.from('erp_actuals_snapshot').delete().eq('org_id', ORG_ID).eq('id', ledgerFixtureId);
        if (error) cleanupErrors.push(`ledger fixture removal: ${error.message}`);
      } catch (error) {
        cleanupErrors.push(`ledger fixture removal: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    try {
      await cleanupBud(admin, seeded);
    } catch (error) {
      cleanupErrors.push(`PMO fixture/global-state restoration: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      const cleanedErpBudgets = await listProjectErpBudgetNames(seeded.erpProject);
      if (!cleanedErpBudgets.every((doc) => doc.docstatus === 2)) cleanupErrors.push('an owned ERP Budget is not cancelled');
      const { data: remainingVersions, error: remainingVersionsError } = await admin.from('budget_versions').select('id').eq('project_id', seeded.projectId);
      if (remainingVersionsError) cleanupErrors.push(`read remaining PMO versions failed: ${remainingVersionsError.message}`);
      else if ((remainingVersions ?? []).length > 0) cleanupErrors.push('run-owned PMO budget versions remain');
      const { data: restoredBinding, error: restoredBindingError } = await admin.from('external_org_bindings').select('*').eq('org_id', ORG_ID).eq('external_tier', 'erpnext').maybeSingle();
      if (restoredBindingError) cleanupErrors.push(`read restored binding failed: ${restoredBindingError.message}`);
      else if (JSON.stringify(restoredBinding) !== JSON.stringify(seeded.prior.binding)) cleanupErrors.push('org-global ERP binding did not restore exactly');
      const { data: restoredMap, error: restoredMapError } = await admin.from('budget_category_account_map').select('org_id, category, erp_account, is_push_target').eq('org_id', ORG_ID).in('category', ['Labor', 'Materials']);
      if (restoredMapError) cleanupErrors.push(`read restored category map failed: ${restoredMapError.message}`);
      else {
        const actualMap = (restoredMap ?? []).sort((a, b) => `${a.category}:${a.erp_account}`.localeCompare(`${b.category}:${b.erp_account}`));
        const expectedMap = [...seeded.prior.categoryMap].sort((a, b) => `${a.category}:${a.erp_account}`.localeCompare(`${b.category}:${b.erp_account}`));
        if (JSON.stringify(actualMap) !== JSON.stringify(expectedMap)) cleanupErrors.push('org-global category map did not restore exactly');
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
