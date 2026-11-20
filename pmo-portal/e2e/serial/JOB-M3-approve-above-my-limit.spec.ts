// @e2e-isolation: serial — adds a row to the ORG-WIDE senior approver set (spend_approvers with no project), which changes who may approve over-budget and overhead requests for every spec; removed in afterEach.
// JOB-M3 (management): approve above my limit. A request that exceeds its budget line routes to management; the director finds it in Approvals and approves it,
// while a within-budget request on the same project never appears in their list.
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signIn } from '../helpers';
import { need, ok, ORG_ID, PM_ID, runId, serviceClient } from '../support/jobFixtures';

test.describe.configure({ retries: 0 });
test.setTimeout(120_000);

const ENGINEER_ID = '00000000-0000-0000-0000-0000000000a4'; // the buyer
const FINANCE_ID = '00000000-0000-0000-0000-0000000000a3'; // the project's named approver
const EXEC_ID = '00000000-0000-0000-0000-0000000000a1';    // the director

let admin: SupabaseClient;
let projectId = ''; let procIds: string[] = []; let seniorRowId = '';

test.afterEach(async () => {
  if (!admin) return;
  if (seniorRowId) await admin.from('spend_approvers').delete().eq('id', seniorRowId);
  if (procIds.length) {
    await admin.from('procurement_status_events').delete().in('procurement_id', procIds);
    await admin.from('procurements').delete().in('id', procIds);
  }
  if (projectId) {
    await admin.from('spend_approvers').delete().eq('project_id', projectId);
    await admin.from('budget_versions').delete().eq('project_id', projectId);
    await admin.from('projects').delete().eq('id', projectId);
  }
  projectId = ''; procIds = []; seniorRowId = '';
});

test('JOB-M3 the director approves the over-budget request from Approvals; the within-budget one never reaches them', async ({ page }) => {
  admin = serviceClient('JOB-M3');
  const run = runId('JOBM3');
  projectId = need('project', await admin.from('projects').insert({ org_id: ORG_ID, name: run, status: 'Ongoing Project', project_manager_id: PM_ID }).select('id').single()).id;
  const version = need('version', await admin.from('budget_versions').insert({ org_id: ORG_ID, project_id: projectId, name: run, version: 1, status: 'Draft' }).select('id').single());
  ok('line', await admin.from('budget_line_items').insert({ org_id: ORG_ID, budget_version_id: version.id, category: 'Materials', budgeted_amount: 1_000_000 }));
  ok('activate', await admin.from('budget_versions').update({ status: 'Active' }).eq('id', version.id));
  ok('project approver', await admin.from('spend_approvers').insert({ org_id: ORG_ID, project_id: projectId, profile_id: FINANCE_ID }));
  seniorRowId = need('senior set', await admin.from('spend_approvers').insert({ org_id: ORG_ID, project_id: null, profile_id: EXEC_ID }).select('id').single()).id;
  const mk = async (title: string, total: number) => need(title, await admin.from('procurements').insert({
    org_id: ORG_ID, title, project_id: projectId, requested_by_id: ENGINEER_ID, status: 'Requested', total_value: total, budget_category: 'Materials',
  }).select('id').single()).id as string;
  const within = `${run} within budget`; const over = `${run} over budget`;
  procIds = [await mk(within, 400_000), await mk(over, 1_500_000)];

  await signIn(page, 'exec@acme.test');
  await page.goto('/approvals?scope=procurement');
  const queue = page.getByTestId('approvals-queue-region');
  const overRow = queue.locator('button[aria-pressed]').filter({ hasText: over });
  await expect(overRow).toHaveCount(1, { timeout: 20_000 });
  await expect(queue.locator('button[aria-pressed]').filter({ hasText: within })).toHaveCount(0);

  await overRow.click();
  const preview = page.getByTestId('approvals-preview-region');
  await preview.getByRole('button', { name: /^approve$/i }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^approve$/i }).click();
  await expect(queue.locator('button[aria-pressed]').filter({ hasText: over })).toHaveCount(0, { timeout: 20_000 });

  const rows = need('status', await admin.from('procurements').select('title, status').in('id', procIds));
  expect(rows.find((r) => r.title === over)?.status).toBe('Approved');
  expect(rows.find((r) => r.title === within)?.status).toBe('Requested');
});
