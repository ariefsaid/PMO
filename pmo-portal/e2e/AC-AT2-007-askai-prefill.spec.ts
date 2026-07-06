/**
 * AC-AT2-007 - Cmd+K Ask AI opens the panel pre-filled and does not auto-send.
 *
 * The live model is not exercised here. The agent-chat route is intercepted and
 * counted; selecting the Ask AI palette row must not POST until the user clicks Send.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

test.setTimeout(120_000);

function buildSseBody(payloads: unknown[]): string {
  return payloads.map((p) => `data: ${JSON.stringify(p)}\n\n`).join('');
}

const RUN_ID = 'e2e-at2-007-run-001';
const ASK_AI_SSE = buildSseBody([
  {
    id: 'evt-at2-007-1',
    runId: RUN_ID,
    type: 'assistant',
    text: 'I can help with that.',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'evt-at2-007-2',
    runId: RUN_ID,
    type: 'status',
    payload: { status: 'completed' },
    createdAt: new Date().toISOString(),
  },
]);

test('AC-AT2-007 Ask AI opens panel pre-filled, no auto-send', async ({ page }) => {
  let agentPostCount = 0;
  await page.route('**/functions/v1/agent-chat', async (route) => {
    agentPostCount += 1;
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
      body: ASK_AI_SSE,
    });
  });

  await signIn(page, 'admin@acme.test');
  await expect(page.getByRole('button', { name: 'Assistant' })).toBeVisible({ timeout: 10_000 });

  const query = 'show me vendor concentration risk';
  await page.keyboard.press('Control+k');
  const search = page.getByRole('combobox', { name: /search projects/i });
  await search.fill(query);

  const askAi = page.getByRole('option', { name: /ask ai/i });
  await expect(askAi).toBeVisible({ timeout: 5_000 });
  await askAi.click();

  await expect(page.getByRole('dialog', { name: /command palette/i })).toHaveCount(0);
  const panel = page.getByRole('complementary', { name: /agent assistant/i });
  await expect(panel).toBeVisible({ timeout: 5_000 });
  await expect(panel.getByRole('textbox', { name: /ask a question/i })).toHaveValue(query);
  await expect(panel.getByText(/ask your agent/i)).toBeVisible();
  expect(agentPostCount).toBe(0);

  await panel.getByRole('button', { name: /send message/i }).click();
  await expect(panel.getByText(/I can help with that/i)).toBeVisible({ timeout: 15_000 });
  expect(agentPostCount).toBe(1);
});
