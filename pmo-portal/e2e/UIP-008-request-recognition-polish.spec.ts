// @e2e-isolation: self-isolated — owns uniquely named requests/project/items and cleans them up; previews only, never submits a decision.
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey, waitForFonts } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const env = loadEnv('development', process.cwd(), 'VITE_');
const url = requireMatchingLocalSupabaseUrls(process.env.SUPABASE_URL, env.VITE_SUPABASE_URL);
const org = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
let admin: SupabaseClient;
let projectId = '';
let ids: string[] = [];
let titles: string[] = [];
let projectName = '';

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('UIP-008 requires the local e2e wrapper');
  admin = createClient(url, key, { auth: { persistSession: false } });
  const tag = `UIP-008 ${randomUUID().slice(0, 6)}`;
  projectName = `${tag} distribution board commissioning`;
  titles = [`${tag} Switchgear — North hall commissioning`, `${tag} Switchgear — South hall commissioning`];
  const project = await admin.from('projects').insert({ org_id: org, name: projectName, status: 'Ongoing Project' }).select('id').single();
  if (project.error) throw project.error;
  projectId = project.data.id;
  const requests = await admin.from('procurements').insert(titles.map((title, i) => ({
    org_id: org, project_id: projectId, title, status: 'Requested',
    requested_by_id: '00000000-0000-0000-0000-0000000000a4', total_value: i === 0 ? 9800 : 48000, currency: 'USD',
  }))).select('id,title');
  if (requests.error) throw requests.error;
  ids = titles.map(title => requests.data.find(row => row.title === title)!.id);
  const items = await admin.from('procurement_items').insert(ids.map((id, i) => ({
    procurement_id: id, name: i === 0 ? 'North hall switchgear evidence' : 'South hall switchgear evidence', quantity: 1, rate: i === 0 ? 9800 : 48000,
  })));
  if (items.error) throw items.error;
});

test.afterEach(async () => {
  if (!admin) return;
  if (ids.length) {
    for (const table of ['procurement_items', 'procurement_status_events']) {
      const { error } = await admin.from(table).delete().in('procurement_id', ids);
      if (error) throw error;
    }
    const { error } = await admin.from('procurements').delete().in('id', ids);
    if (error) throw error;
  }
  if (projectId) {
    const { error } = await admin.from('projects').delete().eq('id', projectId);
    if (error) throw error;
  }
  ids = [];
  projectId = '';
});

test('UIP-008 recognizes the intended same-prefix request and previews its amount/evidence with keyboard, desktop and phone', async ({ page }) => {
  await signIn(page, 'finance@acme.test');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.goto('/approvals?scope=procurement');
    const control = width === 1440
      ? page.getByRole('region', { name: 'Approvals queue' }).getByRole('button', { name: new RegExp(titles[1]) })
      : page.getByRole('button', { name: `Show budget impact for ${titles[1]}`, exact: true });
    await expect(control).toBeVisible();
    await control.focus();
    await page.keyboard.press('Enter');
    const preview = width === 1440 ? page.getByRole('region', { name: 'Approval preview' }) : page.locator(`#${await control.getAttribute('aria-controls')}`);
    await expect(preview.getByText('South hall switchgear evidence', { exact: true })).toBeVisible();
    await expect(preview.getByText('$48,000', { exact: true }).first()).toBeVisible();
    await expect(preview.getByText('North hall switchgear evidence', { exact: true })).toHaveCount(0);
    await expect(preview.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
    await expect(preview.getByRole('button', { name: 'Reject', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/approvals\?scope=procurement$/);
    await waitForFonts(page);
    const identity = width === 1440 ? control.getByText(titles[1], { exact: true }) : page.locator('[data-approval-row]').filter({ hasText: titles[1] }).getByText(titles[1], { exact: true });
    await expect(identity).toHaveCSS('-webkit-line-clamp', '2');
    const status = identity.locator('..').getByText('Requested', { exact: true });
    const titleBox = (await identity.boundingBox())!;
    const statusBox = (await status.boundingBox())!;
    expect(statusBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }

  // UIP-007: comparative values and their quiet header share a common right edge.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/procurement');
  await page.getByRole('searchbox', { name: 'Filter requests' }).fill(titles[0].split(' Switchgear')[0]);
  await expect(page.locator('[data-procurement-value]')).toHaveCount(2);
  await waitForFonts(page);
  const edges = await page.locator('[data-procurement-value]').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().right));
  expect(Math.abs(edges[0] - edges[1])).toBeLessThanOrEqual(1);
  const headerEdge = await page.getByTestId('procurement-list-columns').getByText('Value', { exact: true }).evaluate(node => node.getBoundingClientRect().right);
  expect(Math.abs(headerEdge - edges[0])).toBeLessThanOrEqual(1);
  await expect(page.locator('[data-procurement-value]').first()).toHaveCSS('font-variant-numeric', 'tabular-nums');

  // UIP-009: the same request's canonical phone header stacks status below its full title.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/procurement/${ids[1]}`);
  const header = page.getByTestId('record-header');
  const title = header.getByRole('heading', { name: titles[1], exact: true });
  await expect(title).toBeVisible();
  await waitForFonts(page);
  const titleBox = (await title.boundingBox())!;
  const statusBox = (await header.getByText('Purchase Request', { exact: true }).boundingBox())!;
  expect(statusBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
  expect(await title.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
