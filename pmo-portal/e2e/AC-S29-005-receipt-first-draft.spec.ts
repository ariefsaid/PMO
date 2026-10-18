// @e2e-isolation: self-isolated — creates one uniquely titled claimant draft with its own first line and receipt, then removes only the durably recorded claim and its owned storage object.
import { test, expect, type Page, type Request, type Route } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, open, readFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';
import { requireServiceRoleKey, signIn, waitForFonts } from './helpers';

const SUPABASE_URL = requireMatchingLocalSupabaseUrls(process.env.SUPABASE_URL, process.env.VITE_SUPABASE_URL);
const RECEIPT_BUCKET = 'expense-receipts';
const PDF_FIXTURE = fileURLToPath(new URL('./fixtures/tiny-upload.pdf', import.meta.url));
const PDF_BYTES = await readFile(PDF_FIXTURE);
const EXPECTED_AMOUNT = 150_000;
const EXPECTED_DATE = '2026-10-07';
const EXPECTED_TYPE = 'Travel';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FirstLine = { expenseDate: string; expenseType: string; description: string; amount: number };
type OwnershipIntent = {
  runTag: string;
  orgId: string;
  claimantId: string;
  claimId: string;
  lineId: string;
  title: string;
  firstLine: FirstLine;
  numberLocale: string | null;
};
type JournalEvent = { kind: string; [key: string]: unknown };
type RpcBody = {
  p_claim_id?: unknown;
  p_line_id?: unknown;
  p_header?: { title?: unknown };
  p_first_line?: FirstLine | null;
};

let admin: SupabaseClient | undefined;
let captureTag = '';
let intentDirectory = '';
let intentPath = '';
let ownership: OwnershipIntent | undefined;
const forwardedWrites = new Set<string>();

function failClosed(message: string): never {
  throw new Error(`AC-S29-005 ${message}`);
}

async function currentActorId(page: Page): Promise<string> {
  const actorId = await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      try {
        const session = JSON.parse(localStorage.getItem(key) ?? 'null') as {
          user?: { id?: unknown };
          currentSession?: { user?: { id?: unknown } };
        } | null;
        const id = session?.user?.id ?? session?.currentSession?.user?.id;
        if (typeof id === 'string') return id;
      } catch {
        // Ignore non-session localStorage entries without returning their contents.
      }
    }
    return null;
  });
  if (!actorId || !UUID.test(actorId)) failClosed('could not bind the run to the signed-in profile.');
  return actorId;
}

async function appendIntent(event: JournalEvent): Promise<void> {
  if (!intentPath) failClosed('write intent was not initialized.');
  const handle = await open(intentPath, 'a', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(event)}\n`, { encoding: 'utf8' });
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function beginIntent(intent: OwnershipIntent, rpcBody: RpcBody): Promise<void> {
  if (intentPath) failClosed('a second claim creation was attempted in this run.');
  intentDirectory = await mkdtemp(path.join(tmpdir(), 'pmo-s29-owner-'));
  await chmod(intentDirectory, 0o700);
  intentPath = path.join(intentDirectory, 'ownership-intent.json');
  const handle = await open(intentPath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify({
      kind: 'claim_rpc_intent',
      ...intent,
      request_sha256: createHash('sha256').update(JSON.stringify(rpcBody)).digest('hex'),
    })}\n`, { encoding: 'utf8' });
    await handle.sync();
  } finally {
    await handle.close();
  }
  const directoryHandle = await open(intentDirectory, 'r');
  try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  ownership = intent;
}

async function readIntent(): Promise<JournalEvent[]> {
  if (!intentPath) return [];
  const handle = await open(intentPath, 'r');
  try {
    const stat = await handle.stat();
    if ((stat.mode & 0o777) !== 0o600) failClosed('ownership intent permissions changed.');
    const raw = await handle.readFile({ encoding: 'utf8' });
    if (!raw.endsWith('\n')) failClosed('ownership intent is incomplete; preserve the run for inspection.');
    return raw.trimEnd().split('\n').map((line) => JSON.parse(line) as JournalEvent);
  } finally {
    await handle.close();
  }
}

async function assertIdAvailable(table: 'expense_claims' | 'expense_claim_lines' | 'expense_claim_files', id: string): Promise<void> {
  if (!admin) failClosed('service client is unavailable.');
  const { data, error } = await admin.from(table).select('id').eq('id', id).maybeSingle();
  if (error || data) failClosed('a generated stable ID is unavailable; no request was forwarded.');
}

async function profileFor(page: Page): Promise<{ id: string; org_id: string; number_locale: string | null }> {
  if (!admin) failClosed('service client is unavailable.');
  const id = await currentActorId(page);
  const { data, error } = await admin.from('profiles').select('id,org_id,status,number_locale').eq('id', id).maybeSingle();
  if (error || !data || data.id !== id || data.status !== 'active' || !UUID.test(data.org_id)) {
    failClosed('the signed-in active profile could not be verified.');
  }
  return { id: data.id, org_id: data.org_id, number_locale: data.number_locale };
}

function parseBody(request: Request): unknown {
  try { return request.postDataJSON(); } catch { return null; }
}

function decodeStoragePath(request: Request, action: 'sign' | 'upload'): string | null {
  let pathname: string;
  try { pathname = decodeURIComponent(new URL(request.url()).pathname); } catch { return null; }
  const prefix = `/storage/v1/object/${action === 'sign' ? 'upload/sign' : 'upload/sign'}/${RECEIPT_BUCKET}/`;
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : null;
}

async function assertNoStorageObject(objectPath: string): Promise<void> {
  if (!admin) failClosed('service client is unavailable.');
  const parts = objectPath.split('/');
  if (parts.length !== 4 || parts.some((part) => !part || part === '.' || part === '..')) {
    failClosed('receipt path is outside the exact owned folder shape.');
  }
  const { data, error } = await admin.storage.from(RECEIPT_BUCKET).list(parts.slice(0, 3).join('/'), { search: parts[3], limit: 10 });
  if (error || (data ?? []).some((item) => item.name === parts[3])) {
    failClosed('a generated receipt path already exists; no request was forwarded.');
  }
}

async function installWriteCustody(page: Page, expected: { title: string; description: string; receiptName: string }): Promise<void> {
  const profile = await profileFor(page);
  await page.route('**/*', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== new URL(SUPABASE_URL).origin) return route.continue();

    if (request.method() === 'POST' && url.pathname === '/rest/v1/rpc/create_expense_capture') {
      if (forwardedWrites.has('claim')) return route.abort('failed');
      const body = parseBody(request) as RpcBody | null;
      const claimId = body?.p_claim_id;
      const lineId = body?.p_line_id;
      const line = body?.p_first_line;
      if (typeof claimId !== 'string' || !UUID.test(claimId)
        || typeof lineId !== 'string' || !UUID.test(lineId)
        || body?.p_header?.title !== expected.title
        || !line || line.expenseDate !== EXPECTED_DATE || line.expenseType !== EXPECTED_TYPE
        || line.description !== expected.description || line.amount !== EXPECTED_AMOUNT) {
        return route.abort('failed');
      }
      await assertIdAvailable('expense_claims', claimId);
      await assertIdAvailable('expense_claim_lines', lineId);
      const { data: titleCollision, error: titleError } = await admin!.from('expense_claims')
        .select('id').eq('org_id', profile.org_id).eq('claimant_id', profile.id).eq('title', expected.title).limit(1);
      if (titleError || (titleCollision ?? []).length > 0) failClosed('the unique run title already exists.');
      await beginIntent({
        runTag: captureTag,
        orgId: profile.org_id,
        claimantId: profile.id,
        claimId,
        lineId,
        title: expected.title,
        firstLine: { expenseDate: line.expenseDate, expenseType: line.expenseType, description: line.description, amount: line.amount },
        numberLocale: profile.number_locale,
      }, body);
      forwardedWrites.add('claim');
      return route.continue();
    }

    const signPath = request.method() === 'POST' ? decodeStoragePath(request, 'sign') : null;
    if (signPath !== null) {
      if (forwardedWrites.has('sign') || !ownership) return route.abort('failed');
      const [orgId, claimId, fileId, filename] = signPath.split('/');
      if (orgId !== ownership.orgId || claimId !== ownership.claimId || !UUID.test(fileId ?? '')
        || filename !== expected.receiptName) return route.abort('failed');
      await assertIdAvailable('expense_claim_files', fileId);
      await assertNoStorageObject(signPath);
      await appendIntent({ kind: 'signed_upload_intent', fileId, filePath: signPath, filename });
      forwardedWrites.add('sign');
      return route.continue();
    }

    const uploadPath = request.method() === 'PUT' ? decodeStoragePath(request, 'upload') : null;
    if (uploadPath !== null) {
      if (forwardedWrites.has('storage') || !ownership) return route.abort('failed');
      const events = await readIntent();
      const signEvent = events.find((event) => event.kind === 'signed_upload_intent');
      if (!signEvent || signEvent.filePath !== uploadPath) return route.abort('failed');
      await appendIntent({ kind: 'storage_put_intent', filePath: uploadPath });
      forwardedWrites.add('storage');
      return route.continue();
    }

    if (request.method() === 'POST' && url.pathname === '/rest/v1/expense_claim_files') {
      if (forwardedWrites.has('metadata') || !ownership) return route.abort('failed');
      const body = parseBody(request);
      const rows = Array.isArray(body) ? body : [body];
      const row = rows[0] as Record<string, unknown> | null;
      const events = await readIntent();
      const signEvent = events.find((event) => event.kind === 'signed_upload_intent');
      if (rows.length !== 1 || !row || !signEvent || row.id !== signEvent.fileId
        || row.claim_id !== ownership.claimId || row.file_path !== signEvent.filePath
        || (row.title !== null && row.title !== undefined)) return route.abort('failed');
      await appendIntent({ kind: 'receipt_metadata_intent', id: row.id, claimId: row.claim_id, filePath: row.file_path, title: null });
      forwardedWrites.add('metadata');
      return route.continue();
    }

    return route.continue();
  });
}

async function readExactStorageObject(objectPath: string): Promise<boolean> {
  if (!admin) failClosed('service client is unavailable.');
  const parts = objectPath.split('/');
  const { data, error } = await admin.storage.from(RECEIPT_BUCKET).list(parts.slice(0, 3).join('/'), { search: parts[3], limit: 10 });
  if (error) failClosed('receipt object readback failed.');
  const matches = (data ?? []).filter((item) => item.name === parts[3]);
  if (matches.length > 1) failClosed('receipt object readback returned duplicate names.');
  return matches.length === 1 && matches[0].id !== null;
}

async function verifyOwnedRows(intent: OwnershipIntent, events: JournalEvent[]): Promise<string | null> {
  if (!admin) failClosed('service client is unavailable.');
  const { data: claim, error: claimError } = await admin.from('expense_claims')
    .select('id,org_id,claimant_id,status,kind,title,amount,currency,submitted_at')
    .eq('id', intent.claimId).maybeSingle();
  if (claimError) failClosed('claim readback failed.');
  if (!claim) {
    const [lineResult, receiptResult] = await Promise.all([
      admin.from('expense_claim_lines').select('id').eq('id', intent.lineId),
      admin.from('expense_claim_files').select('id').eq('claim_id', intent.claimId),
    ]);
    if (lineResult.error || receiptResult.error || (lineResult.data ?? []).length || (receiptResult.data ?? []).length) {
      failClosed('claim absence conflicts with owned child readback; preserve the intent.');
    }
    const signEvent = events.find((event) => event.kind === 'signed_upload_intent');
    if (signEvent && typeof signEvent.filePath === 'string' && await readExactStorageObject(signEvent.filePath)) {
      failClosed('claim absence conflicts with an owned receipt object; preserve the intent.');
    }
    return null;
  }
  if (claim.id !== intent.claimId || claim.org_id !== intent.orgId || claim.claimant_id !== intent.claimantId
    || claim.status !== 'Draft' || claim.kind !== 'claim' || claim.title !== intent.title
    || Number(claim.amount) !== intent.firstLine.amount || claim.submitted_at !== null) {
    failClosed('claim readback does not match the exact owned Draft intent; preserve it.');
  }

  const [lines, receipts, mirrors] = await Promise.all([
    admin.from('expense_claim_lines').select('id,claim_id,org_id,expense_date,expense_type,description,amount').eq('claim_id', intent.claimId),
    admin.from('expense_claim_files').select('id,claim_id,org_id,file_path,title,uploaded_by_id,archived_at').eq('claim_id', intent.claimId),
    admin.from('expense_posting_erp_mirror').select('id').eq('claim_id', intent.claimId),
  ]);
  if (lines.error || receipts.error || mirrors.error || (mirrors.data ?? []).length !== 0) {
    failClosed('owned child or posting readback failed; preserve the intent.');
  }
  if ((lines.data ?? []).length !== 1) failClosed('the exact first-line readback is missing or ambiguous.');
  const line = lines.data![0];
  if (line.id !== intent.lineId || line.claim_id !== intent.claimId || line.org_id !== intent.orgId
    || line.expense_date !== intent.firstLine.expenseDate || line.expense_type !== intent.firstLine.expenseType
    || line.description !== intent.firstLine.description || Number(line.amount) !== intent.firstLine.amount) {
    failClosed('first-line readback does not match the exact source intent; preserve it.');
  }

  const signEvent = events.find((event) => event.kind === 'signed_upload_intent');
  const metadataEvent = events.find((event) => event.kind === 'receipt_metadata_intent');
  const receiptRows = receipts.data ?? [];
  if (!signEvent) {
    if (receiptRows.length !== 0) failClosed('unexpected receipt metadata is present; preserve the run.');
    return claim.currency;
  }
  if (typeof signEvent.fileId !== 'string' || typeof signEvent.filePath !== 'string'
    || receiptRows.length > 1) failClosed('receipt intent is incomplete or ambiguous; preserve the run.');
  const receipt = receiptRows[0];
  if (receipt && (receipt.id !== signEvent.fileId || receipt.claim_id !== intent.claimId
    || receipt.org_id !== intent.orgId || receipt.file_path !== signEvent.filePath
    || receipt.title !== null || receipt.uploaded_by_id !== intent.claimantId || receipt.archived_at !== null)) {
    failClosed('receipt metadata readback does not match the exact owned intent; preserve it.');
  }
  if (receipt && (!metadataEvent || metadataEvent.id !== receipt.id || metadataEvent.filePath !== receipt.file_path)) {
    failClosed('receipt metadata exists without its durable write intent; preserve it.');
  }
  const objectExists = await readExactStorageObject(signEvent.filePath);
  if (objectExists && !events.some((event) => event.kind === 'storage_put_intent' && event.filePath === signEvent.filePath)) {
    failClosed('receipt storage exists without its durable write intent; preserve it.');
  }
  return claim.currency;
}

async function cleanupOwnedRun(): Promise<void> {
  if (!admin || !intentPath) return;
  const events = await readIntent();
  const intentEvent = events[0];
  if (!intentEvent || intentEvent.kind !== 'claim_rpc_intent') failClosed('ownership record is missing or malformed; preserve it.');
  const intent = intentEvent as unknown as OwnershipIntent;
  await verifyOwnedRows(intent, events);
  const { data: claim, error } = await admin.from('expense_claims').select('id')
    .eq('id', intent.claimId).eq('org_id', intent.orgId).eq('claimant_id', intent.claimantId)
    .eq('status', 'Draft').eq('title', intent.title).maybeSingle();
  if (error) failClosed('exact cleanup claim verification failed; preserve the intent.');
  if (claim) {
    const signEvent = events.find((event) => event.kind === 'signed_upload_intent');
    if (signEvent && typeof signEvent.filePath === 'string' && await readExactStorageObject(signEvent.filePath)) {
      const { error: storageError } = await admin.storage.from(RECEIPT_BUCKET).remove([signEvent.filePath]);
      if (storageError || await readExactStorageObject(signEvent.filePath)) failClosed('exact owned receipt object cleanup did not reconcile; preserve the intent.');
    }
    const { data: deleted, error: deleteError } = await admin.from('expense_claims').delete()
      .eq('id', intent.claimId).eq('org_id', intent.orgId).eq('claimant_id', intent.claimantId)
      .eq('status', 'Draft').eq('title', intent.title).select('id').maybeSingle();
    if (deleteError || deleted?.id !== intent.claimId) failClosed('exact owned Draft cleanup did not reconcile; preserve the intent.');
  }
  await verifyOwnedRows(intent, events);
  await rm(intentPath, { force: false });
  await rmdir(intentDirectory);
  intentPath = '';
  intentDirectory = '';
}

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-S29-005 needs the local service-role fixture; run through scripts/e2e-local.sh');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  captureTag = randomUUID();
  ownership = undefined;
  forwardedWrites.clear();
});

test.afterEach(async () => {
  try {
    await cleanupOwnedRun();
  } finally {
    admin = undefined;
    captureTag = '';
    ownership = undefined;
    forwardedWrites.clear();
  }
});

test('AC-S29-005 a claimant saves a receipt and first expense together as one Draft', async ({ page }, testInfo) => {
  const receiptName = `receipt-${captureTag}.pdf`;
  const lineDescription = `Taxi to project ${captureTag}`;
  const savedTitle = `Reviewed ${captureTag}`;

  await signIn(page, 'engineer@acme.test');
  await installWriteCustody(page, { title: savedTitle, description: lineDescription, receiptName });
  await page.goto('/expenses');
  await page.getByRole('button', { name: 'New claim' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Choose a receipt file').setInputFiles({
    name: receiptName,
    mimeType: 'application/pdf',
    buffer: PDF_BYTES,
  });
  await expect(form.getByLabel(/Title/)).toHaveValue(`receipt-${captureTag}`);
  await form.getByLabel('Description').fill(lineDescription);
  await expect(form.getByLabel(/Title/)).toHaveValue(lineDescription);
  await form.getByLabel(/Title/).fill(savedTitle);
  await form.getByLabel(/^Type/).selectOption('Travel');
  await form.getByLabel(/^Date/).fill(EXPECTED_DATE);
  await form.getByLabel(/^Amount/).fill(String(EXPECTED_AMOUNT));
  await form.getByRole('button', { name: 'Create' }).click();

  await expect(page).toHaveURL(/\/expenses\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: savedTitle })).toBeVisible();
  await expect(page.getByTestId('expense-status')).toHaveAttribute('data-status', 'Draft');
  await expect(page.getByRole('row', { name: new RegExp(lineDescription) })).toBeVisible();
  await expect(page.getByText(receiptName, { exact: true })).toBeVisible();

  if (!ownership || !intentPath) failClosed('the real create request did not produce its durable ownership intent.');
  const currency = await verifyOwnedRows(ownership, await readIntent());
  if (!currency) failClosed('the saved claim is missing after the real create flow.');
  const formattedTotal = await page.evaluate(({ amount, currencyCode, locale }) => new Intl.NumberFormat(locale, {
    style: 'currency', currency: currencyCode, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amount), {
    amount: EXPECTED_AMOUNT,
    currencyCode: currency,
    locale: ownership.numberLocale || 'en-US',
  });
  await expect(page.getByTestId('lines-total')).toHaveText(formattedTotal);

  await testInfo.attach('ac-s29-saved-draft-detail.png', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
  await waitForFonts(page);
  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
  }));
  await testInfo.attach('ac-s29-saved-draft-layout.json', {
    body: JSON.stringify(layout),
    contentType: 'application/json',
  });
});
