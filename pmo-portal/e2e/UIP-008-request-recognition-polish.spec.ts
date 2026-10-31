// @e2e-isolation: self-isolated — owns uniquely named requests/project/items and cleans them up; previews only, never submits a decision.
import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey, waitForFonts } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

/**
 * UIP-008 — the approvals inbox previews the selected request by keyboard at desktop and phone.
 *
 * Phase 2 (#1529) moved the geometry rows (UIP-007 value alignment, UIP-009 phone header stacking)
 * to the /procurement layout sweep (e2e/layout/procurement.layout.spec.ts). These remaining tests
 * are the DOWN lane's MOVE-COMPONENT rows (target:
 * pmo-portal/pages/__tests__/Approvals.inbox.test.tsx) and stay in the browser until that lane
 * moves them below the browser.
 */

const env = loadEnv('development', process.cwd(), 'VITE_');
const url = requireMatchingLocalSupabaseUrls(process.env.SUPABASE_URL, env.VITE_SUPABASE_URL);
const org = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
let admin: SupabaseClient | undefined;
let projectId = '';
let ids: string[] = [];
let titles: string[] = [];

test.beforeEach(async () => {
  // A failed prior setup/cleanup must never let the next test inherit fixture identities.
  admin = undefined;
  projectId = '';
  ids = [];
  titles = [];

  const key = requireServiceRoleKey();
  if (!key) throw new Error('UIP-008 requires the local e2e wrapper');
  admin = createClient(url, key, { auth: { persistSession: false } });
  const tag = `UIP-008 ${randomUUID().slice(0, 6)}`;
  const projectName = `${tag} distribution board commissioning`;
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

async function assertApprovalPreview(page: Page, width: 1440 | 390): Promise<void> {
  await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
  await page.goto('/approvals?scope=procurement');
  // S-18 moved phone and desktop approvals to one selection → evidence preview
  // pattern (fa448039). Select the same request from the queue at this viewport.
  const control = page.getByRole('region', { name: 'Approvals queue' })
    .getByRole('button', { name: new RegExp(titles[1]) });
  await expect(control).toBeVisible();
  await control.focus();
  await page.keyboard.press('Enter');
  const preview = page.getByRole('region', { name: 'Approval preview' });
  await expect(preview.getByText('South hall switchgear evidence', { exact: true })).toBeVisible();
  await expect(preview.getByText('$48,000', { exact: true }).first()).toBeVisible();
  await expect(preview.getByText('North hall switchgear evidence', { exact: true })).toHaveCount(0);
  await expect(preview.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Reject', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/approvals\?scope=procurement$/);
  await waitForFonts(page);
  await expect(control.getByText(titles[1], { exact: true })).toBeVisible();
  await expect(control).toContainText('Requested');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('UIP-008 previews the South request by keyboard at desktop 1440x900', async ({ page }) => {
  await signIn(page, 'finance@acme.test');
  await assertApprovalPreview(page, 1440);
});

test('UIP-008 previews the South request by keyboard at phone 390x844', async ({ page }) => {
  await signIn(page, 'finance@acme.test');
  await assertApprovalPreview(page, 390);
});
