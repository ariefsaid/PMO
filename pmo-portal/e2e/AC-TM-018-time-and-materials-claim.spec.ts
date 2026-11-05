// @e2e-isolation: self-isolated — creates a unique client, project, evidence document, rates and claim; uses the first empty week for the dedicated TSE-021 engineer. A confirmed claim is immutable, so that complete fixture is retained and its project archived per AC-CQ-020.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';
import {
  login,
  pickComboboxOption,
  pinEnglishLocale,
  requireServiceRoleKey,
  visibleToast,
  waitForFonts,
} from './helpers';

const ENGINEER_EMAIL = 'tse-021-eng@acme.test';
const MANAGER_EMAIL = 'pm@acme.test';
const FINANCE_EMAIL = 'finance@acme.test';
const ENGINEER_NAME = 'TSE-021 Engineer';
const LINE_LABEL = 'Field engineer';
const ITEM_NAME = 'Professional services';
const RATE = 50_000;
const HOURS = 8;

let admin: SupabaseClient | null = null;
let orgId = '';
let projectId = '';
let projectName = '';
let companyId = '';
let documentId = '';
let engineerId = '';
let managerId = '';
let financeId = '';
let weekStart = '';
let today = '';
let workdayLabel = '';
let fixedNow = new Date();
let timesheetSlotReserved = false;
let itemCode = '';

test.setTimeout(180_000);

const FIXTURE_PROJECT_PATTERN = 'Time materials TM018-%';

/** Preserve older confirmed fixture records while keeping them out of active project lists. */
async function archiveEarlierSignedOffFixtures(service: SupabaseClient): Promise<void> {
  const projects = await service
    .from('projects')
    .select('id')
    .eq('org_id', orgId)
    .like('name', FIXTURE_PROJECT_PATTERN)
    .is('archived_at', null);
  if (projects.error) throw new Error(`AC-TM-018 prior fixture projects: ${projects.error.message}`);

  let archivedCount = 0;
  for (const project of projects.data ?? []) {
    const claims = await service
      .from('tm_claims')
      .select('id')
      .eq('project_id', project.id)
      .eq('status', 'SignedOff')
      .limit(1);
    if (claims.error) throw new Error(`AC-TM-018 prior fixture claim: ${claims.error.message}`);
    if (!claims.data?.length) continue;

    const archived = await service
      .from('projects')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', project.id)
      .is('archived_at', null)
      .select('id')
      .maybeSingle();
    if (archived.error) throw new Error(`AC-TM-018 prior fixture archive: ${archived.error.message}`);
    if (archived.data) archivedCount += 1;
  }
  if (archivedCount > 0) {
    console.info(`AC-TM-018 archived ${archivedCount} earlier confirmed fixture project(s); immutable records were retained per AC-CQ-020.`);
  }
}

test.beforeEach(async () => {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-TM-018 requires the local fixture service client.');

  const now = new Date(Math.floor(Date.now() / 60_000) * 60_000);

  admin = createClient(requireMatchingLocalSupabaseUrls(undefined, undefined), serviceKey, { auth: { persistSession: false } });
  const suffix = `TM018-${Date.now()}-${randomUUID().slice(0, 8)}`;
  itemCode = `TM-SVC-${suffix}`;
  projectName = `Time materials ${suffix}`;

  const profileResult = await admin
    .from('profiles')
    .select('id, email, org_id')
    .in('email', [ENGINEER_EMAIL, MANAGER_EMAIL, FINANCE_EMAIL]);
  if (profileResult.error) throw new Error(`AC-TM-018 fixture profiles: ${profileResult.error.message}`);
  const profiles = new Map((profileResult.data ?? []).map((profile) => [profile.email, profile]));
  const engineer = profiles.get(ENGINEER_EMAIL);
  const manager = profiles.get(MANAGER_EMAIL);
  const finance = profiles.get(FINANCE_EMAIL);
  if (!engineer || !manager || !finance) throw new Error('AC-TM-018 fixture roles are missing from the local seed.');
  if (new Set([engineer.org_id, manager.org_id, finance.org_id]).size !== 1) {
    throw new Error('AC-TM-018 fixture roles must belong to the same local organisation.');
  }
  orgId = finance.org_id;
  engineerId = engineer.id;
  managerId = manager.id;
  financeId = finance.id;

  await archiveEarlierSignedOffFixtures(admin);

  const existingSheets = await admin
    .from('timesheets')
    .select('week_start_date')
    .eq('user_id', engineerId);
  if (existingSheets.error) throw new Error(`AC-TM-018 timesheet slot check: ${existingSheets.error.message}`);
  const occupiedWeeks = new Set((existingSheets.data ?? []).map((sheet) => sheet.week_start_date));
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  dayStart.setUTCDate(dayStart.getUTCDate() - ((dayStart.getUTCDay() + 6) % 7));
  for (let offset = 0; offset < 52; offset += 1) {
    const candidate = new Date(dayStart);
    candidate.setUTCDate(candidate.getUTCDate() + (offset * 7));
    const candidateWeek = candidate.toISOString().slice(0, 10);
    if (occupiedWeeks.has(candidateWeek)) continue;
    weekStart = candidateWeek;
    fixedNow = new Date(Date.UTC(
      candidate.getUTCFullYear(), candidate.getUTCMonth(), candidate.getUTCDate(),
      now.getUTCHours(), now.getUTCMinutes(),
    ));
    break;
  }
  if (!weekStart) throw new Error('AC-TM-018 could not find an empty engineer week within the next year.');
  today = fixedNow.toISOString().slice(0, 10);
  workdayLabel = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][fixedNow.getUTCDay()] ?? 'Mon';
  timesheetSlotReserved = true;

  const company = await admin
    .from('companies')
    .insert({ org_id: orgId, name: `${suffix} Client`, type: 'Client' })
    .select('id')
    .single();
  if (company.error) throw new Error(`AC-TM-018 fixture client: ${company.error.message}`);
  companyId = company.data.id;

  const project = await admin
    .from('projects')
    .insert({
      org_id: orgId,
      name: projectName,
      status: 'Ongoing Project',
      currency: 'IDR',
      client_id: companyId,
      project_manager_id: managerId,
      contract_value: 10_000_000,
      tax_treatment: 'exclusive',
      tax_amount: 0,
      subject_to_vat: false,
      tax_rate: null,
      tax_base_numerator: 1,
      tax_base_denominator: 1,
      start_date: weekStart,
      end_date: `${Number(weekStart.slice(0, 4)) + 1}${weekStart.slice(4)}`,
    })
    .select('id')
    .single();
  if (project.error) throw new Error(`AC-TM-018 fixture project: ${project.error.message}`);
  projectId = project.data.id;

  documentId = randomUUID();
  const evidence = await admin.from('project_documents').insert({
    id: documentId,
    org_id: orgId,
    project_id: projectId,
    category: 'Client sign-off',
    title: `Approved hours ${suffix}`,
    revision: 'A',
    status: 'Approved',
    file_path: `${orgId}/${projectId}/${documentId}/${suffix}.pdf`,
    author_id: managerId,
  });
  if (evidence.error) throw new Error(`AC-TM-018 fixture evidence: ${evidence.error.message}`);
});

test.afterEach(async () => {
  if (!admin) return;
  const cleanupFailures: string[] = [];
  const runCleanup = async (label: string, operation: () => PromiseLike<{ error: { message: string } | null }>) => {
    try {
      const result = await operation();
      if (result.error) cleanupFailures.push(`${label}: ${result.error.message}`);
    } catch (error) {
      cleanupFailures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  if (projectId) {
    const claims = await admin.from('tm_claims').select('id').eq('project_id', projectId);
    if (claims.error) cleanupFailures.push(`read claims: ${claims.error.message}`);
    const claimIds = (claims.data ?? []).map((claim) => claim.id);
    const signedOff = claimIds.length > 0
      ? await admin.from('tm_claims').select('id').in('id', claimIds).eq('status', 'SignedOff').limit(1)
      : { data: [], error: null };
    if (signedOff.error) cleanupFailures.push(`read signed-off claims: ${signedOff.error.message}`);

    const preserveFixture = Boolean(claims.error || signedOff.error || signedOff.data?.length);
    if (preserveFixture) {
      // A confirmed claim and its billing evidence are immutable. If status readback failed, fail
      // closed the same way: retain the source chain and archive its project instead of guessing.
      await runCleanup('archive confirmed project', () => admin!.from('projects')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', projectId)
        .select('id')
        .single());
    } else {
      if (claimIds.length > 0) {
        await runCleanup('claim evidence', () => admin!.from('progress_claim_evidence').delete().in('claim_id', claimIds));
        await runCleanup('progress claims', () => admin!.from('progress_claims').delete().in('id', claimIds));
        await runCleanup('time-and-materials claims', () => admin!.from('tm_claims').delete().in('id', claimIds));
      }
      await runCleanup('rate assignments', () => admin!.from('contract_rate_assignees').delete().eq('project_id', projectId));
      await runCleanup('rate lines', () => admin!.from('contract_rate_lines').delete().eq('project_id', projectId));
      await runCleanup('project evidence', () => admin!.from('project_documents').delete().eq('project_id', projectId));
      await runCleanup('timesheet entries', () => admin!.from('timesheet_entries').delete().eq('project_id', projectId));
    }

    if (!preserveFixture && timesheetSlotReserved && engineerId && weekStart) {
      const sheet = await admin
        .from('timesheets')
        .select('id')
        .eq('user_id', engineerId)
        .eq('week_start_date', weekStart)
        .maybeSingle();
      if (sheet.error) cleanupFailures.push(`read timesheet: ${sheet.error.message}`);
      else if (sheet.data) {
        const entries = await admin.from('timesheet_entries').select('project_id').eq('timesheet_id', sheet.data.id);
        if (entries.error) cleanupFailures.push(`read timesheet entries: ${entries.error.message}`);
        else if ((entries.data ?? []).every((entry) => entry.project_id === projectId)) {
          await runCleanup('timesheet entries', () => admin!.from('timesheet_entries').delete().eq('timesheet_id', sheet.data!.id));
          await runCleanup('timesheet', () => admin!.from('timesheets').delete().eq('id', sheet.data!.id));
        } else {
          cleanupFailures.push('timesheet slot contains another project and was preserved');
        }
      }
    }

    if (!preserveFixture) {
      await runCleanup('project', () => admin!.from('projects').delete().eq('id', projectId));
      if (companyId) await runCleanup('client', () => admin!.from('companies').delete().eq('id', companyId));
    }
  }
  if (cleanupFailures.length > 0) throw new Error(`AC-TM-018 cleanup failed: ${cleanupFailures.join('; ')}`);
});

test('AC-TM-018 Finance rates a week, its manager assembles it, and a second user confirms the claim math', async ({ page }) => {
  const serviceClient = admin;
  if (!serviceClient) throw new Error('AC-TM-018 fixture client was not initialized.');

  // The item catalog is an external read, so supply a local catalog row while the actual rate and mapping writes use the app.
  await page.route('**/rest/v1/external_domain_ownership?*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': '0-0/1' },
      body: JSON.stringify([{ id: randomUUID(), org_id: orgId, external_tier: 'erpnext', domain: 'revenue' }]),
    });
  });
  // The Overview reads ownership through the one overview read; swap only that section for the same row.
  await page.route('**/rest/v1/rpc/get_project_overview_read', async (route) => {
    const res = await route.fetch();
    const rows = await res.json();
    const ownership = [{ id: randomUUID(), org_id: orgId, external_tier: 'erpnext', domain: 'revenue' }];
    await route.fulfill({ response: res, json: Array.isArray(rows) ? rows.map((r: object) => ({ ...r, external_domain_ownership: ownership })) : { ...rows, external_domain_ownership: ownership } });
  });
  await page.route('**/functions/v1/external-items', async (route) => {
    const request = route.request().postDataJSON() as { purpose?: string } | null;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: request?.purpose === 'sales' ? [{ code: itemCode, name: ITEM_NAME }] : [] }),
    });
  });
  await pinEnglishLocale(page);

  const billingUrl = `/projects/${projectId}/billing`;
  await login(page, FINANCE_EMAIL);
  await page.clock.setFixedTime(fixedNow);
  await page.goto(billingUrl);
  await expect(page.getByRole('heading', { name: 'Time and materials' })).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Add rate' }).click();
  const rateDialog = page.getByRole('dialog', { name: 'Add labour rate' });
  await expect(rateDialog).toBeVisible();
  await rateDialog.getByLabel('Role or work description').fill(LINE_LABEL);
  await rateDialog.getByLabel('Rate per hour').fill(String(RATE));
  await rateDialog.getByLabel('Effective from').fill(weekStart);
  await rateDialog.getByRole('button', { name: 'Save rate' }).click();
  await expect(rateDialog).not.toBeVisible({ timeout: 15_000 });

  await pickComboboxOption(page, page, new RegExp(`^Sales item for ${LINE_LABEL}$`, 'i'), new RegExp(itemCode));
  await expect.poll(async () => {
    const result = await serviceClient.from('contract_rate_lines').select('sales_item_code').eq('project_id', projectId).single();
    if (result.error) throw result.error;
    return result.data.sales_item_code;
  }).toBe(itemCode);

  await page.getByRole('button', { name: 'Assign person' }).click();
  const assignmentDialog = page.getByRole('dialog', { name: 'Assign a person to a rate' });
  await expect(assignmentDialog).toBeVisible();
  await assignmentDialog.getByLabel('Rate line').selectOption({ label: `${LINE_LABEL} · hour` });
  await pickComboboxOption(assignmentDialog, page, /^Person$/i, new RegExp(ENGINEER_NAME));
  await assignmentDialog.getByLabel('Effective from').fill(weekStart);
  await assignmentDialog.getByRole('button', { name: 'Assign person' }).click();
  await expect(assignmentDialog).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(ENGINEER_NAME, { exact: true })).toBeVisible();

  // Restore wall-clock time while replaying the captured auth fixture, then pin the business date again.
  await page.clock.setFixedTime(new Date());
  await login(page, ENGINEER_EMAIL);
  await page.clock.setFixedTime(fixedNow);
  await page.goto('/timesheets');
  await expect(page.getByTestId('timesheets-loading')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel('Add a project')).toBeVisible({ timeout: 10_000 });
  await page.getByLabel('Add a project').selectOption(projectId);
  await expect(page.getByText(projectName, { exact: true })).toBeVisible();
  const hours = page.getByRole('textbox', { name: new RegExp(`${projectName}, ${workdayLabel} hours`, 'i') });
  await hours.fill(String(HOURS));
  await expect(page.getByTestId('timesheets-weekly-total')).toContainText(String(HOURS));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(visibleToast(page, /timesheet saved/i)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /^Submit (?:timesheet|week)$/i }).click();
  const submitDialog = page.getByRole('dialog');
  await expect(submitDialog).toBeVisible();
  await submitDialog.getByRole('button', { name: 'Submit timesheet' }).click();
  await expect(submitDialog).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Submitted', { exact: true })).toBeVisible({ timeout: 15_000 });

  const submitted = await serviceClient
    .from('timesheets')
    .select('id, status')
    .eq('user_id', engineerId)
    .eq('week_start_date', weekStart)
    .single();
  if (submitted.error) throw new Error(`AC-TM-018 submitted week: ${submitted.error.message}`);
  expect(submitted.data.status).toBe('Submitted');

  await page.clock.setFixedTime(new Date());
  await login(page, MANAGER_EMAIL);
  await page.clock.setFixedTime(fixedNow);
  await page.goto('/approvals?scope=timesheets');
  await expect(page.getByTestId('approvals-loading')).not.toBeVisible({ timeout: 15_000 });
  const approvalQueue = page.getByRole('region', { name: 'Approvals queue' });
  const approvalItem = approvalQueue
    .getByRole('button')
    .filter({ hasText: ENGINEER_NAME })
    .filter({ hasText: projectName });
  await expect(approvalItem).toBeVisible({ timeout: 15_000 });
  await approvalItem.click();
  const approvalPreview = page.getByRole('region', { name: 'Approval preview' });
  await expect(approvalPreview.getByRole('heading', { name: ENGINEER_NAME })).toBeVisible();
  await expect(approvalPreview).toContainText(projectName);
  await approvalPreview.getByRole('button', { name: /^approve$/i }).click();
  const approvalDialog = page.getByRole('dialog');
  await expect(approvalDialog).toBeVisible();
  await approvalDialog.getByRole('button', { name: /^approve$/i }).click();
  await expect(approvalDialog).not.toBeVisible({ timeout: 15_000 });
  await expect(visibleToast(page, 'Timesheet approved')).toBeVisible({ timeout: 15_000 });
  await expect(approvalItem).toHaveCount(0, { timeout: 15_000 });

  const approved = await serviceClient.from('timesheets').select('status, approved_by').eq('id', submitted.data.id).single();
  if (approved.error) throw new Error(`AC-TM-018 approved week: ${approved.error.message}`);
  expect(approved.data).toMatchObject({ status: 'Approved', approved_by: managerId });

  await page.goto(billingUrl);
  const assembly = page.locator('section[aria-labelledby="tm-assemble-heading"]');
  await expect(assembly).toBeVisible({ timeout: 20_000 });
  await assembly.getByLabel('From').fill(weekStart);
  await assembly.getByLabel('To').fill(today);
  const previewLine = assembly.locator('li').filter({ hasText: LINE_LABEL });
  await expect(previewLine).toContainText(new RegExp(`${HOURS} hours?\\s*×.*50[,\\s]000.*=.*400[,\\s]000`, 'i'));
  await assembly.getByRole('button', { name: 'Assemble claim' }).click();
  await expect(visibleToast(page, /claim assembled/i)).toBeVisible({ timeout: 15_000 });

  const claims = page.locator('section[aria-labelledby="tm-claims-heading"]');
  const claimLink = claims.getByRole('button', { name: /Open claim for/i });
  await expect(claimLink).toBeVisible({ timeout: 15_000 });
  await claimLink.click();
  const claimDrawer = page.getByRole('dialog', { name: 'Time-and-materials claim' });
  await expect(claimDrawer.getByRole('heading', { name: 'Claim lines' })).toBeVisible();
  const claimLines = claimDrawer.getByRole('region', { name: 'Claim lines' });
  const pmClaimLine = claimLines.getByRole('listitem').filter({ hasText: LINE_LABEL });
  await expect(pmClaimLine).toContainText(new RegExp(`${HOURS} hours?\\s*×.*50[,\\s]000`));
  await expect(pmClaimLine).toContainText(/400[,\s]000/);
  const sourceEntries = claimDrawer.getByRole('region', { name: 'Approved source entries' });
  const engineerSources = sourceEntries.getByRole('listitem').filter({ hasText: ENGINEER_NAME });
  const sourceDate = new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${today}T00:00:00.000Z`));
  await expect(engineerSources).toContainText(new RegExp(`${LINE_LABEL}.*${sourceDate}.*${HOURS} hours?`, 'i'));
  await claimDrawer.getByRole('button', { name: 'Prepare sign-off' }).click();
  const prepareDialog = page.getByRole('dialog', { name: 'Prepare client sign-off' });
  await expect(prepareDialog).toBeVisible();
  await prepareDialog.getByLabel('Evidence document').selectOption(documentId);
  await prepareDialog.getByRole('button', { name: 'Prepare sign-off' }).click();
  await expect(prepareDialog).not.toBeVisible({ timeout: 15_000 });
  // Issue 1816: the success toast fires while the claim drawer is still open, and the
  // drawer's title AND sign-off actions all live in its header — the toast must tuck
  // below that band, never on top of it. Asserted on desktop and again on a phone width
  // (a wrapped header is taller; placement re-measures on resize).
  const expectToastClearOfDrawerHeader = async () => {
    const toastBox = await visibleToast(page, /client sign-off prepared/i).boundingBox();
    const headerBox = await claimDrawer.locator('[data-drawer-header]').boundingBox();
    expect(toastBox, 'the success toast rendered').toBeTruthy();
    expect(headerBox, 'the claim drawer header rendered').toBeTruthy();
    const overlaps = toastBox!.x < headerBox!.x + headerBox!.width
      && headerBox!.x < toastBox!.x + toastBox!.width
      && toastBox!.y < headerBox!.y + headerBox!.height
      && headerBox!.y < toastBox!.y + toastBox!.height;
    expect(overlaps, `toast ${JSON.stringify(toastBox)} covers drawer header ${JSON.stringify(headerBox)}`).toBe(false);
  };
  await expect(visibleToast(page, /client sign-off prepared/i)).toBeVisible({ timeout: 15_000 });
  await expectToastClearOfDrawerHeader();
  await page.setViewportSize({ width: 390, height: 800 });
  await waitForFonts(page);
  await expectToastClearOfDrawerHeader();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(claimDrawer.getByText('A different user must confirm this sign-off.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Confirm sign-off' })).toHaveCount(0);

  await page.clock.setFixedTime(new Date());
  await login(page, FINANCE_EMAIL);
  await page.clock.setFixedTime(fixedNow);
  await page.goto(billingUrl);
  const financeClaims = page.locator('section[aria-labelledby="tm-claims-heading"]');
  await expect(financeClaims.getByText('Awaiting confirmation', { exact: true })).toBeVisible({ timeout: 20_000 });
  await financeClaims.getByRole('button', { name: /Open claim for/i }).click();
  const confirmDrawer = page.getByRole('dialog', { name: 'Time-and-materials claim' });
  await confirmDrawer.getByRole('button', { name: 'Confirm sign-off' }).click();
  const confirmDialog = page.getByRole('dialog', { name: 'Confirm client sign-off?' });
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole('button', { name: 'Confirm sign-off' }).click();
  await expect(confirmDialog).not.toBeVisible({ timeout: 15_000 });

  // This lane has no live ERP bench. The existing invoice action depends on that external service, so the journey stops at the confirmed PMO claim and does not fabricate an invoice response.
  await page.reload();
  const signedOffClaims = page.locator('section[aria-labelledby="tm-claims-heading"]');
  await expect(signedOffClaims.getByText('Signed off', { exact: true })).toBeVisible({ timeout: 20_000 });
  await signedOffClaims.getByRole('button', { name: /Open claim for/i }).click();
  const signedOffDrawer = page.getByRole('dialog', { name: 'Time-and-materials claim' });
  const signedOffLines = signedOffDrawer.getByRole('region', { name: 'Claim lines' });
  const finalLine = signedOffLines.getByRole('listitem').filter({ hasText: LINE_LABEL });
  await expect(finalLine).toContainText(new RegExp(`${HOURS} hours?\\s*×.*50[,\\s]000`));
  await expect(finalLine).toContainText(/400[,\s]000/);

  const claimResult = await serviceClient
    .from('tm_claims')
    .select('id, status, prepared_by, signoff_prepared_by, confirmed_by, gross_amount')
    .eq('project_id', projectId)
    .single();
  if (claimResult.error) throw new Error(`AC-TM-018 confirmed claim: ${claimResult.error.message}`);
  expect(claimResult.data).toMatchObject({
    status: 'SignedOff',
    prepared_by: managerId,
    signoff_prepared_by: managerId,
    confirmed_by: financeId,
    gross_amount: HOURS * RATE,
  });
  const lineResult = await serviceClient.from('tm_claim_lines').select('units, rate, amount').eq('claim_id', claimResult.data.id).single();
  if (lineResult.error) throw new Error(`AC-TM-018 frozen claim line: ${lineResult.error.message}`);
  expect(lineResult.data).toMatchObject({ units: HOURS, rate: RATE, amount: HOURS * RATE });
});
