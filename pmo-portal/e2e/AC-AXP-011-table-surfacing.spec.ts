/**
 * AC-AXP-011 - natural tabular phrasing surfaces a typed inline table.
 *
 * The live model is not exercised here. The agent-chat SSE response is scripted
 * so CI proves the rendered surface: a data_table widget becomes a real table,
 * not a markdown pipe table or preformatted text.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

test.setTimeout(120_000);

function buildSseBody(payloads: unknown[]): string {
  return payloads.map((p) => `data: ${JSON.stringify(p)}\n\n`).join('');
}

const RUN_ID = 'e2e-axp011-run-001';

const TABLE_SSE = buildSseBody([
  {
    id: 'evt-axp011-1',
    runId: RUN_ID,
    type: 'assistant',
    text: 'Here are the over-budget projects:',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'evt-axp011-2',
    runId: RUN_ID,
    type: 'artifact',
    payload: {
      kind: 'widget',
      widget: {
        kind: 'data_table',
        columns: [
          { key: 'name', label: 'Project' },
          { key: 'variance', label: 'Variance' },
        ],
        rows: [
          { id: 'p-alpha', name: 'Refinery Expansion Alpha', variance: '$42,000' },
          { id: 'p-beta', name: 'Pipeline Retrofit Beta', variance: '$8,500' },
        ],
        caption: 'Over-budget projects',
      },
    },
    createdAt: new Date().toISOString(),
  },
  {
    id: 'evt-axp011-3',
    runId: RUN_ID,
    type: 'status',
    payload: { status: 'completed' },
    createdAt: new Date().toISOString(),
  },
]);

test('AC-AXP-011 over-budget prompt renders an inline data table widget', async ({ page }) => {
  await page.route('**/functions/v1/agent-chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
      body: TABLE_SSE,
    });
  });

  await signIn(page, 'admin@acme.test');
  await expect(page.getByRole('button', { name: 'Assistant' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Assistant' }).click();

  const panel = page.getByRole('complementary', { name: /agent assistant/i });
  await expect(panel).toBeVisible({ timeout: 5_000 });

  const composer = panel.getByRole('textbox', { name: /ask a question/i });
  await composer.fill('show me over-budget projects');
  await composer.press('Enter');

  const table = panel.getByRole('table');
  await expect(table).toBeVisible({ timeout: 15_000 });
  await expect(table.getByRole('columnheader', { name: 'Project' })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'Refinery Expansion Alpha' })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'Pipeline Retrofit Beta' })).toBeVisible();
  await expect(panel.getByText('| Project |', { exact: false })).toHaveCount(0);
  await expect(panel.locator('pre')).toHaveCount(0);
});
