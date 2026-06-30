/**
 * AC-AR-013 — AssistantPanel curated journey (ADR-0040 Option A, A2).
 *
 * Curated E2E journey (ADR-0010 — one curated journey per cross-stack AC):
 *   login → ⌘J opens panel → empty state visible → type + Enter → composer disabled
 *   while streaming → tool-card "Looked up projects" → assistant answer streams →
 *   composer re-enables → ⌘J closes panel.
 *
 * The Supabase Edge Function `agent-chat` is intercepted via page.route — NO live LLM.
 * The mock returns four SSE frames that exercise the full happy path:
 *   1. user echo (optional, proves the protocol)
 *   2. tool event with entity='projects', rowCount=5
 *   3. assistant event with the answer text
 *   4. status completed
 *
 * Flags required in CI env (fast-lane PR→dev, Vite dev server):
 *   VITE_FEATURES_AGENT_ASSISTANT=true
 *
 * NOT run locally without a dev server + seeded auth. Confirm parse with:
 *   npx playwright test e2e/AC-AR-013-assistant-panel-journey.spec.ts --list
 *
 * Platform note: Linux CI uses Ctrl+J (Control+j) since Meta is not available;
 * Playwright's ControlOrMeta maps to Control on Linux and Meta on macOS/Windows.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

test.setTimeout(120_000);

/** Build an SSE body from an array of JSON payloads. */
function buildSseBody(payloads: unknown[]): string {
  return payloads
    .map((p) => `data: ${JSON.stringify(p)}\n\n`)
    .join('');
}

const RUN_ID = 'e2e-test-run-001';

const SSE_FRAMES = buildSseBody([
  // Frame 1: tool call — the agent looked up projects
  {
    id: 'evt-1',
    runId: RUN_ID,
    type: 'tool',
    payload: { entity: 'projects', rowCount: 5 },
    createdAt: new Date().toISOString(),
  },
  // Frame 2: assistant answer
  {
    id: 'evt-2',
    runId: RUN_ID,
    type: 'assistant',
    text: 'You have 5 active projects.',
    createdAt: new Date().toISOString(),
  },
  // Frame 3: completed status
  {
    id: 'evt-3',
    runId: RUN_ID,
    type: 'status',
    payload: { status: 'completed' },
    createdAt: new Date().toISOString(),
  },
]);

test.describe('AC-AR-013: AssistantPanel journey', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept agent-chat SSE calls before any navigation.
    // The mock returns the pre-scripted SSE frames; no live Anthropic call is made.
    await page.route('**/functions/v1/agent-chat', async (route) => {
      // PmoNativeRuntime uses a SINGLE POST whose RESPONSE BODY is the SSE stream
      // (createRun + followUp are client-side only; the one network call is the
      // subscribe POST in _doSubscribe, read via fetch + getReader → decodeSseStream).
      // So the POST must be fulfilled with text/event-stream, NOT a JSON run object —
      // returning JSON here makes decodeSseStream yield a bogus event and the tool /
      // assistant / completed frames never arrive (the failure the integration gate
      // caught). The GET branch is defensive only; it is never exercised by the adapter.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: {
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
        body: SSE_FRAMES,
      });
    });
  });

  test('AC-AR-013 open the assistant, ask a question, see the streamed answer', async ({
    page,
  }) => {
    // ── 1. Authenticate ───────────────────────────────────────────────────────
    await signIn(page, 'admin@acme.test');

    // Ensure the shell + ⌘J hotkey listener are mounted before pressing — the
    // listener attaches in a useEffect, so pressing too early misses it. The Rail
    // "Assistant" toggle renders only once the shell is mounted with the flag on.
    await expect(page.getByRole('button', { name: 'Assistant' })).toBeVisible({ timeout: 10_000 });

    // ── 2. Open the AssistantPanel via ⌘J / Ctrl+J ───────────────────────────
    // On Linux CI, ControlOrMeta resolves to Control.
    await page.keyboard.press('Control+j');

    // The complementary landmark should become visible (not inert).
    const panel = page.getByRole('complementary', { name: /agent assistant/i });
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // ── 3. Empty state visible ────────────────────────────────────────────────
    await expect(panel.getByText(/ask your agent/i)).toBeVisible({ timeout: 5_000 });

    // ── 4. Type a question and press Enter ────────────────────────────────────
    const composer = panel.getByRole('textbox', { name: /ask a question/i });
    await expect(composer).toBeVisible();
    await composer.fill('How many active projects do I have?');
    await composer.press('Enter');

    // ── 5. Composer disabled while streaming (Stop button appears) ────────────
    // The Send button becomes Stop while a run is in flight.
    await expect(
      panel.getByRole('button', { name: /stop generating/i }),
    ).toBeVisible({ timeout: 10_000 });

    // ── 6. Tool-call card "Looked up projects" appears ────────────────────────
    await expect(panel.getByText(/Looked up projects/i)).toBeVisible({ timeout: 15_000 });

    // ── 7. Assistant answer streams in ────────────────────────────────────────
    await expect(panel.getByText(/5 active projects/i)).toBeVisible({ timeout: 15_000 });

    // ── 8. Composer re-enables after completion ───────────────────────────────
    await expect(
      panel.getByRole('button', { name: /send message/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      panel.getByRole('button', { name: /stop generating/i }),
    ).not.toBeVisible();

    // ── 9. Close the panel via ⌘J / Ctrl+J again ─────────────────────────────
    await page.keyboard.press('Control+j');

    // The panel should become inert / not visible to AT after close.
    // (The DOM node stays mounted — keep-mounted D-A2-6 — but inert.)
    await expect(panel).not.toBeVisible({ timeout: 5_000 });
  });
});
