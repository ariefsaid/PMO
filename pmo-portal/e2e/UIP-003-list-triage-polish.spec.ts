// @e2e-isolation: self-isolated — owns same-prefix synthetic projects; deletes only their generated IDs.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { login, waitForFonts } from './helpers';

// No shared seed row or org setting is mutated. Closed award values and row-local locations need no setup change.
test('UIP-003 / UIP-004: recognize same-prefix records, retain classifications on return, and expose phone opportunities above the fold', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.SUPABASE_URL;
  if (!key || !url) throw new Error('Local test database configuration is required');
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data: profile, error: profileError } = await admin.from('profiles').select('org_id').eq('role', 'Project Manager').limit(1).single();
  expect(profileError).toBeNull();
  const ids = Array.from({ length: 4 }, () => randomUUID());
  const location = `West Java ${randomUUID()}`;
  const names = ['Harbor Renewal Programme — Eastern Terminal Infrastructure Delivery', 'Harbor Renewal Programme — Western Terminal Infrastructure Delivery'];
  try {
    const { error } = await admin.from('projects').insert(ids.map((id, index) => ({
      id, org_id: profile!.org_id, name: names[index % 2], status: index < 2 ? 'Internal Project' : 'Leads',
      location, award_type: 'tender', bidding_entity: 'alone', contract_value: 0,
    })));
    expect(error).toBeNull();
    await login(page, 'pm@acme.test');
    for (const route of ['projects', 'sales']) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/${route}?view=table`);
      const disclosure = page.getByRole('button', { name: /^Classification/ });
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
      await disclosure.click();
      await page.getByLabel('Filter by award type').selectOption('tender');
      await page.getByLabel('Filter by location').fill(location);
      await expect.poll(() => new URL(page.url()).searchParams.get('location')).toBe(location);
      // Open the record directly from expanded filters: outside dismissal must not move
      // the target between pointer-down and click.
      await expect(disclosure).toHaveAccessibleName('Classification 2');
      await expect(page.getByText(`Location: ${location}`, { exact: true })).toBeVisible();
      const table = page.getByRole('table');
      const intended = route === 'projects'
        ? table.getByRole('button', { name: names[1], exact: true })
        : table.getByRole('button', { name: `Open ${names[1]}`, exact: true });
      await expect(intended).toBeVisible();
      if (route === 'projects') {
        await waitForFonts(page);
        expect(await intended.evaluate((el) => el.closest('td')!.getBoundingClientRect().width)).toBeGreaterThanOrEqual(240);
        expect(await intended.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('normal');
        expect(await intended.evaluate((el) => getComputedStyle(el).webkitLineClamp)).toBe('2');
        for (const theme of ['light', 'dark']) {
          await page.evaluate((value) => document.documentElement.classList.toggle('dark', value === 'dark'), theme);
          await intended.locator('..').screenshot({ path: testInfo.outputPath(`UIP-003-identity-1440-${theme}.png`) });
        }
        const scroller = page.getByTestId('dt-table-branch');
        await scroller.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
        for (const column of ['Customer', 'End customer', 'Contract', 'Actual', 'Progress', 'Budget used', 'Action']) {
          await expect(table.getByRole('columnheader', { name: column, exact: true })).toBeVisible();
        }
        await scroller.evaluate((el) => { el.scrollLeft = 0; });
      }
      const narrowed = page.url();
      await intended.click();
      await expect(page).toHaveURL(new RegExp(`/projects/${ids[route === 'projects' ? 1 : 3]}$`));
      await expect(page.getByTestId('record-header')).toContainText(names[1]);
      if (route === 'projects') await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Projects', exact: true }).click();
      else await page.getByRole('link', { name: /Back to Sales Pipeline/i }).click();
      await expect(page).toHaveURL(narrowed);
      await expect(disclosure).toHaveAccessibleName('Classification 2');
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
      await disclosure.click();
      await expect(page.getByLabel('Filter by award type')).toHaveValue('tender');
      await expect(page.getByLabel('Filter by location')).toHaveValue(location);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Clear classifications' }).click();
      await expect(disclosure).toHaveAccessibleName('Classification');
      await expect.poll(() => new URL(page.url()).searchParams.has('location')).toBe(false);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => localStorage.setItem('theme', value), theme);
      await page.goto('/sales?view=kanban');
      const first = page.getByLabel('Sales pipeline board').getByRole('button').first();
      await expect(first).toBeVisible();
      await waitForFonts(page);
      const box = await first.boundingBox();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(844);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      const toolbar = page.getByTestId('list-page-toolbar');
      const toolbarBox = await toolbar.boundingBox();
      const tableViewBox = await toolbar.getByRole('tab', { name: 'Table', exact: true }).boundingBox();
      expect(tableViewBox!.x + tableViewBox!.width).toBeLessThanOrEqual(toolbarBox!.x + toolbarBox!.width);
      await page.screenshot({ path: testInfo.outputPath(`UIP-004-pipeline-390-${theme}.png`) });
    }
  } finally {
    const { error } = await admin.from('projects').delete().in('id', ids);
    expect(error).toBeNull();
  }
});
