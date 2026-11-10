// @e2e-isolation: serial — creates and activates budget versions (org-global state).
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { login, requireServiceRoleKey } from '../helpers';

// AC-BAD-011 (#1273) — Finance reviews two imported drafts (drafted by someone else) on the Finance hub, ticks both,
// confirms once, and both become the projects' active budgets. Each goes through the normal per-budget activation.

async function mockAdapter(page: Page) {
  await page.route('**/functions/v1/adapter-dispatch', async (route) => {
    const body = route.request().postDataJSON() as { action?: string; domain?: string; operation?: string; record?: { id?: string } };
    if (body.action === 'budget-activation-precheck') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        status: 'ready', erpCheck: 'not-required', fiscalYearNames: null, fiscalYears: null, issues: [],
      }) });
      return;
    }
    if (body.domain === 'budget' && body.operation === 'create') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ externalRecordId: `Budget/${body.record?.id}`, canonical: body.record }) });
      return;
    }
    await route.continue();
  });
}

function serviceClient() {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-BAD-011 needs the service role key');
  return createClient(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '', key, { auth: { persistSession: false } });
}

// Drafts are org-wide: one left behind by a failed run would show on every later /finance visit, so each run starts
// and ends with none of ours (Active versions are the journey's intended result and stay, as in AC-732).
async function removeBulkDrafts() {
  const admin = serviceClient();
  const drafts = await admin.from('budget_versions').select('id').eq('status', 'Draft').like('name', 'E2E bulk %').throwOnError();
  for (const { id } of drafts.data ?? []) {
    await admin.from('budget_line_items').delete().eq('budget_version_id', id).throwOnError();
    await admin.from('budget_versions').delete().eq('id', id).throwOnError();
  }
}

test.beforeEach(removeBulkDrafts);
test.afterEach(removeBulkDrafts);

test('AC-BAD-011 Finance ticks two imported drafts on the Finance hub and activates them in one confirmed step', async ({ page }) => {
  const admin = serviceClient();
  const pm = (await admin.from('profiles').select('id,org_id').eq('email', 'pm@acme.test').single().throwOnError()).data!;
  const tag = `E2E bulk ${Date.now()}`;
  const ids: string[] = [];
  for (const n of [1, 2]) {
    const project = (await admin.from('projects').insert({ org_id: pm.org_id, name: `${tag} ${n}`, status: 'Ongoing Project' }).select('id').single().throwOnError()).data!;
    const version = (await admin.from('budget_versions').insert({ org_id: pm.org_id, project_id: project.id, version: 1, name: `${tag} draft`, status: 'Draft', created_by: pm.id }).select('id').single().throwOnError()).data!;
    await admin.from('budget_line_items').insert({ org_id: pm.org_id, budget_version_id: version.id, category: 'Labor', description: 'Imported', budgeted_amount: 1000 * n, actual_amount: 0 }).throwOnError();
    ids.push(version.id);
  }

  await mockAdapter(page);
  await login(page, 'finance@acme.test');
  await page.goto('/finance');
  const panel = page.getByRole('region', { name: 'Review and activate drafts' });
  await expect(panel).toBeVisible({ timeout: 15_000 });
  // Collapsed by default (no readiness reads until opened); readiness runs 10 drafts at a time, so check the rest too.
  await panel.getByRole('button', { name: /^Review \d+ drafts?$/ }).click();
  const rest = panel.getByRole('button', { name: 'Check the rest' });
  if (await rest.isVisible()) await rest.click();
  const first = panel.getByRole('checkbox', { name: new RegExp(`${tag} 1`) });
  const second = panel.getByRole('checkbox', { name: new RegExp(`${tag} 2`) });
  await expect(first).not.toHaveAttribute('aria-disabled', 'true', { timeout: 15_000 });
  await expect(second).not.toHaveAttribute('aria-disabled', 'true', { timeout: 15_000 });
  await first.click();
  await second.click();
  await panel.getByRole('button', { name: 'Activate selected (2)' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Activate 2 draft budgets?');
  await dialog.getByRole('button', { name: 'Activate 2 drafts' }).click();
  await expect(panel.getByText('2 activated, 0 failed')).toBeVisible({ timeout: 20_000 });

  const after = await admin.from('budget_versions').select('id,status').in('id', ids).throwOnError();
  expect((after.data ?? []).map((v) => v.status)).toEqual(['Active', 'Active']);
});
