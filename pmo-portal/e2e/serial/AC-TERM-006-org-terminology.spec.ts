// @e2e-isolation: serial — changes the organisation's shared terminology and restores it afterward.
import { createClient } from '@supabase/supabase-js';
import { test, expect } from '@playwright/test';
import { login, pickComboboxOption, requireServiceRoleKey, stubErpProjectSync } from '../helpers';
import ExcelJS from 'exceljs';

const org = '00000000-0000-0000-0000-000000000001';
const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';

test('AC-TERM-006: renamed labels reach two screens and the export without changing a typed name', async ({ page }) => {
  test.setTimeout(120_000);
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Local stack required');
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('Local service role key required');
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const previous = await db.from('org_terminology').select('*').eq('org_id', org).eq('term_key', 'project').eq('locale', 'en').maybeSingle();
  if (previous.error) throw previous.error;
  const name = `Project terminology witness ${Date.now()}`;
  async function cleanup() {
    const deleted = await db.from('org_terminology').delete().eq('org_id', org).eq('term_key', 'project').eq('locale', 'en');
    if (deleted.error) throw deleted.error;
    if (previous.data) {
      const restored = await db.from('org_terminology').insert(previous.data);
      if (restored.error) throw restored.error;
    }
    const removed = await db.from('projects').delete().eq('org_id', org).eq('name', name);
    if (removed.error) throw removed.error;
  }
  await stubErpProjectSync(page);
  await page.route('**/rest/v1/profiles?*', async (route) => {
    const response = await route.fetch({ maxRetries: 2 });
    const data = await response.json() as Record<string, unknown> | Record<string, unknown>[];
    const pin = (row: Record<string, unknown>) => ({ ...row, locale: 'en', number_locale: 'en-US' });
    await route.fulfill({ response, json: Array.isArray(data) ? data.map(pin) : pin(data) });
  });
  try {
    await login(page, 'admin@acme.test');
    await page.goto('/projects');
    await expect(page.getByTestId('projects-loading')).not.toBeVisible();
    await page.getByRole('button', { name: /new project/i }).first().click();
    await page.getByLabel(/project name/i).fill(name);
    await pickComboboxOption(page, page, /client company/i, /^Meridian Steelworks/);
    await page.getByRole('button', { name: /^Create project$/i }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/u);

    await page.goto('/administration/terminology');
    const row = page.getByTestId('term-row-project-en');
    await row.getByLabel('Singular').fill('engagement');
    await row.getByLabel('Plural').fill('engagements');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Terminology saved').first()).toBeVisible();

    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: 'Engagements', exact: true })).toBeVisible();
    await page.goto('/sales?view=table&status=Leads');
    const search = page.getByRole('searchbox', { name: /search engagements/i });
    await search.fill(name);
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /^Export$/ }).first().click();
    const file = await download;
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.concat(chunks) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const cells: string[] = [];
    workbook.eachSheet((sheet) => sheet.eachRow((r) => r.eachCell((c) => cells.push(String(c.value ?? '')))));
    expect(cells.some((value) => /engagement/i.test(value))).toBe(true);
    expect(cells).toContain(name);
  } finally {
    await cleanup();
  }
});
