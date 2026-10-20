// @e2e-isolation: self-isolated — creates uniquely identified vendor, two cases, bills and slip; removes only its own rows.
/**
 * AC-BUPOT-020 — Finance records one issued slip across two cases, corrects it, then voids it.
 * Goal oracle: both source bills show the same persisted coverage, then both return to uncovered;
 * the issued facts and released link evidence remain, while bill money/status and outbox are unchanged.
 * AC-EH-006: journey and cleanup failures are reported together.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/supabase/database.types';
import { login, requireServiceRoleKey } from './helpers';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const serviceKey = requireServiceRoleKey();
const localized = (en: string, id: string) => new RegExp(`(?:${en}|${id})`, 'i');
const localizedExact = (en: string, id: string) => new RegExp(`^(?:${en}|${id})$`, 'i');
test.skip(!serviceKey, 'AC-BUPOT-020 requires service-role access for isolated fixture setup and cleanup.');
test.setTimeout(120_000);

const ids = { vendor: crypto.randomUUID(), caseA: crypto.randomUUID(), caseB: crypto.randomUUID(), billA: crypto.randomUUID(), billB: crypto.randomUUID() };
const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const viA = `BUPOT-A-${suffix}`;
const viB = `BUPOT-B-${suffix}`;
const slipNumber = `BUPOT-${suffix}`;
const lockScript = fileURLToPath(new URL('../../scripts/with-db-lock.sh', import.meta.url));
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function seed(admin: ReturnType<typeof createClient<Database>>) {
  const { error: vendorError } = await admin.from('companies').insert({ id: ids.vendor, org_id: ORG_ID, name: `BUPOT vendor ${suffix}`, type: 'Vendor' });
  if (vendorError) throw new Error(`vendor fixture failed: ${vendorError.message}`);
  const cases = [
    { id: ids.caseA, org_id: ORG_ID, title: `BUPOT case A ${suffix}`, status: 'Ordered' as const, vendor_id: ids.vendor, currency: 'IDR' },
    { id: ids.caseB, org_id: ORG_ID, title: `BUPOT case B ${suffix}`, status: 'Ordered' as const, vendor_id: ids.vendor, currency: 'IDR' },
  ];
  const { error: caseError } = await admin.from('procurements').insert(cases);
  if (caseError) throw new Error(`case fixtures failed: ${caseError.message}`);
  const bills = [
    { id: ids.billA, org_id: ORG_ID, procurement_id: ids.caseA, vi_number: viA, invoice_date: new Date().toISOString().slice(0, 10), status: 'Paid' as const, amount: 100000, currency: 'IDR', tax_treatment: 'inclusive', tax_amount: 0, withheld_amount: 20000, withheld_pph_type: 'pph23' },
    { id: ids.billB, org_id: ORG_ID, procurement_id: ids.caseB, vi_number: viB, invoice_date: new Date().toISOString().slice(0, 10), status: 'Paid' as const, amount: 150000, currency: 'IDR', tax_treatment: 'inclusive', tax_amount: 0, withheld_amount: 30000, withheld_pph_type: 'pph23' },
  ];
  const { error: billError } = await admin.from('procurement_invoices').insert(bills);
  if (billError) throw new Error(`bill fixtures failed: ${billError.message}`);
}

function cleanupFixture(): void {
  const invoiceIds = [ids.billA, ids.billB];
  const ownedIds = [ORG_ID, ids.vendor, ids.caseA, ids.caseB, ...invoiceIds];
  if (ownedIds.some((id) => !UUID_PATTERN.test(id))) {
    throw new Error('BUPOT cleanup refused a non-UUID fixture parameter');
  }

  const dockerArgs = [
    'exec', '-i', 'supabase_db_pmo-portal', 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-v', 'ON_ERROR_STOP=1',
    '-v', `org_id=${ORG_ID}`,
    '-v', `vendor_id=${ids.vendor}`,
    '-v', `case_ids={${ids.caseA},${ids.caseB}}`,
    '-v', `invoice_ids={${invoiceIds.join(',')}}`,
    '-A', '-t', '-q', '-F', '|',
  ];
  const sql = `
BEGIN;
CREATE TEMP TABLE owned_bupot_slips AS
 SELECT id FROM public.vendor_withholding_slips
  WHERE org_id = :'org_id'::uuid AND vendor_id = :'vendor_id'::uuid;
DELETE FROM public.vendor_withholding_slip_bills
 WHERE org_id = :'org_id'::uuid
   AND (
     invoice_id = ANY(:'invoice_ids'::uuid[])
     OR slip_id IN (
       SELECT id FROM owned_bupot_slips
     )
   );
DELETE FROM public.vendor_withholding_slips
 WHERE org_id = :'org_id'::uuid AND vendor_id = :'vendor_id'::uuid;
DELETE FROM public.procurement_invoices
 WHERE org_id = :'org_id'::uuid AND id = ANY(:'invoice_ids'::uuid[]);
DELETE FROM public.procurements
 WHERE org_id = :'org_id'::uuid AND id = ANY(:'case_ids'::uuid[]);
DELETE FROM public.companies
 WHERE org_id = :'org_id'::uuid AND id = :'vendor_id'::uuid AND type = 'Vendor';
COMMIT;
SELECT
  (SELECT count(*)::text FROM public.vendor_withholding_slip_bills
    WHERE org_id = :'org_id'::uuid
      AND (invoice_id = ANY(:'invoice_ids'::uuid[]) OR slip_id IN (
        SELECT id FROM owned_bupot_slips
      )))
  || '|' || (SELECT count(*)::text FROM public.vendor_withholding_slips
    WHERE org_id = :'org_id'::uuid AND vendor_id = :'vendor_id'::uuid)
  || '|' || (SELECT count(*)::text FROM public.procurement_invoices
    WHERE org_id = :'org_id'::uuid AND id = ANY(:'invoice_ids'::uuid[]))
  || '|' || (SELECT count(*)::text FROM public.procurements
    WHERE org_id = :'org_id'::uuid AND id = ANY(:'case_ids'::uuid[]))
  || '|' || (SELECT count(*)::text FROM public.companies
    WHERE org_id = :'org_id'::uuid AND id = :'vendor_id'::uuid AND type = 'Vendor');
`;
  const held = process.env.PMO_DB_LOCK_HELD === '1';
  const output = execFileSync(
    held ? 'docker' : lockScript,
    held ? dockerArgs : ['docker', ...dockerArgs],
    { input: sql, encoding: 'utf8' },
  ).trim();
  if (output !== '0|0|0|0|0') throw new Error(`BUPOT cleanup did not prove zero owned rows: ${output}`);
  console.info('BUPOT atomic cleanup verified: links=0, slips=0, invoices=0, cases=0, vendors=0');
}

async function openDocuments(page: import('@playwright/test').Page, caseId: string) {
  await page.goto(`/procurement/${caseId}/documents`);
  await expect(page.getByTestId('procurement-loading')).toBeHidden({ timeout: 20_000 });
  await expect(page.getByTestId('procurement-ledger')).toBeVisible({ timeout: 20_000 });
}

test('AC-BUPOT-020 #961 open-case-scroll opens, scrolls, and focuses the linked bill in its destination case (record/correct/void journey)', async ({ page }) => {
  const admin = createClient<Database>(SUPABASE_URL, serviceKey!);
  let journeyError: unknown;
  let journeyFailed = false;
  let cleanupError: unknown;
  let cleanupFailed = false;
  const { count: outboxBefore, error: outboxBeforeError } = await admin.from('external_command_outbox').select('id', { count: 'exact', head: true }).eq('org_id', ORG_ID);
  if (outboxBeforeError) throw new Error(`outbox baseline read failed: ${outboxBeforeError.message}`);
  try {
    await seed(admin);
    await login(page, 'finance@acme.test');
    await openDocuments(page, ids.caseA);
    const rowA = page.locator('tr').filter({ hasText: viA });
    await expect(rowA).toBeVisible();
    await expect(rowA.getByText(localizedExact('Not recorded', 'Belum dicatat'))).toBeVisible({ timeout: 20_000 });
    await rowA.getByRole('button', { name: localized('Record bukti potong', 'Catat bukti potong') }).click();

    const capture = page.getByRole('dialog');
    await expect(capture).toBeVisible();
    await capture.getByLabel(localized('Issued slip number', 'Nomor slip terbit')).fill(slipNumber);
    await capture.getByLabel(localized('Tax base', 'Dasar pengenaan pajak')).fill('100000');
    await capture.getByLabel(localized('Issued withheld amount', 'Jumlah potongan pada slip')).fill('50000');
    await expect(capture.getByText(/(?:Selected total|Total pilihan):.*20[.,]000/i)).toBeVisible();
    const secondBill = capture.getByLabel(new RegExp(`(?:Select bill|Pilih tagihan) .*${viB}`, 'i'));
    await expect(secondBill).toBeVisible({ timeout: 20_000 });
    await secondBill.check();
    await expect(capture.getByText(/(?:Selection|Pilihan).*50[.,]000/i)).toBeVisible();
    await capture.getByRole('button', { name: localized('Record bukti potong', 'Catat bukti potong') }).click();
    await expect(rowA.getByText(localizedExact('Slipped', 'Sudah dipotong'))).toBeVisible({ timeout: 20_000 });
    await rowA.getByRole('button', { name: localized('View bukti potong', 'Lihat bukti potong') }).click();

    await expect(page.getByLabel(localized('Bukti potong details', 'Detail bukti potong'))).toBeVisible({ timeout: 20_000 });
    const details = page.getByLabel(localized('Bukti potong details', 'Detail bukti potong'));
    await expect(details.getByText(slipNumber)).toBeVisible();
    await expect(details.getByText(localizedExact(`System VI number: ${viA}`, `Nomor VI sistem: ${viA}`))).toBeVisible();
    await expect(details.getByText(localizedExact(`System VI number: ${viB}`, `Nomor VI sistem: ${viB}`))).toBeVisible();
    await expect(details.getByText(localizedExact(`Bukti potong bill link · ${viA}`, `Tautan tagihan bukti potong · ${viA}`))).toBeVisible();
    await expect(details.getByText(localizedExact(`Bukti potong bill link · ${viB}`, `Tautan tagihan bukti potong · ${viB}`))).toBeVisible();
    const { data: recorded, error: recordedError } = await admin.from('vendor_withholding_slips').select('id,slip_number,withheld_amount,revision,status').eq('slip_number', slipNumber).single();
    if (recordedError || !recorded) throw new Error(`recorded slip readback failed: ${recordedError?.message}`);
    expect(recorded).toMatchObject({ slip_number: slipNumber, withheld_amount: 50000, revision: 1, status: 'active' });
    const slipId = recorded.id as string;
    const { data: recordedLinks, error: linksError } = await admin.from('vendor_withholding_slip_bills').select('invoice_id,withheld_at_record,released_at').eq('slip_id', slipId).order('invoice_id');
    if (linksError) throw new Error(`recorded link readback failed: ${linksError.message}`);
    expect(recordedLinks).toHaveLength(2);
    expect(recordedLinks?.map((link) => link.invoice_id).sort()).toEqual([ids.billA, ids.billB].sort());

    await page.getByRole('button', { name: localized('Correct metadata', 'Koreksi metadata') }).click();
    const correction = page.getByRole('dialog');
    const correctedDate = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await correction.getByLabel(localized('Slip date', 'Tanggal slip')).fill(correctedDate);
    await correction.getByLabel(localized('Correction reason', 'Alasan koreksi')).fill('Corrected to match issued document');
    await correction.getByRole('button', { name: localized('Save changes', 'Simpan perubahan') }).click();
    await expect(correction).toBeHidden({ timeout: 15_000 });
    const { data: corrected, error: correctedError } = await admin.from('vendor_withholding_slips').select('slip_date,revision').eq('id', slipId).single();
    if (correctedError || !corrected) throw new Error(`corrected slip readback failed: ${correctedError?.message}`);
    expect(corrected).toEqual({ slip_date: correctedDate, revision: 2 });

    await page.getByRole('button', { name: localized('Void PMO entry', 'Batalkan catatan PMO') }).click();
    const confirmation = page.getByRole('alertdialog');
    await expect(confirmation.getByText(/(?:does not cancel a DJP document|tidak membatalkan dokumen DJP)/i)).toBeVisible();
    await confirmation.getByLabel(localized('Reason', 'Alasan')).fill('Duplicate PMO evidence entry');
    await confirmation.getByRole('button', { name: localized('Void PMO entry', 'Batalkan catatan PMO') }).click();
    await expect(page.getByText(localized('Voided in PMO', 'Dibatalkan di PMO')).first()).toBeVisible({ timeout: 15_000 });

    await expect.poll(async () => (await admin.from('vendor_withholding_slips').select('status').eq('id', slipId).single()).data?.status, { timeout: 15_000 }).toBe('void');
    const { data: voidedHeader, error: voidedHeaderError } = await admin.from('vendor_withholding_slips').select('status,void_reason').eq('id', slipId).single();
    if (voidedHeaderError || !voidedHeader) throw new Error(`voided slip readback failed: ${voidedHeaderError?.message}`);
    expect(voidedHeader).toEqual({ status: 'void', void_reason: 'Duplicate PMO evidence entry' });
    const { data: voidedLinks, error: voidLinksError } = await admin.from('vendor_withholding_slip_bills').select('invoice_id,released_at').eq('slip_id', slipId);
    if (voidLinksError) throw new Error(`void link readback failed: ${voidLinksError.message}`);
    expect(voidedLinks).toHaveLength(2);
    expect(voidedLinks?.every((link) => link.released_at !== null)).toBe(true);
    const { data: billsAfter, error: billsError } = await admin.from('procurement_invoices').select('id,amount,withheld_amount,status').in('id', [ids.billA, ids.billB]);
    if (billsError) throw new Error(`bill readback failed: ${billsError.message}`);
    expect(billsAfter).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ids.billA, amount: 100000, withheld_amount: 20000, status: 'Paid' }),
      expect.objectContaining({ id: ids.billB, amount: 150000, withheld_amount: 30000, status: 'Paid' }),
    ]));
    const { count: outboxAfter, error: outboxAfterError } = await admin.from('external_command_outbox').select('id', { count: 'exact', head: true }).eq('org_id', ORG_ID);
    if (outboxAfterError) throw new Error(`outbox readback failed: ${outboxAfterError.message}`);
    expect(outboxAfter).toBe(outboxBefore);

    await openDocuments(page, ids.caseA);
    await expect(page.locator('tr').filter({ hasText: viA }).getByText(localizedExact('Not recorded', 'Belum dicatat'))).toBeVisible({ timeout: 20_000 });
    await openDocuments(page, ids.caseB);
    await expect(page.locator('tr').filter({ hasText: viB }).getByText(localizedExact('Not recorded', 'Belum dicatat'))).toBeVisible({ timeout: 20_000 });
    await page.goto(`/procurement/${ids.caseA}/documents?bupot=${encodeURIComponent(slipId)}`);
    await expect(page.getByLabel(localized('Bukti potong details', 'Detail bukti potong'))).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel(localized('Bukti potong details', 'Detail bukti potong')).getByText(slipNumber)).toBeVisible();
    await expect(page.getByLabel(localized('Bukti potong details', 'Detail bukti potong')).getByText(localized('Voided in PMO', 'Dibatalkan di PMO'))).toHaveCount(2);

    const retainedDetails = page.getByLabel(localized('Bukti potong details', 'Detail bukti potong'));
    await retainedDetails.getByRole('button', { name: new RegExp(`(?:Open bill .*${viB}.* in case BUPOT case B ${suffix}|Buka tagihan .*${viB}.* di kasus BUPOT case B ${suffix})`, 'i') }).click();
    await expect(page).toHaveURL(new RegExp(`/procurement/${ids.caseB}/documents\\?bupot=${slipId}&bupotBill=${ids.billB}`));
    const destinationRow = page.locator(`#invoice-${ids.billB}`);
    await expect(destinationRow).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => destinationRow.evaluate((row) => row === document.activeElement), { timeout: 10_000 }).toBe(true);
  } catch (error) {
    journeyError = error;
    journeyFailed = true;
  }

  try {
    cleanupFixture();
  } catch (error) {
    cleanupError = error;
    cleanupFailed = true;
  }

  if (journeyFailed && cleanupFailed) {
    throw new AggregateError([journeyError, cleanupError], 'BUPOT journey and fixture cleanup both failed');
  }
  if (journeyFailed) throw journeyError;
  if (cleanupFailed) throw cleanupError;
});
