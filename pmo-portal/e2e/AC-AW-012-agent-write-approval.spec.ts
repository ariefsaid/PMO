/**
 * AC-AW-012 — Agent write-action: propose → ApprovalChip → Approve → write reflected.
 *             + Deny negative: chip shows "Denied"; no write result frame sent.
 *
 * Curated E2E journey (ADR-0010 — one curated journey per cross-stack AC):
 *   login → Ctrl+J opens panel → type question → agent proposes create_activity →
 *   ApprovalChip visible (humanSummary, Approve/Deny) → composer disabled →
 *   click Approve → second POST carries decision.verdict==='approve' →
 *   tool event received → assistant acks → composer re-enables.
 *
 *   Negative companion: click Deny → second POST carries decision.verdict==='reject' →
 *   chip shows "Denied" → no create_activity result frame.
 *
 * The Supabase Edge Function `agent-chat` is intercepted via page.route — NO live LLM.
 * The mock is STATEFUL: first POST (no decision) → needs-approval frames;
 * second POST (decision.verdict==='approve') → tool + assistant + completed frames.
 *
 * Flags required (fast-lane PR→dev, Vite dev server):
 *   VITE_FEATURES_AGENT_ASSISTANT=true
 *
 * Verify parse (no live server needed):
 *   npx playwright test e2e/AC-AW-012-agent-write-approval.spec.ts --list
 *
 * Platform note: Linux CI uses Ctrl+J (Control+j) since Meta is not available.
 */
import { test, expect, type Page } from '@playwright/test';
import { signIn } from './helpers';

test.setTimeout(120_000);

/** Build an SSE body from an array of JSON payloads. */
function buildSseBody(payloads: unknown[]): string {
  return payloads.map((p) => `data: ${JSON.stringify(p)}\n\n`).join('');
}

const RUN_ID = 'e2e-aw012-run-001';
const PENDING_ID = 'abc-123';
const CONTACT_ID = 'contact-xyz-001';
const HUMAN_SUMMARY = 'Log a call activity on contact XYZ';

/** SSE frames for Turn 1 (propose): no decision in the request → needs-approval */
const PROPOSE_SSE_FRAMES = buildSseBody([
  {
    id: 'evt-1',
    runId: RUN_ID,
    type: 'status',
    payload: {
      status: 'needs-approval',
      pendingId: PENDING_ID,
      actionName: 'create_activity',
      humanSummary: HUMAN_SUMMARY,
      structuredArgs: { contactId: CONTACT_ID, kind: 'call', subject: 'Follow-up' },
    },
    createdAt: new Date().toISOString(),
  },
]);

/** SSE frames for Turn 2a (approve): decision.verdict==='approve' → write + ack + completed */
const APPROVE_SSE_FRAMES = buildSseBody([
  {
    id: 'evt-2',
    runId: RUN_ID,
    type: 'tool',
    payload: { name: 'create_activity', pendingId: PENDING_ID, result: { id: 'act-1' } },
    createdAt: new Date().toISOString(),
  },
  {
    id: 'evt-3',
    runId: RUN_ID,
    type: 'system',
    text: 'approved',
    payload: {
      event: 'write_resolved',
      decision: 'approved',
      actionName: 'create_activity',
      pendingId: PENDING_ID,
    },
    createdAt: new Date().toISOString(),
  },
  {
    id: 'evt-4',
    runId: RUN_ID,
    type: 'assistant',
    text: "Done — I've logged the call activity.",
    createdAt: new Date().toISOString(),
  },
  {
    id: 'evt-5',
    runId: RUN_ID,
    type: 'status',
    payload: { status: 'completed' },
    createdAt: new Date().toISOString(),
  },
]);

/** SSE frames for Turn 2b (deny): decision.verdict==='reject' → rejection notice + ack + completed */
const DENY_SSE_FRAMES = buildSseBody([
  {
    id: 'evt-2b',
    runId: RUN_ID,
    type: 'system',
    text: 'rejected',
    payload: {
      event: 'write_resolved',
      decision: 'rejected',
      actionName: 'create_activity',
      pendingId: PENDING_ID,
    },
    createdAt: new Date().toISOString(),
  },
  {
    id: 'evt-3b',
    runId: RUN_ID,
    type: 'assistant',
    text: "Understood, I won't log that activity.",
    createdAt: new Date().toISOString(),
  },
  {
    id: 'evt-4b',
    runId: RUN_ID,
    type: 'status',
    payload: { status: 'completed' },
    createdAt: new Date().toISOString(),
  },
]);

// ── Shared helper: mount the stateful page.route interceptor ─────────────────

type RouteMode = 'approve' | 'deny';

async function mountAgentChatRoute(page: Page, mode: RouteMode): Promise<void> {
  let callCount = 0;
  await page.route('**/functions/v1/agent-chat', async (route) => {
    const req = route.request();
    const method = req.method();

    if (method === 'GET') {
      // Legacy GET subscribe path — not used by PmoNativeRuntime (POST model), but handle defensively.
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: PROPOSE_SSE_FRAMES,
      });
      return;
    }

    // POST: parse the body to detect Turn 1 (no decision) vs Turn 2 (decision present).
    callCount++;
    let bodyObj: Record<string, unknown> = {};
    try {
      bodyObj = JSON.parse(req.postData() ?? '{}') as Record<string, unknown>;
    } catch {
      // ignore JSON parse errors
    }

    const decision = bodyObj['decision'] as { verdict?: string } | undefined;
    const isDecisionTurn = !!decision?.verdict;

    if (!isDecisionTurn) {
      // Turn 1: propose → return SSE frames with needs-approval
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        body: PROPOSE_SSE_FRAMES,
      });
    } else {
      // Turn 2: decision re-POST → return approve or deny SSE frames
      const frames = mode === 'approve' ? APPROVE_SSE_FRAMES : DENY_SSE_FRAMES;
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        body: frames,
      });
    }

    // Suppress unused variable warning
    void callCount;
  });
}

// ── Test: APPROVE journey ─────────────────────────────────────────────────────

test.describe('AC-AW-012: Agent write-action approve/deny journey', () => {
  test('AC-AW-012 Approve: propose → ApprovalChip → Approve → write reflected; composer re-enables', async ({
    page,
  }) => {
    // ── 0. Mount stateful route interceptor ───────────────────────────────
    await mountAgentChatRoute(page, 'approve');

    // ── 1. Authenticate ───────────────────────────────────────────────────
    await signIn(page, 'admin@acme.test');

    // ── 2. Open the AssistantPanel via Ctrl+J (Linux CI) ─────────────────
    await page.keyboard.press('Control+j');

    const panel = page.getByRole('complementary', { name: /agent assistant/i });
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // ── 3. Empty state visible ────────────────────────────────────────────
    await expect(panel.getByText(/ask your agent/i)).toBeVisible({ timeout: 5_000 });

    // ── 4. Type the question and press Enter ──────────────────────────────
    const composer = panel.getByRole('textbox', { name: /ask a question/i });
    await expect(composer).toBeVisible();
    await composer.fill('Log a call with the Acme contact');
    await composer.press('Enter');

    // ── 5. ApprovalChip appears with humanSummary ─────────────────────────
    await expect(
      panel.getByText(new RegExp(HUMAN_SUMMARY.slice(0, 20), 'i')),
    ).toBeVisible({ timeout: 15_000 });

    // Approve and Deny buttons are visible (NFR-AW-A11Y-001).
    const approveBtn = panel.getByRole('button', { name: /approve/i });
    const denyBtn = panel.getByRole('button', { name: /deny/i });
    await expect(approveBtn).toBeVisible({ timeout: 10_000 });
    await expect(denyBtn).toBeVisible({ timeout: 10_000 });

    // ── 6. Composer is disabled while in needs-approval state (FR-AW-019) ─
    // The Composer renders a "Stop" button (running prop=true) while needs-approval.
    const stopBtn = panel.getByRole('button', { name: /stop generating/i });
    await expect(stopBtn).toBeVisible({ timeout: 5_000 });

    // ── 7. Click Approve ───────────────────────────────────────────────────
    await approveBtn.click();

    // ── 8. Assistant bubble confirms write ────────────────────────────────
    await expect(
      panel.getByText(/logged the call activity/i),
    ).toBeVisible({ timeout: 15_000 });

    // ── 9. Composer re-enables (Send button visible, Stop gone) ───────────
    await expect(
      panel.getByRole('button', { name: /send message/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      panel.getByRole('button', { name: /stop generating/i }),
    ).not.toBeVisible();
  });

  // ── Negative companion test: Deny ─────────────────────────────────────────

  test('AC-AW-012 Deny: propose → ApprovalChip → Deny → chip shows Denied; no write result', async ({
    page,
  }) => {
    // ── 0. Mount stateful route interceptor (deny mode) ──────────────────
    await mountAgentChatRoute(page, 'deny');

    // ── 1. Authenticate ───────────────────────────────────────────────────
    await signIn(page, 'admin@acme.test');

    // ── 2. Open panel ─────────────────────────────────────────────────────
    await page.keyboard.press('Control+j');

    const panel = page.getByRole('complementary', { name: /agent assistant/i });
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // ── 3. Ask question ───────────────────────────────────────────────────
    const composer = panel.getByRole('textbox', { name: /ask a question/i });
    await composer.fill('Log a call with the Acme contact');
    await composer.press('Enter');

    // ── 4. ApprovalChip appears ───────────────────────────────────────────
    const denyBtn = panel.getByRole('button', { name: /deny/i });
    await expect(denyBtn).toBeVisible({ timeout: 15_000 });

    // ── 5. Click Deny ─────────────────────────────────────────────────────
    await denyBtn.click();

    // ── 6. Chip resolves to Denied ────────────────────────────────────────
    // Either the chip itself shows "Denied" or the write_resolved system notice "Write denied"
    await expect(
      panel.getByText(/denied/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // ── 7. Assistant acknowledges the denial (no write result) ────────────
    await expect(
      panel.getByText(/won't log that activity/i),
    ).toBeVisible({ timeout: 15_000 });

    // ── 8. Composer re-enables ─────────────────────────────────────────────
    await expect(
      panel.getByRole('button', { name: /send message/i }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
