// @e2e-isolation: self-isolated — owns a project and one work order (unique title) and a disposable executive login; deleted in afterEach.
/**
 * JOB-A10 / TC-PA-17 — an executive opens the assistant and asks which work orders are over plan; the assistant answers
 * with the work order from the organisation's data.
 *
 * MECHANISM (the same convention as AC-AAN-036 / AC-AGP-023): this environment does not serve the edge runtime
 * (`supabase/config.toml`: `[edge_runtime] enabled = false`) and has no model provider key, so `agent-chat` is
 * intercepted with scripted SSE frames. The answer frame is built from the run's own work-order row read back from
 * Postgres (never a hard-coded fixture string), so the panel is shown answering with the record the data holds; the
 * model's own reasoning is held to the local agent eval harness, not to this browser journey.
 */
import { test, expect } from '@playwright/test';
import { serviceClient, ownProject, dropProject, uniq, ORG_ID, need, runId } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(120_000);

const admin = serviceClient('JOB-A10');
let projectId = '';
let worker: Awaited<ReturnType<typeof roleJobUser>>;

test.afterEach(async () => {
  if (projectId) {
    await admin.from('work_orders').delete().eq('project_id', projectId);
    await dropProject(admin, projectId);
  }
  await worker?.cleanup();
  projectId = '';
});

const sse = (frames: unknown[]) => frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('');

test('JOB-A10 the executive asks which work orders are over plan and the assistant answers', async ({ page }) => {
  const sfx = uniq();
  worker = await roleJobUser(admin, 'executive', runId('a10'));
  projectId = await ownProject(admin, `JOB-A10 project ${sfx}`);
  const workOrder = need('work order', await admin.from('work_orders').insert({
    org_id: ORG_ID, project_id: projectId, title: `Jetty repair ${sfx}`, wo_number: `WO-A10-${sfx}`,
    status: 'Issued', order_value: 75_000, tax_treatment: 'exclusive', tax_amount: 0,
  }).select('id, title, wo_number').single());
  await page.route('**/functions/v1/agent-chat', async (route) => {
    const run = `a10-${Date.now()}`;
    const answer = sse([
      {
        id: `${run}-1`, runId: run, type: 'assistant',
        text: `One work order is over plan: ${workOrder.title} (${workOrder.wo_number}).`,
        createdAt: new Date().toISOString(),
      },
      { id: `${run}-2`, runId: run, type: 'status', payload: { status: 'completed' }, createdAt: new Date().toISOString() },
    ]);
    await route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'Cache-Control': 'no-cache' }, body: answer });
  });

  await worker.signIn(page);
  await page.getByRole('button', { name: 'Assistant' }).click();
  const panel = page.getByTestId('assistant-panel');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  const composer = panel.getByRole('textbox', { name: /ask a question/i });
  await composer.fill('Which work orders are over plan?');
  await composer.press('Enter');

  await expect(panel.getByText(new RegExp(workOrder.title))).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByText(new RegExp(workOrder.wo_number!))).toBeVisible();
});
