// @e2e-isolation: self-isolated — creates one uniquely named vendor/case/bill/slip per case and atomically removes only those rows.
/**
 * AC-BUPOT-021 — rendered bukti potong cell, capture form and details at mobile/desktop and en/id.
 * Goal oracle: each real surface remains usable, accessible and inside the viewport at the tested sizes.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { login, requireServiceRoleKey, waitForFonts } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(process.env.SUPABASE_URL, VITE_ENV.VITE_SUPABASE_URL);
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const serviceKey = requireServiceRoleKey();
test.skip(!serviceKey, 'AC-BUPOT-021 requires service-role access for isolated fixture setup.');
test.setTimeout(120_000);

const lockScript = fileURLToPath(new URL('../../scripts/with-db-lock.sh', import.meta.url));
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Locale = 'en' | 'id';
type CandidateInvoice = { id: string; viNumber: string };
type Fixture = {
  locale: Locale;
  width: number;
  vendorId: string;
  caseId: string;
  invoiceId: string;
  invoiceIds: string[];
  candidateInvoices: CandidateInvoice[];
  viNumber: string;
  slipNumber: string;
  slipId: string;
};

function makeFixture(locale: Locale, width: number, includeCandidates = false): Fixture {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const invoiceId = randomUUID();
  const candidateInvoices = includeCandidates
    ? Array.from({ length: 15 }, (_, index) => ({
      id: randomUUID(),
      viNumber: `BUPOT-VIS-CANDIDATE-${suffix}-${index + 1}`,
    }))
    : [];

  return {
    locale,
    width,
    vendorId: randomUUID(),
    caseId: randomUUID(),
    invoiceId,
    invoiceIds: [invoiceId, ...candidateInvoices.map((candidate) => candidate.id)],
    candidateInvoices,
    viNumber: `BUPOT-VIS-${suffix}`,
    slipNumber: `BUPOT-VIS-SLIP-${suffix}`,
    slipId: randomUUID(),
  };
}

async function seedFixture(admin: SupabaseClient, fixture: Fixture): Promise<void> {
  const { error: vendorError } = await admin.from('companies').insert({
    id: fixture.vendorId,
    org_id: ORG_ID,
    name: `BUPOT visual vendor ${fixture.viNumber}`,
    type: 'Vendor',
  });
  if (vendorError) throw new Error(`vendor fixture failed: ${vendorError.message}`);

  const { error: caseError } = await admin.from('procurements').insert({
    id: fixture.caseId,
    org_id: ORG_ID,
    title: `BUPOT visual case ${fixture.viNumber}`,
    status: 'Ordered',
    vendor_id: fixture.vendorId,
    currency: 'IDR',
  });
  if (caseError) throw new Error(`case fixture failed: ${caseError.message}`);

  const invoiceDate = new Date().toISOString().slice(0, 10);
  const invoiceFacts = {
    org_id: ORG_ID,
    procurement_id: fixture.caseId,
    invoice_date: invoiceDate,
    status: 'Paid' as const,
    amount: 100000,
    currency: 'IDR',
    tax_treatment: 'inclusive',
    tax_amount: 0,
    withheld_amount: 20000,
    withheld_pph_type: 'pph23',
  };
  const { error: invoiceError } = await admin.from('procurement_invoices').insert([
    { ...invoiceFacts, id: fixture.invoiceId, vi_number: fixture.viNumber },
    ...fixture.candidateInvoices.map((candidate) => ({
      ...invoiceFacts,
      id: candidate.id,
      vi_number: candidate.viNumber,
    })),
  ]);
  if (invoiceError) throw new Error(`bill fixture failed: ${invoiceError.message}`);
}

function cleanupFixture(fixture: Fixture): void {
  const ids = [ORG_ID, fixture.vendorId, fixture.caseId, ...fixture.invoiceIds, fixture.slipId];
  if (ids.some((id) => !UUID_PATTERN.test(id))) {
    throw new Error('BUPOT cleanup refused a non-UUID fixture parameter');
  }

  const dockerArgs = [
    'exec', '-i', 'supabase_db_pmo-portal', 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-v', 'ON_ERROR_STOP=1',
    '-v', `org_id=${ORG_ID}`,
    '-v', `vendor_id=${fixture.vendorId}`,
    '-v', `case_id=${fixture.caseId}`,
    '-v', `invoice_ids={${fixture.invoiceIds.join(',')}}`,
    '-v', `slip_ids={${fixture.slipId}}`,
    '-A', '-t', '-q', '-F', '|',
  ];
  const sql = `
BEGIN;
DELETE FROM public.vendor_withholding_slip_bills
 WHERE org_id = :'org_id'::uuid
   AND (
     invoice_id = ANY(:'invoice_ids'::uuid[])
     OR slip_id = ANY(:'slip_ids'::uuid[])
     OR slip_id IN (
       SELECT id FROM public.vendor_withholding_slips
        WHERE org_id = :'org_id'::uuid AND vendor_id = :'vendor_id'::uuid
     )
   );
DELETE FROM public.vendor_withholding_slips
 WHERE org_id = :'org_id'::uuid AND vendor_id = :'vendor_id'::uuid;
DELETE FROM public.procurement_invoices
 WHERE org_id = :'org_id'::uuid AND id = ANY(:'invoice_ids'::uuid[]);
DELETE FROM public.procurements
 WHERE org_id = :'org_id'::uuid AND id = :'case_id'::uuid;
DELETE FROM public.companies
 WHERE org_id = :'org_id'::uuid AND id = :'vendor_id'::uuid AND type = 'Vendor';
COMMIT;
SELECT
  (SELECT count(*)::text FROM public.vendor_withholding_slip_bills
    WHERE org_id = :'org_id'::uuid
      AND (invoice_id = ANY(:'invoice_ids'::uuid[]) OR slip_id = ANY(:'slip_ids'::uuid[])))
  || '|' || (SELECT count(*)::text FROM public.vendor_withholding_slips
    WHERE org_id = :'org_id'::uuid AND vendor_id = :'vendor_id'::uuid)
  || '|' || (SELECT count(*)::text FROM public.procurement_invoices
    WHERE org_id = :'org_id'::uuid AND id = ANY(:'invoice_ids'::uuid[]))
  || '|' || (SELECT count(*)::text FROM public.procurements
    WHERE org_id = :'org_id'::uuid AND id = :'case_id'::uuid)
  || '|' || (SELECT count(*)::text FROM public.companies
    WHERE org_id = :'org_id'::uuid AND id = :'vendor_id'::uuid AND type = 'Vendor');
`;
  const held = process.env.PMO_DB_LOCK_HELD === '1';
  const output = execFileSync(
    held ? 'docker' : lockScript,
    held ? dockerArgs : ['docker', ...dockerArgs],
    { input: sql, encoding: 'utf8' },
  ).trim();
  if (output !== '0|0|0|0|0') {
    throw new Error(`BUPOT cleanup did not prove zero owned rows: ${output}`);
  }
  console.info('BUPOT atomic cleanup verified: links=0, slips=0, invoices=0, cases=0, vendors=0');
}

async function runWithFixture(
  page: Page,
  fixture: Fixture,
  journey: (admin: SupabaseClient) => Promise<void>,
): Promise<void> {
  const admin = createClient(SUPABASE_URL, serviceKey!, { auth: { persistSession: false } });
  let journeyError: unknown;
  let journeyFailed = false;
  try {
    await seedFixture(admin, fixture);
    await journey(admin);
  } catch (error) {
    journeyFailed = true;
    journeyError = error;
  }

  let cleanupError: unknown;
  let cleanupFailed = false;
  try {
    cleanupFixture(fixture);
  } catch (error) {
    cleanupFailed = true;
    cleanupError = error;
  }

  if (journeyFailed && cleanupFailed) {
    throw new AggregateError([journeyError, cleanupError], 'BUPOT journey and fixture cleanup both failed');
  }
  if (journeyFailed) throw journeyError;
  if (cleanupFailed) throw cleanupError;
}

async function installLocaleOverride(page: Page, locale: Locale): Promise<void> {
  await page.route('**/rest/v1/profiles?*', async (route) => {
    const response = await route.fetch();
    const profile = await response.json() as Record<string, unknown> | Record<string, unknown>[];
    const localized = Array.isArray(profile)
      ? profile.map((row) => ({ ...row, locale }))
      : { ...profile, locale };
    await route.fulfill({ response, json: localized });
  });
}

async function openDocuments(page: Page, fixture: Fixture, withDetails: boolean): Promise<void> {
  await page.setViewportSize({ width: fixture.width, height: 900 });
  await page.evaluate(() => localStorage.setItem('theme', 'light'));
  const search = withDetails ? `?bupot=${encodeURIComponent(fixture.slipId)}` : '';
  await page.goto(`/procurement/${fixture.caseId}/documents${search}`);
  await expect(page.getByTestId('procurement-loading')).toBeHidden({ timeout: 20_000 });
  await expect(page.getByTestId('procurement-ledger')).toBeVisible({ timeout: 20_000 });
}

async function assertRendered(page: Page, width: number): Promise<void> {
  await waitForFonts(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `page overflow at ${width}px`).toBeLessThanOrEqual(0);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(violations, 'serious/critical axe violations').toEqual([]);
}

async function assertLedger(
  page: Page,
  fixture: Fixture,
  status: 'Not recorded' | 'Slipped' | 'Belum dicatat' | 'Sudah dipotong',
): Promise<import('@playwright/test').Locator> {
  await expect(page.locator('html')).toHaveAttribute('lang', fixture.locale);
  const billRow = page.getByTestId('procurement-ledger').locator('tr, li').filter({ hasText: fixture.viNumber });
  await expect(billRow).toBeVisible();
  await expect(billRow.getByText(status, { exact: true })).toBeVisible({ timeout: 20_000 });
  await assertRendered(page, fixture.width);
  return billRow;
}

async function recordCompletedSlipAsFinance(page: Page, fixture: Fixture): Promise<void> {
  if (!ANON_KEY) throw new Error('BUPOT authenticated RPC setup requires the local public anon key');
  const args = {
    p_slip_id: fixture.slipId,
    p_vendor_id: fixture.vendorId,
    p_slip_number: fixture.slipNumber,
    p_slip_date: '2026-01-15',
    p_tax_period: '2026-01-01',
    p_pph_type: 'pph23',
    p_tax_base: 100000,
    p_withheld_amount: 20000,
    p_invoice_ids: [fixture.invoiceId],
    p_declared_invoice_ids: [],
  };
  const response = await page.evaluate(async ({ supabaseUrl, anonKey, rpcArgs }) => {
    let accessToken: string | null = null;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith('sb-') || !key.endsWith('-auth-token')) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as { access_token?: string };
        if (parsed.access_token) {
          accessToken = parsed.access_token;
          break;
        }
      } catch {
        // Ignore unrelated Supabase localStorage entries.
      }
    }
    if (!accessToken) throw new Error('Finance session is missing its active Supabase access token');

    const result = await fetch(`${supabaseUrl}/rest/v1/rpc/record_vendor_withholding_slip`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(rpcArgs),
    });
    return { status: result.status, ok: result.ok, body: await result.text() };
  }, { supabaseUrl: SUPABASE_URL, anonKey: ANON_KEY, rpcArgs: args });

  if (!response.ok) {
    throw new Error(`authenticated withholding-slip RPC failed (HTTP ${response.status}): ${response.body}`);
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(response.body) as unknown;
  } catch {
    throw new Error(`authenticated withholding-slip RPC returned invalid JSON (HTTP ${response.status})`);
  }
  const row = (Array.isArray(decoded) ? decoded[0] : decoded) as { slip_id?: unknown; revision?: unknown } | undefined;
  expect(row?.slip_id).toBe(fixture.slipId);
  expect(row?.revision).toBe(1);
}

async function assertDetails(page: Page, fixture: Fixture): Promise<void> {
  const details = page.getByLabel(/Bukti potong details|Detail bukti potong/i);
  await expect(details).toBeVisible({ timeout: 20_000 });
  await expect(details.getByText(fixture.slipNumber)).toBeVisible();
  await expect(details.getByText(
    fixture.locale === 'en' ? `System VI number: ${fixture.viNumber}` : `Nomor VI sistem: ${fixture.viNumber}`,
    { exact: true },
  )).toBeVisible();
  const historyLinkLabel = fixture.locale === 'en' ? 'Bukti potong bill link' : 'Tautan tagihan bukti potong';
  await expect(details.getByText(new RegExp(`${historyLinkLabel} · ${fixture.viNumber}`))).toBeVisible();
  await assertRendered(page, fixture.width);
}

const detailCases = [
  { locale: 'en', width: 360, capture: true, title: 'AC-BUPOT-021 en 360px captures a long-list slip and reads its details' },
  { locale: 'en', width: 1440, capture: false, title: 'AC-BUPOT-021 en 1440px renders a recorded ledger and details' },
  { locale: 'id', width: 360, capture: false, title: 'AC-BUPOT-021 id 360px renders a recorded ledger and details' },
  { locale: 'id', width: 1440, capture: false, title: 'AC-BUPOT-021 id 1440px renders a recorded ledger and details' },
] as const;

for (const scenario of detailCases) {
  test(scenario.title, async ({ page }) => {
    const fixture = makeFixture(scenario.locale, scenario.width, scenario.capture);
    await runWithFixture(page, fixture, async (admin) => {
      await installLocaleOverride(page, fixture.locale);
      await login(page, 'finance@acme.test');

      if (!scenario.capture) {
        await recordCompletedSlipAsFinance(page, fixture);
      }
      await openDocuments(page, fixture, !scenario.capture);
      const status = scenario.capture
        ? 'Not recorded'
        : fixture.locale === 'en' ? 'Slipped' : 'Sudah dipotong';
      const billRow = await assertLedger(page, fixture, status);

      if (scenario.capture) {
        await billRow.getByRole('button', { name: /Record bukti potong|Catat bukti potong/i }).click();
        const modal = page.getByRole('dialog');
        await expect(modal).toBeVisible();
        await expect(modal.getByLabel(/Issued slip number|Nomor slip terbit/i)).toBeVisible();
        const body = modal.locator('form > div.overflow-y-auto');
        const reconciliation = modal.getByText(/Selection .* · Slip .* · Difference/);
        await expect(body).toBeVisible();
        await expect(reconciliation).toBeVisible();
        expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
        await body.evaluate((element) => {
          element.scrollTop = Math.floor((element.scrollHeight - element.clientHeight) / 2);
        });
        const scrollPosition = await body.evaluate((element) => element.scrollTop);
        expect(scrollPosition).toBeGreaterThan(0);
        expect(scrollPosition).toBeLessThan(await body.evaluate((element) => element.scrollHeight - element.clientHeight));
        await expect(reconciliation).toBeInViewport();
        const summaryBox = await reconciliation.boundingBox();
        const footerBox = await modal.locator('form > div.border-t').boundingBox();
        expect(summaryBox).not.toBeNull();
        expect(footerBox).not.toBeNull();
        expect(summaryBox!.y + summaryBox!.height).toBeLessThanOrEqual(footerBox!.y);
        await assertRendered(page, fixture.width);
        await modal.getByLabel(/Issued slip number|Nomor slip terbit/i).fill(fixture.slipNumber);
        await modal.getByLabel(/Tax base|Dasar pengenaan pajak/i).fill('100000');
        await modal.getByLabel(/Issued withheld amount|Jumlah potongan pada slip/i).fill('20000');
        await modal.getByRole('button', { name: /Record bukti potong|Catat bukti potong/i }).click();
        await expect(billRow.getByText(/Slipped|Sudah dipotong/i)).toBeVisible({ timeout: 20_000 });
        await billRow.getByRole('button', { name: /View bukti potong|Lihat bukti potong/i }).click();
        await expect(page.getByLabel(/Bukti potong details|Detail bukti potong/i)).toBeVisible({ timeout: 20_000 });
        const { data, error } = await admin
          .from('vendor_withholding_slips')
          .select('id')
          .eq('slip_number', fixture.slipNumber)
          .eq('org_id', ORG_ID)
          .single();
        if (error || !data) throw new Error(`visual slip readback failed: ${error?.message}`);
        fixture.slipId = data.id as string;
      }

      await assertDetails(page, fixture);
    });
  });
}
