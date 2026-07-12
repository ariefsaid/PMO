// @e2e-isolation: read-only — signIn + page.route-mocked agent-chat (ask_user chips, 2 legs same RUN_ID); no DB writes.
/**
 * AC-AXP-013 - ambiguous phrasing surfaces ask_user chips and continues in place.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

test.setTimeout(120_000);

function buildSseBody(payloads: unknown[]): string {
  return payloads.map((p) => `data: ${JSON.stringify(p)}\n\n`).join('');
}

const RUN_ID = 'e2e-axp013-run-001';
const QUESTION_ID = 'q-axp013-001';

const QUESTION_SSE = buildSseBody([
  {
    id: 'evt-axp013-1',
    runId: RUN_ID,
    type: 'status',
    payload: {
      kind: 'question',
      questionId: QUESTION_ID,
      prompt: 'Which project set should I show?',
      options: [
        { id: 'active', label: 'Active projects' },
        { id: 'at-risk', label: 'At-risk projects' },
      ],
    },
    createdAt: new Date().toISOString(),
  },
]);

const ANSWER_SSE = buildSseBody([
  {
    id: 'evt-axp013-2',
    runId: RUN_ID,
    type: 'assistant',
    text: 'Showing active projects.',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'evt-axp013-3',
    runId: RUN_ID,
    type: 'status',
    payload: { status: 'completed' },
    createdAt: new Date().toISOString(),
  },
]);

test('AC-AXP-013 ambiguous project request renders ask_user chips and continues same run', async ({ page }) => {
  const postedBodies: Array<{ runId?: string; answer?: { questionId?: string; optionId?: string } }> = [];

  await page.route('**/functions/v1/agent-chat', async (route) => {
    let body: { runId?: string; answer?: { questionId?: string; optionId?: string } };
    try {
      body = JSON.parse(route.request().postData() ?? '{}');
    } catch {
      body = {};
    }
    postedBodies.push(body);

    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
      body: body.answer ? ANSWER_SSE : QUESTION_SSE,
    });
  });

  await signIn(page, 'admin@acme.test');
  await expect(page.getByRole('button', { name: 'Assistant' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Assistant' }).click();

  const panel = page.getByRole('complementary', { name: /agent assistant/i });
  await expect(panel).toBeVisible({ timeout: 5_000 });

  const composer = panel.getByRole('textbox', { name: /ask a question/i });
  await composer.fill('show my projects');
  await composer.press('Enter');

  const questionGroup = panel.getByRole('group', { name: /which project set should i show/i });
  await expect(questionGroup).toBeVisible({ timeout: 15_000 });
  const establishedRunId = postedBodies[0]?.runId;
  expect(establishedRunId).toBeTruthy();

  await questionGroup.getByRole('button', { name: 'Active projects' }).click();

  await expect.poll(() => postedBodies.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  const answerPost = postedBodies[postedBodies.length - 1];
  expect(answerPost.runId).toBe(establishedRunId);
  expect(answerPost.answer).toMatchObject({ questionId: QUESTION_ID, optionId: 'active' });
  await expect(panel.getByText(/showing active projects/i)).toBeVisible({ timeout: 15_000 });
  await expect(questionGroup).toBeVisible();
});
