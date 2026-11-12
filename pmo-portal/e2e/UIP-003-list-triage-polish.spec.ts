// @e2e-isolation: self-isolated — owns same-prefix synthetic projects; deletes only their generated IDs.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { login } from './helpers';
import { addBuilderFilter, builderChip } from './support/filter-builder';

// No shared seed row or org setting is mutated. Closed award values and row-local locations need no setup change.
test('UIP-003: classify same-prefix records, open them, and retain classifications on return', async ({ page }) => {
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
      // Projects filters through the one filter builder (#1983); the Pipeline keeps its Classification disclosure.
      const triggerName = 'Classification';
      const disclosure = page.getByRole('button', { name: new RegExp(`^${triggerName}`) });
      if (route === 'projects') {
        await addBuilderFilter(page, 'Award type', { option: 'Tender' });
        await addBuilderFilter(page, 'Location', { operator: 'contains', text: location });
        await expect(builderChip(page, 'Location')).toBeVisible();
      } else {
        await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
        await disclosure.click();
        await page.getByLabel('Filter by award type').selectOption('tender');
        await page.getByLabel('Filter by location').fill(location);
        // Open the record directly from expanded filters: outside dismissal must not move
        // the target between pointer-down and click.
        await expect(disclosure).toHaveAccessibleName(`${triggerName} 2`);
        await expect(page.getByText(`Location: ${location}`, { exact: true })).toBeVisible();
      }
      await expect.poll(() => new URL(page.url()).searchParams.get('location')).toBe(location);
      const intended = route === 'projects'
        ? page.getByTestId('projects-table-container').getByRole('button', { name: names[1], exact: true })
        : page.getByRole('table').getByRole('button', { name: `Open ${names[1]}`, exact: true });
      await expect(intended).toBeVisible();
      const narrowed = page.url();
      await intended.click();
      // The pipeline row opens the deal preview first (#1426); the user continues with "Open deal".
      if (route === 'sales') await page.getByRole('dialog').getByRole('button', { name: 'Open deal' }).click();
      await expect(page).toHaveURL(new RegExp(`/projects/${ids[route === 'projects' ? 1 : 3]}$`));
      await expect(page.getByTestId('record-header')).toContainText(names[1]);
      if (route === 'projects') await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Projects', exact: true }).click();
      else await page.getByRole('link', { name: /Back to Sales Pipeline/i }).click();
      await expect(page).toHaveURL(narrowed);
      if (route === 'projects') {
        // Back from the record rebuilds the same chips from the URL.
        await expect(builderChip(page, 'Award type')).toBeVisible();
        await expect(builderChip(page, 'Location')).toBeVisible();
        await page.getByTestId('project-filter-builder').getByRole('button', { name: 'Clear all', exact: true }).click();
        await expect(builderChip(page, 'Location')).toHaveCount(0);
      } else {
        await expect(disclosure).toHaveAccessibleName(`${triggerName} 2`);
        await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
        await disclosure.click();
        await expect(page.getByLabel('Filter by award type')).toHaveValue('tender');
        await expect(page.getByLabel('Filter by location')).toHaveValue(location);
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Clear classifications' }).click();
        await expect(disclosure).toHaveAccessibleName(triggerName);
      }
      await expect.poll(() => new URL(page.url()).searchParams.has('location')).toBe(false);
    }
  } finally {
    const { error } = await admin.from('projects').delete().in('id', ids);
    expect(error).toBeNull();
  }
});
