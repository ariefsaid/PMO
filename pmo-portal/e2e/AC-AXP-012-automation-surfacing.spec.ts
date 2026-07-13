// @e2e-isolation: read-only — signIn + page.route-mocked agent-chat (automation approval SSE); no DB writes.
/**
 * AC-AXP-012 - recurring phrasing surfaces the automation approval flow.
 *
 * The route is a scripted SSE stub. The test proves the panel renders an
 * approval chip for create_automation instead of reducing the request to prose.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

test.setTimeout(120_000);

function buildSseBody(payloads: unknown[]): string {
  return payloads.map((p) => `data: ${JSON.stringify(p)}\n\n`).join('');
}

const RUN_ID = 'e2e-axp012-run-001';
const PENDING_ID = 'axp012-pending-001';
const HUMAN_SUMMARY = 'Create an automation: every Monday review overdue tasks';

const AUTOMATION_SSE = buildSseBody([
  {
    id: 'evt-axp012-1',
    runId: RUN_ID,
    type: 'status',
    payload: {
      status: 'needs-approval',
      pendingId: PENDING_ID,
      actionName: 'create_automation',
      humanSummary: HUMAN_SUMMARY,
      structuredArgs: {
        kind: 'schedule',
        prompt: 'review overdue tasks',
        schedule: '0 9 * * 1',
      },
    },
    createdAt: new Date().toISOString(),
  },
]);

test('AC-AXP-012 recurring request renders create_automation approval UI', async ({ page }) => {
  const postedBodies: Array<Record<string, unknown>> = [];

  await page.route('**/functions/v1/agent-chat', async (route) => {
    try {
      postedBodies.push(JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>);
    } catch {
      postedBodies.push({});
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
      body: AUTOMATION_SSE,
    });
  });

  await signIn(page, 'admin@acme.test');
  await expect(page.getByRole('button', { name: 'Assistant' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Assistant' }).click();

  const panel = page.getByRole('complementary', { name: /agent assistant/i });
  await expect(panel).toBeVisible({ timeout: 5_000 });

  const composer = panel.getByRole('textbox', { name: /ask a question/i });
  await composer.fill('remind me every Monday to review overdue tasks');
  await composer.press('Enter');

  await expect(panel.getByText(HUMAN_SUMMARY)).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByRole('button', { name: /approve/i })).toBeVisible();
  await expect(panel.getByRole('button', { name: /deny/i })).toBeVisible();
  await expect(panel.getByText(/create_automation/i)).toHaveCount(0);
  expect(postedBodies[0]?.decision).toBeUndefined();
});
