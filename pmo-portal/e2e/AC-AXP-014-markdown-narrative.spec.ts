/**
 * AC-AXP-014 - narrative answers render as safe markdown, not literal syntax.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

test.setTimeout(120_000);

function buildSseBody(payloads: unknown[]): string {
  return payloads.map((p) => `data: ${JSON.stringify(p)}\n\n`).join('');
}

const RUN_ID = 'e2e-axp014-run-001';

const MARKDOWN_SSE = buildSseBody([
  {
    id: 'evt-axp014-1',
    runId: RUN_ID,
    type: 'assistant',
    text: [
      '## Procurement approvals',
      '',
      '**For your role:** you may review requests that are assigned to you.',
      '',
      '- Check budget impact.',
      '- Confirm separation of duties.',
    ].join('\n'),
    createdAt: new Date().toISOString(),
  },
  {
    id: 'evt-axp014-2',
    runId: RUN_ID,
    type: 'status',
    payload: { status: 'completed' },
    createdAt: new Date().toISOString(),
  },
]);

test('AC-AXP-014 narrative answer renders formatted markdown', async ({ page }) => {
  await page.route('**/functions/v1/agent-chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
      body: MARKDOWN_SSE,
    });
  });

  await signIn(page, 'admin@acme.test');
  await expect(page.getByRole('button', { name: 'Assistant' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Assistant' }).click();

  const panel = page.getByRole('complementary', { name: /agent assistant/i });
  await expect(panel).toBeVisible({ timeout: 5_000 });

  const composer = panel.getByRole('textbox', { name: /ask a question/i });
  await composer.fill('explain how procurement approvals work for my role');
  await composer.press('Enter');

  await expect(panel.getByRole('heading', { name: 'Procurement approvals' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(panel.locator('strong', { hasText: 'For your role:' })).toBeVisible();
  await expect(panel.getByRole('listitem', { name: /check budget impact/i })).toBeVisible();
  await expect(panel.getByText('**For your role:**', { exact: false })).toHaveCount(0);
});
