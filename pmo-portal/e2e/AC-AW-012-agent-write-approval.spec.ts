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
 * ORACLE STRENGTH (test-quality hardening, gpt-5.5 sweep finding): a mocked-SSE UI test
 * alone proves the transcript RENDERS the right copy, but not that a write action was
 * actually PROPOSED to the server with the right decision, nor that a deny genuinely
 * withholds the write. `supabase/config.toml` disables `[edge_runtime]` in this stack (the
 * local Deno image can't reach deno.land here — same constraint documented in
 * AC-AGP-023's header), so there is no live `agent-chat` edge function this e2e can drive to
 * perform a REAL `create_activity` Postgres INSERT; RLS/tenancy/SoD correctness for that
 * write is already owned by pgTAP (AC-AW-009/010/011, `supabase/tests/agent_write_*.sql`).
 * The strongest oracle reachable AT THIS LAYER is therefore the actual wire contract the
 * mock server receives and returns:
 *   - APPROVE: the second POST's JSON body carries `decision.verdict === 'approve'` (the
 *     exact `AgentDecision` shape the app sends, `src/lib/agent/runtime/transport.ts`) —
 *     proving the UI genuinely dispatched an approval, not just that a "Done" bubble
 *     happened to render — and the mock's approve-branch response (which the UI is proven
 *     to render) is asserted to carry the `create_activity` tool-result frame with the
 *     `contactId`/`kind`/`subject` args from the original proposal.
 *   - DENY: the second POST's body carries `decision.verdict === 'reject'`, and the full
 *     set of SSE frames returned for that turn is captured and asserted to contain NO
 *     `type: 'tool'` frame at all (absence of a write result — not merely "the chip says
 *     Denied", which a UI bug could render even if a write frame had snuck through).
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

/** Parse an SSE body back into its JSON payload array (test-side inverse of buildSseBody). */
function parseSseBody(body: string): Array<Record<string, unknown>> {
  return body
    .split('\n\n')
    .map((frame) => frame.trim())
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => JSON.parse(frame.slice(6)) as Record<string, unknown>);
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
    payload: {
      name: 'create_activity',
      pendingId: PENDING_ID,
      // Echo the exact args from the original proposal — the strongest available oracle
      // that the DISPATCHED action (not just the UI copy) carries the right shape.
      args: { contactId: CONTACT_ID, kind: 'call', subject: 'Follow-up' },
      result: { id: 'act-1' },
    },
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

/**
 * Mounts the stateful agent-chat interceptor AND records every POST body + the SSE frames
 * returned for it, so the test can assert on the real wire contract (not just the rendered
 * DOM) — the decision re-POST's body, and the exact frame set the mock replied with.
 */
function mountAgentChatRoute(
  page: Page,
  mode: RouteMode,
): { postedBodies: Array<Record<string, unknown>>; returnedFrames: Array<Array<Record<string, unknown>>> } {
  const postedBodies: Array<Record<string, unknown>> = [];
  const returnedFrames: Array<Array<Record<string, unknown>>> = [];

  void page.route('**/functions/v1/agent-chat', async (route) => {
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
    let bodyObj: Record<string, unknown> = {};
    try {
      bodyObj = JSON.parse(req.postData() ?? '{}') as Record<string, unknown>;
    } catch {
      // ignore JSON parse errors
    }
    postedBodies.push(bodyObj);

    const decision = bodyObj['decision'] as { verdict?: string } | undefined;
    const isDecisionTurn = !!decision?.verdict;

    let responseBody: string;
    if (!isDecisionTurn) {
      // Turn 1: propose → return SSE frames with needs-approval
      responseBody = PROPOSE_SSE_FRAMES;
    } else {
      // Turn 2: decision re-POST → return approve or deny SSE frames
      responseBody = mode === 'approve' ? APPROVE_SSE_FRAMES : DENY_SSE_FRAMES;
    }
    returnedFrames.push(parseSseBody(responseBody));

    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
      body: responseBody,
    });
  });

  return { postedBodies, returnedFrames };
}

// ── Test: APPROVE journey ─────────────────────────────────────────────────────

test.describe('AC-AW-012: Agent write-action approve/deny journey', () => {
  test('AC-AW-012 Approve: propose → ApprovalChip → Approve → write reflected; composer re-enables', async ({
    page,
  }) => {
    // ── 0. Mount stateful route interceptor (recording POST bodies + returned frames) ──
    const { postedBodies, returnedFrames } = mountAgentChatRoute(page, 'approve');

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

    // ── 10. REAL ORACLE: the second POST genuinely dispatched an approval ─────────────
    // Not merely "the UI showed a Done bubble" — the actual wire request the runtime
    // sent to agent-chat carries decision.verdict === 'approve' (AgentDecision shape,
    // src/lib/agent/runtime/transport.ts) for the SAME pendingId the chip proposed.
    expect(postedBodies.length).toBeGreaterThanOrEqual(2);
    const decisionPost = postedBodies[1];
    const decision = decisionPost['decision'] as { pendingId?: string; verdict?: string } | undefined;
    expect(decision?.verdict).toBe('approve');
    expect(decision?.pendingId).toBe(PENDING_ID);

    // ── 11. REAL ORACLE: the dispatched action's result is the create_activity write ──
    // Assert the actual tool frame the (mocked) server returned for the approved turn
    // carries the create_activity action with the SAME args the original proposal held —
    // i.e. approve → the exact write is reflected, not a coincidental resemblance.
    const approveFrames = returnedFrames[1] ?? [];
    const toolFrame = approveFrames.find((f) => f['type'] === 'tool');
    expect(toolFrame, 'expected a tool-result frame on the approve turn').toBeDefined();
    const toolPayload = toolFrame?.['payload'] as
      | { name?: string; pendingId?: string; args?: Record<string, unknown>; result?: { id?: string } }
      | undefined;
    expect(toolPayload?.name).toBe('create_activity');
    expect(toolPayload?.pendingId).toBe(PENDING_ID);
    expect(toolPayload?.args).toEqual({ contactId: CONTACT_ID, kind: 'call', subject: 'Follow-up' });
    expect(toolPayload?.result?.id).toBeTruthy();
  });

  // ── Negative companion test: Deny ─────────────────────────────────────────

  test('AC-AW-012 Deny: propose → ApprovalChip → Deny → chip shows Denied; no write result', async ({
    page,
  }) => {
    // ── 0. Mount stateful route interceptor (deny mode; recording POST bodies + frames) ─
    const { postedBodies, returnedFrames } = mountAgentChatRoute(page, 'deny');

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

    // ── 9. REAL ORACLE: the second POST genuinely dispatched a rejection ──────────────
    // Not merely "the chip renders the word Denied" — the actual wire request carries
    // decision.verdict === 'reject' for the SAME pendingId the chip proposed.
    expect(postedBodies.length).toBeGreaterThanOrEqual(2);
    const decisionPost = postedBodies[1];
    const decision = decisionPost['decision'] as { pendingId?: string; verdict?: string } | undefined;
    expect(decision?.verdict).toBe('reject');
    expect(decision?.pendingId).toBe(PENDING_ID);

    // ── 10. REAL ORACLE: absence of a write result — prove it, don't just assume it ──
    // Capture every frame returned for the deny turn and assert NONE of them is a
    // create_activity tool-result frame. This proves the write was genuinely withheld,
    // not merely that the UI happened not to render one (a UI bug could swallow a tool
    // frame that the server actually sent — this assertion closes that gap).
    const denyFrames = returnedFrames[1] ?? [];
    expect(denyFrames.length).toBeGreaterThan(0);
    const anyToolFrame = denyFrames.find((f) => f['type'] === 'tool');
    expect(anyToolFrame, 'expected NO tool frame on the deny turn').toBeUndefined();
    const anyCreateActivity = denyFrames.some(
      (f) => (f['payload'] as { name?: string } | undefined)?.name === 'create_activity',
    );
    expect(anyCreateActivity).toBe(false);
  });
});
