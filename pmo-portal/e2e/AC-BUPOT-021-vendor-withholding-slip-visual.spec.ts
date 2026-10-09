// @e2e-isolation: self-isolated — creates one uniquely named vendor/case/bill/slip and cleans up only those rows.
/**
 * AC-BUPOT-021 — rendered bukti potong cell, capture form and detail at mobile/desktop and en/id.
 * Goal oracle: each real surface remains usable, accessible and inside the viewport at the tested sizes.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createClient } from '@supabase/supabase-js';
import { login, requireServiceRoleKey, waitForFonts } from './helpers';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const serviceKey = requireServiceRoleKey();
test.skip(!serviceKey, 'AC-BUPOT-021 requires service-role access for isolated fixture setup and cleanup.');
test.setTimeout(120_000);
const id = { vendor: crypto.randomUUID(), procurement: crypto.randomUUID(), invoice: crypto.randomUUID() };
const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const candidateInvoices = Array.from({ length: 15 }, (_, index) => ({
  id: crypto.randomUUID(), vi_number: `BUPOT-VIS-CANDIDATE-${suffix}-${index + 1}`,
}));
const viNumber = `BUPOT-VIS-${suffix}`;
const slipNumber = `BUPOT-VIS-SLIP-${suffix}`;

async function assertRendered(page: import('@playwright/test').Page, width: number) {
  await waitForFonts(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `page overflow at ${width}px`).toBeLessThanOrEqual(0);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const violations = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(violations, 'serious/critical axe violations').toEqual([]);
}

async function openDocuments(page: import('@playwright/test').Page, width: number, search = '') {
  await page.setViewportSize({ width, height: 900 });
  await page.evaluate(() => localStorage.setItem('theme', 'light'));
  await page.goto(`/procurement/${id.procurement}/documents${search}`);
  await expect(page.getByTestId('procurement-loading')).toBeHidden({ timeout: 20_000 });
  await expect(page.getByTestId('procurement-ledger')).toBeVisible({ timeout: 20_000 });
}

test('AC-BUPOT-021 #961 F18 keeps reconciliation visible above the modal footer on a long candidate list (visual states)', async ({ page }) => {
  const admin = createClient(SUPABASE_URL, serviceKey!);
  const { error: vendorError } = await admin.from('companies').insert({ id: id.vendor, org_id: ORG_ID, name: `BUPOT visual vendor ${suffix}`, type: 'Vendor' });
  if (vendorError) throw new Error(`vendor fixture failed: ${vendorError.message}`);
  const { error: caseError } = await admin.from('procurements').insert({ id: id.procurement, org_id: ORG_ID, title: `BUPOT visual case ${suffix}`, status: 'Ordered', vendor_id: id.vendor, currency: 'IDR' });
  if (caseError) throw new Error(`case fixture failed: ${caseError.message}`);
  const invoiceDate = new Date().toISOString().slice(0, 10);
  const invoiceFacts = { org_id: ORG_ID, procurement_id: id.procurement, invoice_date: invoiceDate, status: 'Paid' as const, amount: 100000, currency: 'IDR', tax_treatment: 'inclusive', tax_amount: 0, withheld_amount: 20000, withheld_pph_type: 'pph23' };
  const { error: billError } = await admin.from('procurement_invoices').insert([
    { ...invoiceFacts, id: id.invoice, vi_number: viNumber },
    ...candidateInvoices.map((candidate) => ({ ...invoiceFacts, ...candidate })),
  ]);
  if (billError) throw new Error(`bill fixture failed: ${billError.message}`);
  let slipId: string | null = null;
  let activeLocale: 'en' | 'id' = 'en';
  try {
    await page.route('**/rest/v1/profiles?*', async (route) => {
      const response = await route.fetch();
      const profile = await response.json() as Record<string, unknown> | Record<string, unknown>[];
      const localized = Array.isArray(profile)
        ? profile.map((row) => ({ ...row, locale: activeLocale }))
        : { ...profile, locale: activeLocale };
      await route.fulfill({ response, json: localized });
    });
    await login(page, 'finance@acme.test');
    for (const locale of ['en', 'id'] as const) {
      activeLocale = locale;
      for (const width of [360, 1440]) {
        await openDocuments(page, width, slipId ? `?bupot=${encodeURIComponent(slipId)}` : '');
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        const billRow = page.getByTestId('procurement-ledger').locator('tr, li').filter({ hasText: viNumber });
        await expect(billRow).toBeVisible();
        await expect(billRow.getByText(
          slipId
            ? (locale === 'en' ? 'Slipped' : 'Sudah dipotong')
            : (locale === 'en' ? 'Not recorded' : 'Belum dicatat'),
          { exact: true },
        )).toBeVisible({ timeout: 20_000 });
        await assertRendered(page, width);

        if (!slipId) {
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
          await assertRendered(page, width);
          await modal.getByLabel(/Issued slip number|Nomor slip terbit/i).fill(slipNumber);
          await modal.getByLabel(/Tax base|Dasar pengenaan pajak/i).fill('100000');
          await modal.getByLabel(/Issued withheld amount|Jumlah potongan pada slip/i).fill('20000');
          await modal.getByRole('button', { name: /Record bukti potong|Catat bukti potong/i }).click();
          await expect(billRow.getByText(/Slipped|Sudah dipotong/i)).toBeVisible({ timeout: 20_000 });
          await billRow.getByRole('button', { name: /View bukti potong|Lihat bukti potong/i }).click();
          await expect(page.getByLabel(/Bukti potong details|Detail bukti potong/i)).toBeVisible({ timeout: 20_000 });
          const { data, error } = await admin.from('vendor_withholding_slips').select('id').eq('slip_number', slipNumber).single();
          if (error || !data) throw new Error(`visual slip readback failed: ${error?.message}`);
          slipId = data.id as string;
        } else {
          await expect(page.getByLabel(/Bukti potong details|Detail bukti potong/i)).toBeVisible({ timeout: 20_000 });
        }
        const details = page.getByLabel(/Bukti potong details|Detail bukti potong/i);
        await expect(details.getByText(slipNumber)).toBeVisible();
        await expect(details.getByText(viNumber, { exact: true })).toBeVisible();
        const historyLinkLabel = locale === 'en' ? 'Bukti potong bill link' : 'Tautan tagihan bukti potong';
        await expect(details.getByText(new RegExp(`${historyLinkLabel} · ${viNumber}`))).toBeVisible();
        await assertRendered(page, width);
      }
    }
  } finally {
    const { data: slips } = await admin.from('vendor_withholding_slips').select('id').eq('slip_number', slipNumber);
    const slipIds = (slips ?? []).map((slip) => slip.id as string);
    if (slipIds.length) await admin.from('vendor_withholding_slip_bills').delete().in('slip_id', slipIds);
    if (slipIds.length) await admin.from('vendor_withholding_slips').delete().in('id', slipIds);
    await admin.from('procurement_invoices').delete().in('id', [id.invoice, ...candidateInvoices.map((candidate) => candidate.id)]);
    await admin.from('procurements').delete().eq('id', id.procurement);
    await admin.from('companies').delete().eq('id', id.vendor);
  }
});
