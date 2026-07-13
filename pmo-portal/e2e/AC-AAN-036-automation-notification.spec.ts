// @e2e-isolation: self-isolated — page.route-mocked agent-chat (create_automation propose→approve); service-role seeds automations/runs/events/notifications for admin@acme.test in beforeAll; afterAll cleanup; cross-user isolation asserted.
/**
 * AC-AAN-036 — Create a scheduled automation via chat, a simulated fire produces a run + an
 * in-app notification; a second user never sees it (ADR-0044 Verification, the ONE curated e2e).
 *
 * Given a signed-in user asks the assistant to create a scheduled automation and approves the
 * resulting chip,
 * When the automation appears in the chat-surfaced confirmation and a simulated dispatcher fire
 * runs against it,
 * Then a new run is created under the automation's owner and an in-app notification appears — the
 * bell's unread badge increments — and when a second user signs in, they see no trace of the first
 * user's automation or notification.
 *
 * MECHANISM (binding note, mirrors AC-AGP-023 / AC-VR-020 precedent — the edge runtime does not run
 * in this environment, `docs/environments.md` "Edge Functions": `[edge_runtime] enabled = false`):
 * `agent-chat` is intercepted via `page.route` with scripted SSE frames for the LIVE conversation
 * leg (propose → needs-approval → Approve). A mocked SSE response never reaches Postgres, so the
 * real `create_automation` write and the real `agent-dispatch` pg_cron/edge-fn tick cannot execute
 * here either. To prove the Then leg for real (not weakened to "elements exist"):
 *   1. After driving the chat-create UI journey (proving the propose→approve chip Given), we seed
 *      the `agent_automations` row via a service-role client (test-only, never used by the app) —
 *      exactly what the real `create_automation` write (dispatchActionForced under the caller JWT)
 *      would have produced: same owner (the signed-in user's real profile id/org_id, resolved
 *      live), `kind='schedule'`, the same prompt/schedule the chat turn proposed.
 *   2. We then simulate ONE dispatcher tick's fire outcome for that automation by seeding the exact
 *      rows `runDispatchTick`'s mint → auditMint → fireAutomation → `notify` sequence would have
 *      produced (ADR-0044 §2/§3/§5): an `agent_threads` + `agent_runs` row (the fired run), an
 *      `agent_events` type='system' audit event (FR-AAN-019), and a `notifications` row via `notify`
 *      (FR-AAN-026/028) — all under the SAME owner, mirroring the minted-owner-client write shape
 *      (never service_role business-data writes at the app layer; the seed uses service_role only
 *      as the test's own out-of-band fixture mechanism, identical to AC-AGP-023).
 * The bell/inbox step then exercises the REAL `listUnreadCount`/`listNotifications`/
 * `markNotificationRead` DAL against REAL Postgres + REAL owner-only RLS (0048 migration) — the
 * actual goal-oracle (badge increments; cross-user denial) is proven against the real backend.
 *
 * Requires: VITE_FEATURES_AGENT_ASSISTANT=true (Vite/SPA flag) and
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_ANON_KEY in the process env.
 *
 * Runs in: CI `integration` job (PR→main), flag-gated.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signIn } from './helpers';

test.setTimeout(120_000);

const SERVICE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';

const ANN_EMAIL = 'admin@acme.test';
const BOB_EMAIL = 'engineer@acme.test';

const RUN_ID = 'e2e-aan036-run-001';
const PENDING_ID = 'aan036-pending-1';
const AUTOMATION_PROMPT = 'summarize my overdue tasks';
const AUTOMATION_SCHEDULE = '0 8 * * 1-5';
const HUMAN_SUMMARY = `Watch: ${AUTOMATION_PROMPT} (on schedule ${AUTOMATION_SCHEDULE})`;
const NOTIFICATION_TITLE = 'Automation finished — overdue tasks summary';

/** Build an SSE body from an array of JSON payloads (same helper as AC-AR-013/AC-AW-012). */
function buildSseBody(payloads: unknown[]): string {
  return payloads.map((p) => `data: ${JSON.stringify(p)}\n\n`).join('');
}

const PROPOSE_SSE_FRAMES = buildSseBody([
  {
    id: 'evt-aan036-1',
    runId: RUN_ID,
    type: 'status',
    payload: {
      status: 'needs-approval',
      pendingId: PENDING_ID,
      actionName: 'create_automation',
      humanSummary: HUMAN_SUMMARY,
      structuredArgs: { kind: 'schedule', prompt: AUTOMATION_PROMPT, schedule: AUTOMATION_SCHEDULE },
    },
    createdAt: new Date().toISOString(),
  },
]);

const APPROVE_SSE_FRAMES = buildSseBody([
  {
    id: 'evt-aan036-2',
    runId: RUN_ID,
    type: 'assistant',
    text: `Done — I'll watch for that and summarize your overdue tasks every weekday at 8am.`,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'evt-aan036-3',
    runId: RUN_ID,
    type: 'status',
    payload: { status: 'completed' },
    createdAt: new Date().toISOString(),
  },
]);

// IDs the journey (test body) fills in and afterEach cleans up.
let annAutomationId: string | null = null;
let annThreadId: string | null = null;
let annRunId: string | null = null;
let annNotificationId: string | null = null;

// afterEACH (not afterAll): the notification/thread/automation are inserted IN THE TEST BODY, so
// cleanup must run per-attempt. Playwright does NOT re-run afterAll between retries — with afterAll,
// a retry after any post-insert failure would leave the prior notification behind and the second
// insert would make `getByText(NOTIFICATION_TITLE)` match 2 rows (strict-mode violation → the retry
// fails deterministically too). Per-attempt cleanup + id reset keeps every attempt (and --repeat-each)
// starting clean.
test.afterEach(async () => {
  if (!SERVICE_KEY) return;
  const admin = createClient(SERVICE_URL, SERVICE_KEY);
  if (annNotificationId) await admin.from('notifications').delete().eq('id', annNotificationId);
  if (annThreadId) await admin.from('agent_threads').delete().eq('id', annThreadId); // cascades runs/events
  if (annAutomationId) await admin.from('agent_automations').delete().eq('id', annAutomationId);
  annNotificationId = annThreadId = annRunId = annAutomationId = null;
});

test.describe('AC-AAN-036: create automation, simulated fire, notification, second user cannot see', () => {
  test('AC-AAN-036 create automation simulated fire notification second user cannot see', async ({ page }) => {
    if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for AC-AAN-036 e2e test');
    if (!ANON_KEY) throw new Error('VITE_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY) is required for AC-AAN-036 e2e test');

    // ── 1. Live conversation leg (Given: ask the assistant to create a scheduled automation, approve). ──
    // agent-chat is intercepted (no live LLM) — same convention as AC-AR-013/AC-AW-012. Stateful:
    // first POST (no decision) → needs-approval; second POST (decision.verdict==='approve') → ack.
    await page.route('**/functions/v1/agent-chat', async (route) => {
      const req = route.request();
      if (req.method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body: PROPOSE_SSE_FRAMES });
        return;
      }
      let bodyObj: Record<string, unknown> = {};
      try {
        bodyObj = JSON.parse(req.postData() ?? '{}') as Record<string, unknown>;
      } catch {
        // ignore
      }
      const decision = bodyObj['decision'] as { verdict?: string } | undefined;
      const frames = decision?.verdict === 'approve' ? APPROVE_SSE_FRAMES : PROPOSE_SSE_FRAMES;
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        body: frames,
      });
    });

    await signIn(page, ANN_EMAIL);
    await expect(page.getByRole('button', { name: 'Assistant' })).toBeVisible({ timeout: 10_000 });
    // Open via CLICK (deterministic) not Ctrl+J: the hotkey's keydown listener attaches in a useEffect,
    // so an early keypress is silently missed under CI load (the flake). The button's onClick is bound
    // on render — no race (FR-AP-005 Assistant toggle; the hotkey has its own dedicated coverage).
    await page.getByRole('button', { name: 'Assistant' }).click();

    const panel = page.getByRole('complementary', { name: /agent assistant/i });
    await expect(panel).toBeVisible({ timeout: 5_000 });

    const composer = panel.getByRole('textbox', { name: /ask a question/i });
    await expect(composer).toBeVisible();
    await composer.fill('every weekday at 8am summarize my overdue tasks');
    await composer.press('Enter');

    // The approve chip surfaces the automation's human-readable summary (FR-AAN-029, mirrors
    // create_activity's approve-chip flow).
    await expect(panel.getByText(new RegExp(AUTOMATION_SCHEDULE.replace(/\*/g, '\\*')))).toBeVisible({
      timeout: 15_000,
    });
    const approveBtn = panel.getByRole('button', { name: /approve/i });
    await expect(approveBtn).toBeVisible({ timeout: 10_000 });
    await approveBtn.click();

    // The automation is confirmed in chat (assistant ack).
    await expect(panel.getByText(/summarize your overdue tasks/i)).toBeVisible({ timeout: 15_000 });

    // ── 2. Seed the real automation + simulate one dispatcher-tick fire (mechanism note above). ──
    const admin = createClient(SERVICE_URL, SERVICE_KEY);
    const { data: annProfile, error: profileError } = await admin
      .from('profiles')
      .select('id, org_id')
      .eq('email', ANN_EMAIL)
      .single();
    if (profileError || !annProfile) {
      throw new Error(`Ann profile not found for ${ANN_EMAIL}: ${profileError?.message}`);
    }

    // 2a. The automation row the approved chip's write would have produced (dispatchActionForced,
    // caller JWT, owner-pinned by RLS default — mirrored here via service_role as the test fixture).
    const { data: automation, error: automationError } = await admin
      .from('agent_automations')
      .insert({
        owner_id: annProfile.id,
        org_id: annProfile.org_id,
        kind: 'schedule',
        prompt: AUTOMATION_PROMPT,
        schedule: AUTOMATION_SCHEDULE,
      })
      .select('id')
      .single();
    if (automationError || !automation) {
      throw new Error(`Failed to seed agent_automations: ${automationError?.message}`);
    }
    annAutomationId = automation.id;

    // 2b. Simulate the fire: mint → auditMint → fireAutomation → notify (ADR-0044 §2/§3/§5) —
    // the exact row shapes runDispatchTick would have produced for this automation, one tick.
    const { data: thread, error: threadError } = await admin
      .from('agent_threads')
      .insert({ owner_id: annProfile.id, org_id: annProfile.org_id, title: `Automation: ${annAutomationId}` })
      .select('id')
      .single();
    if (threadError || !thread) throw new Error(`Failed to seed agent_threads: ${threadError?.message}`);
    annThreadId = thread.id;

    const { data: run, error: runError } = await admin
      .from('agent_runs')
      .insert({
        thread_id: annThreadId,
        owner_id: annProfile.id,
        org_id: annProfile.org_id,
        title: `Automation: ${annAutomationId}`,
        status: 'completed',
      })
      .select('id')
      .single();
    if (runError || !run) throw new Error(`Failed to seed agent_runs: ${runError?.message}`);
    annRunId = run.id;

    const { error: eventError } = await admin.from('agent_events').insert({
      run_id: annRunId,
      owner_id: annProfile.id,
      org_id: annProfile.org_id,
      seq: 0,
      type: 'system',
      payload: {
        kind: 'automation_mint',
        automation_id: annAutomationId,
        owner_id: annProfile.id,
        minted_at: new Date().toISOString(),
      },
    });
    if (eventError) throw new Error(`Failed to seed agent_events audit row: ${eventError.message}`);

    // The `notify` producer's write (FR-AAN-026/028) — a fired automation reporting its outcome.
    const { data: notification, error: notificationError } = await admin
      .from('notifications')
      .insert({
        owner_id: annProfile.id,
        org_id: annProfile.org_id,
        severity: 'info',
        title: NOTIFICATION_TITLE,
        body: 'You have 5 overdue tasks.',
        metadata: { source: 'automation', automation_id: annAutomationId, run_id: annRunId },
      })
      .select('id')
      .single();
    if (notificationError || !notification) {
      throw new Error(`Failed to seed notifications: ${notificationError?.message}`);
    }
    annNotificationId = notification.id;

    // ── 3. Then: a new run exists under A, an in-app notification appears, bell badge increments. ──
    await panel.getByRole('button', { name: 'Close assistant' }).click();
    await expect(panel).not.toBeVisible({ timeout: 5_000 });

    await page.reload();
    const bellButton = page.getByRole('button', { name: /notifications, \d+ unread/i });
    await expect(bellButton).toBeVisible({ timeout: 10_000 });
    await expect(bellButton).toHaveAccessibleName(/notifications, [1-9]\d* unread/i);

    await bellButton.click();
    // The inbox popover is a labelled region (a list of notifications), not a role="menu" — review-
    // remediation item 7 (F4): the items are static content selections, not command/menu actions.
    const inbox = page.getByRole('list', { name: /notifications/i });
    await expect(inbox).toBeVisible({ timeout: 5_000 });
    await expect(inbox.getByText(NOTIFICATION_TITLE)).toBeVisible({ timeout: 5_000 });

    // Selecting the notification marks it read — the badge decrements (AC-AAN-034 parity check).
    // Because this notification carries metadata.run_id (the automation's fired run), selecting it
    // also opens the assistant panel + resumes that run's transcript (FR-AAN-036) — close the panel
    // again before signing out (it is a fixed-position overlay that intercepts pointer events over
    // the app header, the same AC-AGP-023 precedent).
    await inbox.getByText(NOTIFICATION_TITLE).click();
    await expect(page.getByRole('button', { name: /notifications, 0 unread/i })).toBeVisible({
      timeout: 5_000,
    });
    const resumedPanel = page.getByRole('complementary', { name: /agent assistant/i });
    await expect(resumedPanel).toBeVisible({ timeout: 5_000 });
    await resumedPanel.getByRole('button', { name: 'Close assistant' }).click();
    await expect(resumedPanel).not.toBeVisible({ timeout: 5_000 });

    // ── 4. Second user cannot see it ────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: /sign out/i }).click({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/login$/);

    await signIn(page, BOB_EMAIL);
    const bobBellButton = page.getByRole('button', { name: /notifications, \d+ unread/i });
    await expect(bobBellButton).toBeVisible({ timeout: 10_000 });
    // Bob's bell shows only Bob's own count — never Ann's unread notification.
    await expect(bobBellButton).toHaveAccessibleName(/notifications, 0 unread/i);

    await bobBellButton.click();
    // Bob's inbox is empty — the popover shows the empty-state message, not a <ul> list (item 7:
    // the popover is a labelled region, asserted via its heading text since an empty inbox has no
    // list role to query).
    await expect(page.getByText(/no notifications yet/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(NOTIFICATION_TITLE)).not.toBeVisible();

    // Not fetchable by id either — a direct PostgREST query for Ann's notification, made under
    // BOB'S OWN session (the browser's live Supabase JWT, found by scanning localStorage for the
    // supabase-js auth-token entry), returns zero rows — the owner-only RLS wall itself denies Bob
    // (0048_agent_automations_notifications.sql notifications_select), not merely "the UI didn't
    // show it" (mirrors AC-AGP-023 / AC-VR-020's identical direct-fetch proof).
    const bobNotificationForAnn = await page.evaluate(
      async ({ notificationId, supabaseUrl, anonKey }) => {
        let accessToken: string | null = null;
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key || !key.startsWith('sb-') || !key.endsWith('-auth-token')) continue;
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw) as { access_token?: string };
            if (parsed.access_token) {
              accessToken = parsed.access_token;
              break;
            }
          } catch {
            // not the session entry — skip
          }
        }
        if (!accessToken) throw new Error('Bob has no active Supabase session in localStorage');

        const res = await fetch(
          `${supabaseUrl}/rest/v1/notifications?id=eq.${notificationId}&select=id`,
          { headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` } },
        );
        const rows = (await res.json()) as unknown[];
        return Array.isArray(rows) ? rows.length : -1;
      },
      { notificationId: annNotificationId, supabaseUrl: SERVICE_URL, anonKey: ANON_KEY },
    );
    expect(bobNotificationForAnn).toBe(0);

    // Ann's automation is also invisible to Bob at the DB layer (agent_automations_select).
    const bobAutomationForAnn = await page.evaluate(
      async ({ automationId, supabaseUrl, anonKey }) => {
        let accessToken: string | null = null;
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key || !key.startsWith('sb-') || !key.endsWith('-auth-token')) continue;
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw) as { access_token?: string };
            if (parsed.access_token) {
              accessToken = parsed.access_token;
              break;
            }
          } catch {
            // not the session entry — skip
          }
        }
        if (!accessToken) throw new Error('Bob has no active Supabase session in localStorage');

        const res = await fetch(
          `${supabaseUrl}/rest/v1/agent_automations?id=eq.${automationId}&select=id`,
          { headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` } },
        );
        const rows = (await res.json()) as unknown[];
        return Array.isArray(rows) ? rows.length : -1;
      },
      { automationId: annAutomationId, supabaseUrl: SERVICE_URL, anonKey: ANON_KEY },
    );
    expect(bobAutomationForAnn).toBe(0);
  });
});
