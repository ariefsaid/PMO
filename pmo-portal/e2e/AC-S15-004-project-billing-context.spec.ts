// @e2e-isolation: self-isolated — creates a unique local client, project, and issued work order; deletes only rows linked to this run in finally.
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { requireServiceRoleKey, signIn, waitForFonts } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const localized = (en: string, id: string) => new RegExp('(?:' + en + '|' + id + ')', 'i');
type DiscoverLocale = 'en' | 'id';
type DiscoverTheme = 'light' | 'dark';
const discoverModes = [
  { width: 390, height: 844, locale: 'en', theme: 'light' },
  { width: 390, height: 844, locale: 'en', theme: 'dark' },
  { width: 390, height: 844, locale: 'id', theme: 'light' },
  { width: 390, height: 844, locale: 'id', theme: 'dark' },
  { width: 1440, height: 900, locale: 'en', theme: 'light' },
  { width: 1440, height: 900, locale: 'en', theme: 'dark' },
  { width: 1440, height: 900, locale: 'id', theme: 'light' },
  { width: 1440, height: 900, locale: 'id', theme: 'dark' },
] as const;

async function setDiscoverPresentation(page: Page, locale: DiscoverLocale, theme: DiscoverTheme) {
  await page.evaluate(async ({ language, colorScheme }) => {
    // The product locale comes from the authenticated profile. For this private synthetic render,
    // switch the already-loaded i18next instance and formatter locale without changing that row.
    const i18nModule = await import(new URL('/src/lib/i18n/index.ts', window.location.origin).href);
    const activeLocaleModule = await import(new URL('/src/lib/locale/activeLocale.ts', window.location.origin).href);
    await i18nModule.i18next.changeLanguage(language);
    activeLocaleModule.setActiveLocale(language === 'id'
      ? { locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' }
      : { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
    document.documentElement.lang = language;
    document.documentElement.classList.toggle('dark', colorScheme === 'dark');
    window.localStorage.setItem('theme', colorScheme);
  }, { language: locale, colorScheme: theme });
}

async function captureDiscoverScreen(page: Page, outputDir: string, name: string) {
  await waitForFonts(page);
  await page.evaluate(async () => {
    const visibleDialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]'))
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return element.getAttribute('aria-hidden') !== 'true'
          && style.display !== 'none'
          && style.visibility !== 'hidden'
          && bounds.width > 0
          && bounds.height > 0;
      });
    const topmostDialog = visibleDialogs.pop();
    if (topmostDialog) {
      await Promise.all(topmostDialog.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
    }
  });
  const geometry = await page.evaluate((screenName) => {
    const rect = (element: Element | null) => {
      if (!element) return null;
      const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
      return { x, y, width, height, right, bottom };
    };
    const focused = document.activeElement as HTMLElement | null;
    const dialog = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]'))
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return element.getAttribute('aria-hidden') !== 'true'
          && style.display !== 'none'
          && style.visibility !== 'hidden'
          && bounds.width > 0
          && bounds.height > 0;
      })
      .pop() ?? null;
    return {
      name: screenName,
      path: location.pathname + location.search,
      locale: document.documentElement.lang,
      theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      main: rect(document.querySelector('main')),
      dialog: rect(dialog),
      focus: {
        tag: focused?.tagName ?? null,
        role: focused?.getAttribute('role') ?? null,
        label: focused?.getAttribute('aria-label') ?? null,
        text: focused?.textContent?.trim().slice(0, 100) ?? null,
        insideDialog: dialog ? dialog.contains(focused) : false,
      },
    };
  }, name);
  expect(geometry.documentWidth, `${name}: document fits its viewport`).toBeLessThanOrEqual(geometry.viewport.width + 1);
  expect(geometry.dialog, `${name}: dialog geometry`).not.toBeNull();
  expect(geometry.focus.insideDialog, `${name}: focus remains inside the open dialog`).toBe(true);
  if (geometry.dialog) {
    expect(geometry.dialog.x, `${name}: dialog stays within the viewport left edge`).toBeGreaterThanOrEqual(-1);
    expect(geometry.dialog.right, `${name}: dialog stays within the viewport right edge`).toBeLessThanOrEqual(geometry.viewport.width + 1);
  }
  const screenshotPath = path.join(outputDir, `${name}.png`);
  await page.screenshot({ path: screenshotPath, animations: 'disabled' });
  chmodSync(screenshotPath, 0o600);
  return geometry;
}

test('AC-S15-004 Finance starts a work-order invoice from the project, saves the contextual draft, and reopens it', async ({ page }) => {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-S15-004 requires the local fixture service client');
  const localUrl = requireMatchingLocalSupabaseUrls(undefined, undefined);
  const admin: SupabaseClient = createClient(localUrl, serviceKey, { auth: { persistSession: false } });
  const suffix = 'S15-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const companyName = 'Client ' + suffix + ' — International Project Delivery Services Group';
  const projectName = 'Billing project ' + suffix + ' — Regional Delivery Upgrade';
  const workOrderTitle = 'Survey and delivery coordination ' + suffix;
  const workOrderNumber = 'WO-' + suffix;
  const amount = 275000;
  const discoverOutputDir = process.env.S15_DISCOVER_OUTPUT_DIR;
  const discoverGeometry: unknown[] = [];
  if (discoverOutputDir) mkdirSync(discoverOutputDir, { recursive: true, mode: 0o700 });
  let companyId = '';
  let projectId = '';
  let workOrderId = '';
  let testFailed = false;
  let testFailure: unknown;
  const cleanupFailures: string[] = [];

  const runCleanup = async (
    label: string,
    operation: () => PromiseLike<{ error: { message: string } | null }>,
  ) => {
    try {
      const result = await operation();
      if (result.error) cleanupFailures.push(label + ': ' + result.error.message);
    } catch (error) {
      cleanupFailures.push(label + ': ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  try {
    const profile = await admin.from('profiles').select('org_id').eq('email', 'finance@acme.test').single();
    if (profile.error) throw new Error('AC-S15-004 fixture profile: ' + profile.error.message);
    const orgId = profile.data.org_id;

    const company = await admin.from('companies')
      .insert({ org_id: orgId, name: companyName, type: 'Client' })
      .select('id')
      .single();
    if (company.error) throw new Error('AC-S15-004 fixture client: ' + company.error.message);
    companyId = company.data.id;

    const project = await admin.from('projects')
      .insert({
        org_id: orgId,
        name: projectName,
        status: 'Ongoing Project',
        currency: 'EUR',
        client_id: companyId,
        contract_value: 1_000_000,
        tax_treatment: 'exclusive',
        tax_amount: 0,
        subject_to_vat: false,
        tax_rate: null,
        tax_base_numerator: 1,
        tax_base_denominator: 1,
      })
      .select('id')
      .single();
    if (project.error) throw new Error('AC-S15-004 fixture project: ' + project.error.message);
    projectId = project.data.id;

    workOrderId = crypto.randomUUID();
    const workOrder = await admin.from('work_orders').insert({
      id: workOrderId,
      org_id: orgId,
      project_id: projectId,
      title: workOrderTitle,
      client_po_number: 'PO-' + suffix,
      status: 'Issued',
      wo_number: workOrderNumber,
      issued_at: new Date().toISOString(),
      order_value: 1_000_000,
      tax_treatment: 'exclusive',
      tax_amount: 0,
      currency: 'EUR',
    });
    if (workOrder.error) throw new Error('AC-S15-004 fixture work order: ' + workOrder.error.message);

    await signIn(page, 'finance@acme.test');
    // Native revenue writes go through the existing RPC; keep ERP resource traffic out of this journey.
    await page.route('**/api/resource/**', (route) => route.abort());

    if (discoverOutputDir) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/projects/' + projectId + '/billing');
      await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
      await setDiscoverPresentation(page, 'en', 'light');
      await expect(page.getByTestId('record-header').getByText(companyName, { exact: true })).toBeVisible();
      await page.getByRole('button', { name: localized('Start invoice', 'Mulai membuat faktur') }).click();
      const chooser = page.getByRole('dialog', { name: localized('Start invoice', 'Mulai membuat faktur') });
      await expect(chooser).toBeVisible();
      await expect(chooser.getByRole('button', { name: localized('Customer work order', 'Work Order pelanggan') })).toBeVisible();
      await expect(chooser.getByRole('link', { name: localized('Contract invoice', 'Faktur kontrak') })).toBeVisible();
      discoverGeometry.push({
        ...(await captureDiscoverScreen(page, discoverOutputDir, 'project-billing-chooser-390-en-light')),
        oracles: ['long customer identity remains visible on the owning project', 'contract and customer-work-order methods remain distinct', 'modal focus and viewport geometry'],
      });

      await page.getByRole('link', { name: localized('Contract invoice', 'Faktur kontrak') }).click();
      const contractForm = page.getByRole('dialog', { name: localized('New invoice', 'Faktur baru') });
      await expect(contractForm).toBeVisible();
      for (const mode of discoverModes) {
        await page.setViewportSize({ width: mode.width, height: mode.height });
        await setDiscoverPresentation(page, mode.locale, mode.theme);
        await expect(contractForm.getByRole('combobox', { name: localized('Customer', 'Pelanggan') })).toContainText(companyName);
        await expect(contractForm.getByRole('combobox', { name: localized('Project', 'Proyek') })).toContainText(projectName);
        await expect(contractForm.getByText('€')).toBeVisible();
        const name = `project-contract-invoice-form-${mode.width}-${mode.locale}-${mode.theme}`;
        discoverGeometry.push({
          ...(await captureDiscoverScreen(page, discoverOutputDir, name)),
          oracles: ['authorized customer and project remain selected', 'project source currency EUR is visible', 'unknown source currency never inherits the org symbol', 'modal focus and viewport geometry'],
        });
      }
      writeFileSync(path.join(discoverOutputDir, 'geometry.json'), JSON.stringify(discoverGeometry, null, 2), { mode: 0o600 });
      chmodSync(path.join(discoverOutputDir, 'geometry.json'), 0o600);

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/projects/' + projectId + '/billing');
      await setDiscoverPresentation(page, 'en', 'light');
    } else {
      await page.goto('/projects/' + projectId + '/billing');
    }
    await page.getByRole('button', { name: localized('Start invoice', 'Mulai membuat faktur') }).click();
    await page.getByRole('button', { name: localized('Customer work order', 'Work Order pelanggan') }).click();
    await expect(page).toHaveURL(new RegExp('/projects/' + projectId + '/work-orders$'));

    const orderRow = page.getByRole('row').filter({ hasText: workOrderTitle });
    await expect(orderRow).toBeVisible();
    await orderRow.getByRole('button', { name: /invoice|tagih/i }).click();

    const form = page.getByRole('dialog');
    await expect(form.getByRole('heading', { name: localized('Invoice this work order', 'Tagih Work Order ini') })).toBeVisible();
    if (discoverOutputDir) {
      await expect(form.getByText('€', { exact: true })).toBeVisible();
      const name = 'work-order-invoice-modal-1440-en-light';
      discoverGeometry.push({
        ...(await captureDiscoverScreen(page, discoverOutputDir, name)),
        oracles: ['eligible issued work order can still be invoiced', 'work-order currency EUR remains the selected invoice currency', 'modal focus and viewport geometry'],
      });
      writeFileSync(path.join(discoverOutputDir, 'geometry.json'), JSON.stringify(discoverGeometry, null, 2), { mode: 0o600 });
      chmodSync(path.join(discoverOutputDir, 'geometry.json'), 0o600);
    }
    await form.getByLabel(/amount \(excl\. PPN\)|jumlah \(belum termasuk PPN\)/i).fill(String(amount));
    await form.getByRole('button', { name: /create draft invoice|buat draf faktur/i }).click();
    await expect(form).toBeHidden();

    await page.getByRole('link', { name: /open draft|buka draf/i }).click();
    await expect(page).toHaveURL(/\/sales-invoices\/[^/?]+/);
    const invoiceId = new URL(page.url()).pathname.split('/').pop();
    if (!invoiceId) throw new Error('AC-S15-004 draft route did not contain an invoice id');

    const saved = await admin.from('sales_invoices')
      .select('project_id,customer_id,work_order_id,amount,currency,status')
      .eq('id', invoiceId)
      .single();
    if (saved.error) throw new Error('AC-S15-004 persisted draft: ' + saved.error.message);
    expect(saved.data).toMatchObject({
      project_id: projectId,
      customer_id: companyId,
      work_order_id: workOrderId,
      currency: 'EUR',
      status: 'Draft',
    });
    expect(Number(saved.data.amount)).toBe(amount);

    await page.reload();
    await expect(page.getByRole('heading', { name: /draft invoice|draf faktur/i })).toBeVisible();
    await expect(page.getByText(projectName, { exact: true })).toBeVisible();
    await expect(page.getByRole('definition').filter({ hasText: companyName })).toBeVisible();
  } catch (error) {
    testFailed = true;
    testFailure = error;
  } finally {
    if (projectId) {
      let invoiceIds: string[] = [];
      try {
        const invoices = await admin.from('sales_invoices').select('id').eq('project_id', projectId);
        if (invoices.error) cleanupFailures.push('read invoices: ' + invoices.error.message);
        invoiceIds = (invoices.data ?? []).map((row: { id: string }) => row.id);
      } catch (error) {
        cleanupFailures.push('read invoices: ' + (error instanceof Error ? error.message : String(error)));
      }
      if (invoiceIds.length > 0) {
        await runCleanup('delete receipts', () => admin.from('incoming_payments').delete().in('sales_invoice_id', invoiceIds));
      }
      await runCleanup('delete invoices', () => admin.from('sales_invoices').delete().eq('project_id', projectId));
    }
    if (workOrderId) {
      await runCleanup('delete work order', () => admin.from('work_orders').delete().eq('id', workOrderId));
    }
    if (projectId) {
      await runCleanup('delete project', () => admin.from('projects').delete().eq('id', projectId));
    }
    if (companyId) {
      await runCleanup('delete client', () => admin.from('companies').delete().eq('id', companyId));
    }
    if (discoverOutputDir) {
      writeFileSync(path.join(discoverOutputDir, 'geometry.json'), JSON.stringify(discoverGeometry, null, 2), { mode: 0o600 });
      chmodSync(path.join(discoverOutputDir, 'geometry.json'), 0o600);
    }
  }

  if (cleanupFailures.length > 0) {
    const cleanupError = new Error('AC-S15-004 cleanup failed: ' + cleanupFailures.join('; '));
    if (testFailed) throw new AggregateError([testFailure, cleanupError], 'AC-S15-004 failed and cleanup reported errors');
    throw cleanupError;
  }
  if (testFailed) throw testFailure;
});
