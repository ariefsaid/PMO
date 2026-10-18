// @e2e-isolation: self-isolated — per-attempt UUID keys, exact-org preflight, durable owner ledger, and scoped cleanup for the real import writes.
/**
 * AC-IMP-CYCLE-001 — Procurement-cycle bulk import: curated cross-stack journey (ADR-0035 M5).
 *
 * An admin uploads a one-sheet .xlsx with TWO cases:
 *   (a) case-001: a partial PR→VI→Payment case (no PO/Quotation — partial but valid under Model-C)
 *   (b) case-002: a PR-less VI→Payment case (no PR/PO required under Model-C)
 *
 * Goal oracle (binding — the app conforms to this, not the reverse):
 *   BOTH cases appear in the /procurement list after the import completes.
 *   case-001's title "E2E Full Case <runId>" is visible.
 *   case-002's title "E2E Invoice-only <runId>" is visible.
 *   Neither case is present BEFORE the import (created in this run only).
 *   The import wizard closes and the list is refreshed automatically.
 *
 * Journey: /procurement → "Import cycle" button → upload xlsx → mapping auto-maps
 * → preview shows 2 cases → "Import N records" → result summary → Done → list refetched.
 *
 * Isolation strategy: runId = Date.now() makes titles unique per attempt;
 * no seed rows needed (all data created in-test via the real import RPC chain).
 *
 * BDD authoring principle: test encodes the user's intuitive goal, not app internals.
 * On failure: fix the APP; only update the journey if a deliberate UX change was made.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import ExcelJS from 'exceljs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { login, requireServiceRoleKey } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

test.setTimeout(180_000);

const SEED_ORG_ID = '00000000-0000-0000-0000-000000000001';
if (process.env.E2E_ORG_ID && process.env.E2E_ORG_ID !== SEED_ORG_ID) {
  throw new Error('AC-IMP-CYCLE-001 requires the fixed local seed admin organization');
}
const ORG_ID = SEED_ORG_ID;
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL,
  process.env.VITE_SUPABASE_URL,
);

type ImportRecordTable = 'purchase_requests' | 'procurement_invoices' | 'payments';
type ImportReferenceColumn = 'reference_number';

interface ExpectedImportRecord {
  table: ImportRecordTable;
  importKey: string;
  parentCaseRef: string;
  referenceColumn: ImportReferenceColumn;
  referenceValue: string;
}

interface CycleFixture {
  runTag: string;
  fullCaseRef: string;
  invoiceCaseRef: string;
  fullTitle: string;
  invoiceTitle: string;
  fullPrRef: string;
  fullInvoiceRef: string;
  fullPaymentRef: string;
  invoiceOnlyInvoiceRef: string;
  invoiceOnlyPaymentRef: string;
  expectedRecords: ExpectedImportRecord[];
  ledgerPath: string;
}

interface OwnedParentRow {
  id: string;
  import_key: string | null;
  title: string;
  import_batch_id: string | null;
}

interface OwnedChildRow {
  id: string;
  import_key: string | null;
  procurement_id: string;
  import_batch_id: string | null;
  external_ref?: string | null;
  reference_number?: string | null;
}

let admin: SupabaseClient | undefined;
let fixture: CycleFixture | undefined;
let importStarted = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function waitIndexReady(page: Page) {
  await expect(page.getByTestId('liststate-loading')).toHaveCount(0, { timeout: 20_000 });
}

test.beforeEach(async ({ browserName }, testInfo) => {
  void browserName;
  admin = undefined;
  fixture = undefined;
  importStarted = false;

  const serviceRoleKey = requireServiceRoleKey();
  if (!serviceRoleKey) throw new Error('AC-IMP-CYCLE-001 requires the local e2e wrapper for exact preflight and cleanup');

  const client = createClient(SUPABASE_URL, serviceRoleKey, { auth: { persistSession: false } });
  const nextFixture = buildFixture(randomUUID(), testInfo.outputPath('fixture-owner.ndjson'));
  await assertFixtureKeysUnused(client, nextFixture);

  // This fsync-backed ledger is written only after all exact org/key preflights are clear and
  // before the test can reach the import button. A preflight collision never arms cleanup.
  await appendOwnerLedger(nextFixture.ledgerPath, {
    phase: 'armed-before-import',
    testId: testInfo.testId,
    retry: testInfo.retry,
    runTag: nextFixture.runTag,
    cases: [
      { importKey: nextFixture.fullCaseRef, title: nextFixture.fullTitle },
      { importKey: nextFixture.invoiceCaseRef, title: nextFixture.invoiceTitle },
    ],
    records: nextFixture.expectedRecords,
  }, true);

  admin = client;
  fixture = nextFixture;
});

test.afterEach(async ({ browserName }, testInfo) => {
  void browserName;
  const client = admin;
  const ownedFixture = fixture;
  const didStartImport = importStarted;
  admin = undefined;
  fixture = undefined;
  importStarted = false;
  if (!client || !ownedFixture) return;

  await appendOwnerLedger(ownedFixture.ledgerPath, {
    phase: didStartImport ? 'cleanup-after-import' : 'cleanup-without-import',
    testStatus: testInfo.status,
  });
  await cleanupFixture(client, ownedFixture, testInfo);
});

function buildFixture(runTag: string, ledgerPath: string): CycleFixture {
  const fullCaseRef = `e2e-full-${runTag}`;
  const invoiceCaseRef = `e2e-invoice-only-${runTag}`;
  const fullPrRef = `E2E-${runTag}-PR`;
  const fullInvoiceRef = `E2E-${runTag}-FULL-VI`;
  const fullPaymentRef = `E2E-${runTag}-FULL-PAY`;
  const invoiceOnlyInvoiceRef = `E2E-${runTag}-INVOICE-VI`;
  const invoiceOnlyPaymentRef = `E2E-${runTag}-INVOICE-PAY`;

  return {
    runTag,
    fullCaseRef,
    invoiceCaseRef,
    fullTitle: `E2E Full Case ${runTag}`,
    invoiceTitle: `E2E Invoice-only ${runTag}`,
    fullPrRef,
    fullInvoiceRef,
    fullPaymentRef,
    invoiceOnlyInvoiceRef,
    invoiceOnlyPaymentRef,
    expectedRecords: [
      { table: 'purchase_requests', importKey: fullPrRef, parentCaseRef: fullCaseRef, referenceColumn: 'reference_number', referenceValue: fullPrRef },
      { table: 'procurement_invoices', importKey: fullInvoiceRef, parentCaseRef: fullCaseRef, referenceColumn: 'reference_number', referenceValue: fullInvoiceRef },
      { table: 'payments', importKey: fullPaymentRef, parentCaseRef: fullCaseRef, referenceColumn: 'reference_number', referenceValue: fullPaymentRef },
      { table: 'procurement_invoices', importKey: invoiceOnlyInvoiceRef, parentCaseRef: invoiceCaseRef, referenceColumn: 'reference_number', referenceValue: invoiceOnlyInvoiceRef },
      { table: 'payments', importKey: invoiceOnlyPaymentRef, parentCaseRef: invoiceCaseRef, referenceColumn: 'reference_number', referenceValue: invoiceOnlyPaymentRef },
    ],
    ledgerPath,
  };
}

async function appendOwnerLedger(
  ledgerPath: string,
  event: Record<string, unknown>,
  create = false,
): Promise<void> {
  await mkdir(dirname(ledgerPath), { recursive: true, mode: 0o700 });
  const handle = await open(ledgerPath, create ? 'wx' : 'a', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(event)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function recordKeysFor(fixture: CycleFixture, table: ImportRecordTable): string[] {
  return fixture.expectedRecords.filter((record) => record.table === table).map((record) => record.importKey);
}

async function assertFixtureKeysUnused(client: SupabaseClient, fixture: CycleFixture): Promise<void> {
  const parentKeys = [fixture.fullCaseRef, fixture.invoiceCaseRef];
  const titles = [fixture.fullTitle, fixture.invoiceTitle];
  const prKeys = recordKeysFor(fixture, 'purchase_requests');
  const invoiceKeys = recordKeysFor(fixture, 'procurement_invoices');
  const paymentKeys = recordKeysFor(fixture, 'payments');
  const probes = [
    ['procurements.import_key', () => client.from('procurements').select('id').eq('org_id', ORG_ID).in('import_key', parentKeys)],
    ['procurements.title', () => client.from('procurements').select('id').eq('org_id', ORG_ID).in('title', titles)],
    ['purchase_requests.import_key', () => client.from('purchase_requests').select('id').eq('org_id', ORG_ID).in('import_key', prKeys)],
    ['purchase_requests.external_ref', () => client.from('purchase_requests').select('id').eq('org_id', ORG_ID).in('external_ref', prKeys)],
    ['procurement_invoices.import_key', () => client.from('procurement_invoices').select('id').eq('org_id', ORG_ID).in('import_key', invoiceKeys)],
    ['procurement_invoices.external_ref', () => client.from('procurement_invoices').select('id').eq('org_id', ORG_ID).in('external_ref', invoiceKeys)],
    ['payments.import_key', () => client.from('payments').select('id').eq('org_id', ORG_ID).in('import_key', paymentKeys)],
    ['payments.reference_number', () => client.from('payments').select('id').eq('org_id', ORG_ID).in('reference_number', paymentKeys)],
  ] as const;

  const collisions: string[] = [];
  for (const [label, run] of probes) {
    const { data, error } = await run();
    if (error) throw new Error(`AC-IMP-CYCLE-001 preflight query failed (${label}): ${error.message}`);
    if (data?.length) collisions.push(label);
  }
  if (collisions.length) {
    throw new Error(
      `AC-IMP-CYCLE-001 fixture collision in ${collisions.join(', ')}; refusing import and cleanup for unowned rows`,
    );
  }
}

async function readOwnedRows(client: SupabaseClient, fixture: CycleFixture) {
  const parentKeys = [fixture.fullCaseRef, fixture.invoiceCaseRef];
  const parentsResult = await client
    .from('procurements')
    .select('id, import_key, title, import_batch_id')
    .eq('org_id', ORG_ID)
    .in('import_key', parentKeys);
  if (parentsResult.error) throw new Error(`AC-IMP-CYCLE-001 cleanup readback (procurements): ${parentsResult.error.message}`);

  const parents = (parentsResult.data ?? []) as OwnedParentRow[];
  const parentByRef = new Map<string, OwnedParentRow>();
  for (const parent of parents) {
    if (parentByRef.has(parent.import_key ?? '')) throw new Error('AC-IMP-CYCLE-001 cleanup found duplicate owned case keys; preserving rows');
    const expectedTitle = parent.import_key === fixture.fullCaseRef
      ? fixture.fullTitle
      : parent.import_key === fixture.invoiceCaseRef
        ? fixture.invoiceTitle
        : undefined;
    if (!expectedTitle || parent.title !== expectedTitle) {
      throw new Error('AC-IMP-CYCLE-001 cleanup found a case whose key/title identity does not match this run; preserving rows');
    }
    parentByRef.set(parent.import_key!, parent);
  }

  const children: OwnedChildRow[] = [];
  for (const table of ['payments', 'procurement_invoices', 'purchase_requests'] as const) {
    const keys = recordKeysFor(fixture, table);
    if (keys.length === 0) continue;
    const query = table === 'payments'
      ? client.from('payments').select('id, import_key, procurement_id, import_batch_id, reference_number')
      : table === 'purchase_requests'
      ? client.from('purchase_requests').select('id, import_key, procurement_id, import_batch_id, reference_number, external_ref')
        : client.from('procurement_invoices').select('id, import_key, procurement_id, import_batch_id, reference_number, external_ref');
    const { data, error } = await query.eq('org_id', ORG_ID).in('import_key', keys);
    if (error) throw new Error(`AC-IMP-CYCLE-001 cleanup readback (${table}): ${error.message}`);

    const tableRows = (data ?? []) as OwnedChildRow[];
    const seenKeys = new Set<string>();
    for (const row of tableRows) {
      const key = row.import_key ?? '';
      const expected = fixture.expectedRecords.find((record) => record.table === table && record.importKey === key);
      const parent = expected ? parentByRef.get(expected.parentCaseRef) : undefined;
      const actualReference = row.reference_number;
      const unexpectedExternalRef = table !== 'payments' && row.external_ref !== null;
      if (!expected || !parent || row.procurement_id !== parent.id || actualReference !== expected.referenceValue
        || unexpectedExternalRef || seenKeys.has(key)) {
        throw new Error(`AC-IMP-CYCLE-001 cleanup found an unowned or ambiguous ${table} row; preserving fixture rows`);
      }
      seenKeys.add(key);
      children.push(row);
    }
  }

  const expectedByTable = new Map<ImportRecordTable, Set<string>>();
  for (const record of fixture.expectedRecords) {
    const keys = expectedByTable.get(record.table) ?? new Set<string>();
    keys.add(record.importKey);
    expectedByTable.set(record.table, keys);
  }

  for (const table of ['payments', 'procurement_invoices', 'purchase_requests'] as const) {
    const ownedParents = [...parentByRef.values()].map((parent) => parent.id);
    if (!ownedParents.length) continue;
    const { data, error } = await client
      .from(table)
      .select('id, import_key, procurement_id, import_batch_id')
      .eq('org_id', ORG_ID)
      .in('procurement_id', ownedParents);
    if (error) throw new Error(`AC-IMP-CYCLE-001 cleanup parent check (${table}): ${error.message}`);
    const knownKeys = expectedByTable.get(table) ?? new Set<string>();
    const ownedIds = new Set(children.filter((row) => knownKeys.has(row.import_key ?? '')).map((row) => row.id));
    if ((data ?? []).some((row) => !ownedIds.has(row.id))) {
      throw new Error(`AC-IMP-CYCLE-001 cleanup found an unexpected ${table} child under an owned case; preserving fixture rows`);
    }
  }

  if ([...parents, ...children].some((row) => !row.import_batch_id)) {
    throw new Error('AC-IMP-CYCLE-001 cleanup found a row without its import-batch owner; preserving fixture rows');
  }
  const batchIds = new Set([...parents, ...children].map((row) => row.import_batch_id!));
  if (batchIds.size > 1) throw new Error('AC-IMP-CYCLE-001 cleanup found mixed import batches; preserving fixture rows');

  return { parents, children, parentByRef, importBatchId: [...batchIds][0] ?? null };
}

async function deleteOwnedChild(
  client: SupabaseClient,
  record: ExpectedImportRecord,
  row: OwnedChildRow,
): Promise<void> {
  const expectedReferenceColumn = 'reference_number';
  if (
    !row.import_batch_id
    || row.import_key !== record.importKey
    || record.referenceColumn !== expectedReferenceColumn
  ) {
    throw new Error(`AC-IMP-CYCLE-001 cleanup delete (${record.table}) lost its exact batch/key/reference owner; preserving rows`);
  }

  const { data, error } = record.table === 'payments'
    ? await client
      .from('payments')
      .delete()
      .eq('id', row.id)
      .eq('org_id', ORG_ID)
      .eq('procurement_id', row.procurement_id)
      .eq('import_key', record.importKey)
      .eq('import_batch_id', row.import_batch_id)
      .eq('reference_number', record.referenceValue)
      .select('id')
    : record.table === 'purchase_requests'
      ? await client
        .from('purchase_requests')
        .delete()
        .eq('id', row.id)
        .eq('org_id', ORG_ID)
        .eq('procurement_id', row.procurement_id)
        .eq('import_key', record.importKey)
        .eq('import_batch_id', row.import_batch_id)
        .eq('reference_number', record.referenceValue)
        .is('external_ref', null)
        .select('id')
      : await client
        .from('procurement_invoices')
        .delete()
        .eq('id', row.id)
        .eq('org_id', ORG_ID)
        .eq('procurement_id', row.procurement_id)
        .eq('import_key', record.importKey)
        .eq('import_batch_id', row.import_batch_id)
        .eq('reference_number', record.referenceValue)
        .is('external_ref', null)
        .select('id');
  if (error) throw new Error(`AC-IMP-CYCLE-001 cleanup delete (${record.table}): ${error.message}`);
  if (data?.length !== 1 || data[0].id !== row.id) {
    throw new Error(`AC-IMP-CYCLE-001 cleanup delete (${record.table}) did not remove its exact owner-ledger row`);
  }
}

async function cleanupFixture(client: SupabaseClient, fixture: CycleFixture, testInfo: TestInfo): Promise<void> {
  const owned = await readOwnedRows(client, fixture);
  const incompleteSuccessfulImport = testInfo.status === 'passed'
    && (owned.parents.length !== 2 || owned.children.length !== fixture.expectedRecords.length);
  await appendOwnerLedger(fixture.ledgerPath, {
    phase: 'readback-before-cleanup',
    parentIds: owned.parents.map((row) => row.id),
    childIds: owned.children.map((row) => row.id),
    importBatchId: owned.importBatchId,
    completeExpectedImport: !incompleteSuccessfulImport,
    testStatus: testInfo.status,
  });

  for (const table of ['payments', 'procurement_invoices', 'purchase_requests'] as const) {
    for (const row of owned.children.filter((child) => fixture.expectedRecords.some((record) => record.table === table && record.importKey === child.import_key))) {
      const expected = fixture.expectedRecords.find((record) => record.table === table && record.importKey === row.import_key);
      if (!expected) throw new Error(`AC-IMP-CYCLE-001 cleanup lost the expected ${table} reference; preserving rows`);
      await deleteOwnedChild(client, expected, row);
    }
  }

  for (const parent of owned.parents) {
    if (!parent.import_batch_id) {
      throw new Error('AC-IMP-CYCLE-001 cleanup lost the procurement import-batch owner; preserving rows');
    }
    const { data, error } = await client
      .from('procurements')
      .delete()
      .eq('id', parent.id)
      .eq('org_id', ORG_ID)
      .eq('import_key', parent.import_key)
      .eq('title', parent.title)
      .eq('import_batch_id', parent.import_batch_id)
      .select('id');
    if (error) throw new Error(`AC-IMP-CYCLE-001 cleanup delete (procurements): ${error.message}`);
    if (data?.length !== 1 || data[0].id !== parent.id) {
      throw new Error('AC-IMP-CYCLE-001 cleanup did not remove its exact owned procurement row');
    }
  }

  await assertFixtureKeysUnused(client, fixture);
  await appendOwnerLedger(fixture.ledgerPath, { phase: 'postflight-clean', testStatus: testInfo.status });
  if (incompleteSuccessfulImport) {
    throw new Error('AC-IMP-CYCLE-001 passed its UI journey without all 2 owned cases and 5 imported records present');
  }
}

/**
 * Build a real .xlsx buffer that matches the 10-column cycle sheet contract:
 * case_ref | type | project | title | case_status | vendor | external_ref | status | date | amount
 */
async function buildCycleXlsx(fixture: CycleFixture): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Cycles');

  // Header row (matches the fixed 10-column contract)
  ws.addRow([
    'case_ref',
    'type',
    'project',
    'title',
    'case_status',
    'vendor',
    'external_ref',
    'status',
    'date',
    'amount',
    // #505 / OD-TAX-1: a VI row must state its tax basis. `tax_treatment` has no default and
    // `tax_amount` requires an explicit 0 for "no tax" — a stored money figure whose
    // inclusive/exclusive status is unrecorded cannot be disambiguated afterwards. Non-VI rows
    // leave both blank; validate.ts only demands them on VI.
    'tax_treatment',
    'tax_amount',
  ]);

  // ── case-001: partial PR→VI→Payment (no PO/Quotation — still legal under Model-C) ──
  // PR row
  ws.addRow([fixture.fullCaseRef, 'PR', '', fixture.fullTitle, 'Draft', '', fixture.fullPrRef, '', '', '', '', '']);
  // VI row (required: status ∈ {Received,Scheduled,Paid}, date YYYY-MM-DD, plus the #505 tax basis)
  ws.addRow([fixture.fullCaseRef, 'VI', '', '', '', '', fixture.fullInvoiceRef, 'Received', '2024-03-15', '10000', 'exclusive', '1100']);
  // Payment row
  ws.addRow([fixture.fullCaseRef, 'Payment', '', '', '', '', fixture.fullPaymentRef, '', '2024-03-20', '10000', '', '']);

  // ── case-002: PR-less VI→Payment (Model-C: no PR or PO required) ────────────
  // VI row
  // The second VI states a DIFFERENT basis from the first on purpose: a fixture where every row
  // shares one treatment cannot tell a per-row read from a hardcoded constant.
  ws.addRow([fixture.invoiceCaseRef, 'VI', '', fixture.invoiceTitle, '', '', fixture.invoiceOnlyInvoiceRef, 'Received', '2024-04-01', '5000', 'inclusive', '0']);
  // Payment row
  ws.addRow([fixture.invoiceCaseRef, 'Payment', '', '', '', '', fixture.invoiceOnlyPaymentRef, '', '2024-04-05', '5000', '', '']);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

// ── Test ──────────────────────────────────────────────────────────────────────

test(
  'AC-IMP-CYCLE-001: admin imports a cycle xlsx with a full case and a PR-less case — both cases land in the procurement list',
  async ({ page }) => {
    const currentFixture = fixture;
    if (!currentFixture) throw new Error('AC-IMP-CYCLE-001 fixture was not safely preflighted');
    const { fullTitle, invoiceTitle } = currentFixture;

    const xlsx = await buildCycleXlsx(currentFixture);

    // ── Step 1: navigate to /procurement as admin ──────────────────────────────
    await login(page, 'admin@acme.test');
    await page.goto('/procurement');
    await waitIndexReady(page);

    // Confirm neither case exists yet
    await expect(page.getByText(fullTitle)).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(invoiceTitle)).not.toBeVisible({ timeout: 5_000 });

    // ── Step 2: open the cycle import wizard ──────────────────────────────────
    // S19: reveal the existing import tools before opening the wizard.
    await page.getByRole('button', { name: 'More', exact: true }).click();
    // E15: button label is "Import cycle data" (not bare "Import cycle")
    const cycleImportBtn = page.getByRole('button', { name: /import cycle data/i });
    await expect(cycleImportBtn).toBeVisible({ timeout: 10_000 });
    await cycleImportBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8_000 });

    // Title confirms it's the cycle wizard
    await expect(dialog.getByRole('heading', { name: /import procurement cycle/i })).toBeVisible();

    // ── Step 3: upload the xlsx ───────────────────────────────────────────────
    await dialog.getByLabel(/choose an \.xlsx file/i).setInputFiles({
      name: 'cycles.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: xlsx,
    });

    // ── Step 4: mapping step — auto-mapped (exact header names match contract) ─
    const nextBtn = dialog.getByRole('button', { name: /^next$/i });
    await expect(nextBtn).toBeEnabled({ timeout: 10_000 });
    await nextBtn.click();

    // ── Step 5: preview — 2 cases shown; zero writes yet ─────────────────────
    const summary = dialog.getByTestId('cycle-import-summary');
    await expect(summary).toBeVisible({ timeout: 10_000 });
    await expect(summary).toContainText('2 cases');

    // Both case refs visible in the preview tree
    await expect(dialog.getByText(currentFixture.fullCaseRef)).toBeVisible();
    await expect(dialog.getByText(currentFixture.invoiceCaseRef)).toBeVisible();

    // ── Step 6: confirm the import (the single explicit write) ────────────────
    const importBtn = dialog.getByRole('button', { name: /import \d+ record/i });
    await expect(importBtn).toBeEnabled({ timeout: 5_000 });
    await appendOwnerLedger(currentFixture.ledgerPath, { phase: 'import-started' });
    importStarted = true;
    await importBtn.click();

    // ── Step 7: result step shows created count ──────────────────────────────
    const resultSummary = dialog.getByTestId('cycle-result-summary');
    await expect(resultSummary).toBeVisible({ timeout: 30_000 });
    // 5 records total: 3 for case-001 (PR+VI+Payment), 2 for case-002 (VI+Payment)
    await expect(resultSummary).toContainText('created');

    // ── Step 8: Done — closes wizard and refetches list ───────────────────────
    await dialog.getByRole('button', { name: /^done$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // ── GOAL ORACLE 1: BOTH cases appear in the procurement list ─────────────
    // The list auto-refetches on wizard close (didImport=true → onClose(true) → refetch).
    await expect(page.getByText(fullTitle)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(invoiceTitle)).toBeVisible({ timeout: 30_000 });

    // ── GOAL ORACLE 2 (F18): records actually landed — verify via detail page ─
    // Open this run's full case by clicking its row in the list.
    const fullCaseRow = page.getByText(fullTitle);
    await fullCaseRow.click();

    // Wait for the detail page to load
    await page.waitForURL(/\/procurement\//, { timeout: 20_000 });

    // Navigate to the Documents tab where the case ledger lives
    await page.getByRole('tab', { name: /documents/i }).click();

    // The PR and VI references from this run must appear in the ledger.
    await expect(page.getByText(currentFixture.fullPrRef)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(currentFixture.fullInvoiceRef)).toBeVisible({ timeout: 10_000 });

    // ── GOAL ORACLE 3 (F18): PR-less case also committed — verify via its detail ─
    await page.goBack();
    // goBack from documents tab goes back to overview, not index — navigate to index directly
    await page.goto('/procurement');
    await waitIndexReady(page);
    const invoiceCaseRow = page.getByText(invoiceTitle);
    await invoiceCaseRow.click();
    await page.waitForURL(/\/procurement\//, { timeout: 20_000 });

    // Navigate to the Documents tab
    await page.getByRole('tab', { name: /documents/i }).click();

    // The PR-less case's VI + Payment references from this run must land.
    await expect(page.getByText(currentFixture.invoiceOnlyInvoiceRef)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(currentFixture.invoiceOnlyPaymentRef)).toBeVisible({ timeout: 10_000 });
  },
);
