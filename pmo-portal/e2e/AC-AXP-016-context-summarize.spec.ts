// @e2e-isolation: read-only — signIn + page.route-mocked agent-chat (summary SSE + context assertion); no DB writes.
/**
 * AC-AXP-016 - "summarize this" on a project detail page carries route entity context.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

test.setTimeout(120_000);

function buildSseBody(payloads: unknown[]): string {
  return payloads.map((p) => `data: ${JSON.stringify(p)}\n\n`).join('');
}

const PROJECT_ID = '40000000-0000-0000-0000-000000000001';
const RUN_ID = 'e2e-axp016-run-001';

const SUMMARY_SSE = buildSseBody([
  {
    id: 'evt-axp016-1',
    runId: RUN_ID,
    type: 'assistant',
    text: 'Summary for this project: procurement and budget signals are available.',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'evt-axp016-2',
    runId: RUN_ID,
    type: 'status',
    payload: { status: 'completed' },
    createdAt: new Date().toISOString(),
  },
]);

test('AC-AXP-016 summarize this grounds to the viewed project context', async ({ page }) => {
  const postedBodies: Array<{ context?: { entity?: { type?: string; id?: string; label?: string } } }> = [];

  await page.route('**/functions/v1/agent-chat', async (route) => {
    try {
      postedBodies.push(JSON.parse(route.request().postData() ?? '{}'));
    } catch {
      postedBodies.push({});
    }

    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
      body: SUMMARY_SSE,
    });
  });

  await signIn(page, 'admin@acme.test');
  await page.goto(`/projects/${PROJECT_ID}`);
  await expect(page.getByRole('button', { name: 'Assistant' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Innovate Corp/i).first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Assistant' }).click();
  const panel = page.getByRole('complementary', { name: /agent assistant/i });
  await expect(panel).toBeVisible({ timeout: 5_000 });

  const composer = panel.getByRole('textbox', { name: /ask a question/i });
  await composer.fill('summarize this');
  await composer.press('Enter');

  await expect(panel.getByText(/summary for this project/i)).toBeVisible({ timeout: 15_000 });

  await expect.poll(() => postedBodies.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  const entity = postedBodies[0]?.context?.entity;
  expect(entity).toMatchObject({
    type: 'project',
    id: PROJECT_ID,
  });
  expect(entity?.label).toMatch(/Innovate Corp/i);
});
