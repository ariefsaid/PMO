/**
 * AC-ATC-017 — "Show me over-budget projects" renders a real table inline; a
 * clarifying question chip continues the same run. [E2E] (ADR-0045 Verification,
 * the ONE curated cross-stack journey for this spec).
 *
 * Given a signed-in user opens the assistant panel and asks "show me over-budget
 * projects," When the agent's tool call returns a DataTableWidget result, Then a
 * real, sortable DataTable renders inline in the transcript (not a markdown block)
 * — and separately in the same journey, when the agent asks a clarifying question,
 * the user taps an option chip and the SAME run continues to produce a final
 * answer (no new conversation/run is started, no reload required).
 *
 * Mechanism (follows the AC-AR-013 / AC-CV-015 precedent, Director-confirmed):
 *   - The Supabase Edge Function `agent-chat` is intercepted via page.route — NO
 *     live LLM, NO live edge function (AGENT_PERSISTENCE is therefore irrelevant
 *     here — the real function body never executes).
 *   - PmoNativeRuntime issues ONE POST per subscribe() call whose response body
 *     IS the SSE stream (createRun/followUp/control-driven re-POSTs are all
 *     client-side bookkeeping around this one call shape) — see
 *     src/lib/agent/runtime/pmoNativeRuntime.ts `_doSubscribe`.
 *   - The mock branches on the POSTed body: no `answer` field → the FIRST leg
 *     (table widget, then a pending `question` status event, stream ends WITHOUT
 *     a `completed` status so the run stays paused awaiting the answer); body
 *     carries `answer` → the SECOND leg (final assistant text + `completed`).
 *     This proves the "same run continues" goal directly at the wire level: the
 *     continuation SSE is only served once `control(runId, 'answer', …)` posts
 *     the answer back — there is no `createRun` call for the second leg, and the
 *     mock's own two-branch state IS the assertion that no new run was started.
 *
 * Flags required (fast-lane PR→dev, Vite dev server):
 *   VITE_FEATURES_AGENT_ASSISTANT=true
 *
 * Verify parse (no live server needed):
 *   npx playwright test e2e/AC-ATC-017-widget-question-context.spec.ts --list
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

test.setTimeout(120_000);

/** Build an SSE body from an array of JSON payloads. */
function buildSseBody(payloads: unknown[]): string {
  return payloads.map((p) => `data: ${JSON.stringify(p)}\n\n`).join('');
}

const RUN_ID = 'e2e-atc017-run-001';
const QUESTION_ID = 'q-atc017-001';

// ── Leg 1: user asks "show me over-budget projects" ──────────────────────────
// tool call → DataTableWidget artifact → a clarifying `question` status event.
// The stream ends WITHOUT a `completed` status: the run is paused awaiting the
// answer (mirrors the A3 needs-approval pause the runtime already round-trips).
const LEG1_FRAMES = buildSseBody([
  {
    id: 'evt-1',
    runId: RUN_ID,
    type: 'tool',
    payload: { entity: 'projects', rowCount: 2 },
    createdAt: new Date().toISOString(),
  },
  {
    id: 'evt-2',
    runId: RUN_ID,
    type: 'assistant',
    text: 'Here are your over-budget projects:',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'evt-3',
    runId: RUN_ID,
    type: 'artifact',
    payload: {
      kind: 'widget',
      widget: {
        kind: 'data_table',
        columns: [
          { key: 'name', label: 'Project' },
          { key: 'overage', label: 'Overage' },
        ],
        rows: [
          { id: 'p1', name: 'Refinery Expansion Alpha', overage: '$42,000' },
          { id: 'p2', name: 'Pipeline Retrofit Beta', overage: '$8,500' },
        ],
        caption: 'Over-budget projects',
      },
    },
    createdAt: new Date().toISOString(),
  },
  {
    id: 'evt-4',
    runId: RUN_ID,
    type: 'status',
    payload: {
      kind: 'question',
      questionId: QUESTION_ID,
      prompt: 'Would you like to see this by region or by client?',
      options: [
        { id: 'region', label: 'By region' },
        { id: 'client', label: 'By client' },
      ],
    },
    createdAt: new Date().toISOString(),
  },
]);

// ── Leg 2: the answer re-POST continues the SAME run to a final answer ───────
const LEG2_FRAMES = buildSseBody([
  {
    id: 'evt-5',
    runId: RUN_ID,
    type: 'assistant',
    text: 'Grouped by region: 1 project in the Gulf Coast region, 1 project in the Permian Basin region.',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'evt-6',
    runId: RUN_ID,
    type: 'status',
    payload: { status: 'completed' },
    createdAt: new Date().toISOString(),
  },
]);

test.describe('AC-ATC-017: widget + question + context journey', () => {
  test('AC-ATC-017 over-budget table renders inline, question chip continues run', async ({
    page,
  }) => {
    // Track every createRun/followUp-shaped POST body so we can assert the
    // continuation happened on the SAME run: exactly one POST carries the
    // `answer` field, exactly one does not, and both carry runId === RUN_ID
    // once the run is established (no second run is ever created).
    const postedBodies: Array<{ runId?: string; answer?: unknown }> = [];

    await page.route('**/functions/v1/agent-chat', async (route) => {
      const req = route.request();
      const bodyText = req.postData() ?? '{}';
      let parsed: { runId?: string; answer?: { questionId?: string; optionId?: string } };
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        parsed = {};
      }
      postedBodies.push(parsed);

      const isAnswerLeg = parsed.answer !== undefined;

      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        body: isAnswerLeg ? LEG2_FRAMES : LEG1_FRAMES,
      });
    });

    // ── 1. Authenticate ───────────────────────────────────────────────────────
    await signIn(page, 'admin@acme.test');

    await expect(page.getByRole('button', { name: 'Assistant' })).toBeVisible({ timeout: 10_000 });

    // ── 2. Open the AssistantPanel ────────────────────────────────────────────
    await page.getByRole('button', { name: 'Assistant' }).click();

    const panel = page.getByRole('complementary', { name: /agent assistant/i });
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // ── 3. Ask "show me over-budget projects" ─────────────────────────────────
    const composer = panel.getByRole('textbox', { name: /ask a question/i });
    await expect(composer).toBeVisible();
    await composer.fill('show me over-budget projects');
    await composer.press('Enter');

    await expect(
      panel.getByRole('button', { name: /stop generating/i }),
    ).toBeVisible({ timeout: 10_000 });

    // ── GOAL 1: a real, rendered DataTable — not a markdown/pre block ─────────
    // getByRole('table') only matches a real <table> element (DataTable's desktop
    // branch); a markdown wall-of-pipes would render as <pre>/plain text and
    // would NOT satisfy this role query — this is the load-bearing assertion
    // that distinguishes "typed widget" from the legacy markdown fallback.
    const table = panel.getByRole('table');
    await expect(table).toBeVisible({ timeout: 15_000 });
    await expect(table.getByRole('cell', { name: 'Refinery Expansion Alpha' })).toBeVisible();
    await expect(table.getByRole('cell', { name: 'Pipeline Retrofit Beta' })).toBeVisible();
    // Sortable: the DataTable renders real <th> column headers (not markdown table syntax).
    await expect(table.getByRole('columnheader', { name: 'Project' })).toBeVisible();

    // No markdown wall-of-pipes anywhere in the transcript (the legacy fallback
    // this contract replaces) — a real widget render must not ALSO leak the raw
    // pipe-table text the agent would have produced pre-ADR-0045.
    await expect(panel.getByText('| Project |', { exact: false })).toHaveCount(0);

    // ── GOAL 2 setup: the clarifying question renders as chips ────────────────
    const questionGroup = panel.getByRole('group', {
      name: /would you like to see this by region or by client/i,
    });
    await expect(questionGroup).toBeVisible({ timeout: 15_000 });
    const regionChip = questionGroup.getByRole('button', { name: 'By region' });
    await expect(regionChip).toBeVisible();

    // Exactly one POST has fired so far (leg 1) — the run is paused awaiting
    // the answer, not yet resolved to a second run. `runId` is minted
    // CLIENT-SIDE by PmoNativeRuntime.createRun (crypto.randomUUID()) — the
    // mock's own RUN_ID only labels the SSE events echoed back, so the real
    // "same run" oracle is: capture the client-minted runId from leg 1's own
    // POST and assert leg 2's POST carries the IDENTICAL value (not a
    // hardcoded constant, not a fresh id from a second createRun call).
    expect(postedBodies.length).toBe(1);
    expect(postedBodies[0].answer).toBeUndefined();
    const establishedRunId = postedBodies[0].runId;
    expect(establishedRunId).toBeTruthy();

    // ── 4. Tap the "By region" chip ───────────────────────────────────────────
    await regionChip.click();

    // ── GOAL 2: the SAME run continues — the answer re-POST carries the SAME
    //    runId established by leg 1, and no `createRun` (no fresh run, no
    //    reload) occurs; the final answer appends to the existing transcript. ──
    await expect
      .poll(() => postedBodies.length, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(2);
    const answerPost = postedBodies[postedBodies.length - 1];
    expect(answerPost.answer).toMatchObject({ questionId: QUESTION_ID, optionId: 'region' });
    expect(answerPost.runId).toBe(establishedRunId);

    // The final assistant answer appears — appended into the SAME transcript,
    // not a fresh/empty panel (no reload, no new conversation).
    await expect(panel.getByText(/grouped by region/i)).toBeVisible({ timeout: 15_000 });

    // The original table + question chips are STILL present in the transcript
    // (proof the run continued in place rather than the panel resetting).
    await expect(table).toBeVisible();
    await expect(questionGroup).toBeVisible();

    // Composer re-enables after the continuation completes.
    await expect(
      panel.getByRole('button', { name: /send message/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      panel.getByRole('button', { name: /stop generating/i }),
    ).not.toBeVisible();
  });
});
