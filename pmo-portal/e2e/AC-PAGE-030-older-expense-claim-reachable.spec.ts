// @e2e-isolation: self-isolated — creates its own uniquely-tagged project and 205 older expense claims each run, and deletes them afterwards; touches no shared seed row.
/**
 * AC-PAGE-030 — older records are reachable from the list (#843): the Expenses list shows 50 claims a page, and a
 * person who needs a claim from past the newest 200 reaches it with the numbered pages and opens it. Goal oracle: the
 * oldest claim's own record opens from the list. Before the pager the list stopped at the newest 200 with no way on.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const ENGINEER_ID = '00000000-0000-0000-0000-0000000000a4';
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);
const OLDER_CLAIMS = 205;

test.setTimeout(120_000);

let admin: SupabaseClient | undefined;
let projectId = '';
let tag = '';

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-PAGE-030 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  tag = `PAGE-030 ${Date.now()}`;
  const project = await admin.from('projects').insert({ org_id: ORG_ID, name: tag, status: 'Ongoing Project' }).select('id').single();
  if (project.error) throw new Error(`AC-PAGE-030 fixture project: ${project.error.message}`);
  projectId = project.data.id;
  // Older than any claim another spec writes, so the oldest one is last in the list's newest-first order.
  const base = Date.parse('2019-01-01T00:00:00Z');
  const rows = Array.from({ length: OLDER_CLAIMS }, (_, i) => ({
    org_id: ORG_ID, claimant_id: ENGINEER_ID, project_id: projectId, currency: 'IDR', amount: 100_000 + i, status: 'Paid',
    title: i === 0 ? `${tag} oldest claim` : `${tag} claim ${i}`,
    created_at: new Date(base + i * 60_000).toISOString(),
  }));
  for (let from = 0; from < rows.length; from += 100) {
    const inserted = await admin.from('expense_claims').insert(rows.slice(from, from + 100));
    if (inserted.error) throw new Error(`AC-PAGE-030 fixture claims: ${inserted.error.message}`);
  }
});

test.afterEach(async () => {
  if (!admin || !projectId) return;
  const claims = await admin.from('expense_claims').delete().eq('project_id', projectId);
  if (claims.error) throw new Error(`AC-PAGE-030 cleanup claims: ${claims.error.message}`);
  const project = await admin.from('projects').delete().eq('id', projectId);
  if (project.error) throw new Error(`AC-PAGE-030 cleanup project: ${project.error.message}`);
  projectId = '';
});

test('AC-PAGE-030 a claim older than the newest 200 is reached from the list by its numbered pages and opened', async ({ page }) => {
  await signIn(page, 'admin@acme.test');
  await page.goto('/expenses');
  await expect(page.getByRole('status').filter({ hasText: /^Showing 1–50 of/ })).toBeVisible({ timeout: 20_000 });

  // Page 2 is the first step past the first screenful.
  await page.getByRole('navigation', { name: 'Pagination' }).getByRole('button', { name: 'Page 2' }).click();
  await expect(page).toHaveURL(/[?&]page=2\b/);
  await expect(page.getByRole('status').filter({ hasText: /^Showing 51–100 of/ })).toBeVisible();

  // The oldest claim is on the last page; its number is the largest the pager offers.
  const pager = page.getByRole('navigation', { name: 'Pagination' });
  await pager.getByRole('button', { name: 'Next page' }).click();
  const pageNumbers = await pager.getByRole('button', { name: /^Page \d+$/ }).allInnerTexts();
  const last = Math.max(...pageNumbers.map(Number));
  expect(last).toBeGreaterThanOrEqual(5);
  await pager.getByRole('button', { name: `Page ${last}` }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]page=${last}\\b`));

  const oldest = page.getByRole('row', { name: new RegExp(`${tag} oldest claim`) });
  await expect(oldest).toBeVisible({ timeout: 15_000 });
  await oldest.click();
  await expect(page).toHaveURL(/\/expenses\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: new RegExp(`${tag} oldest claim`) })).toBeVisible();
});
