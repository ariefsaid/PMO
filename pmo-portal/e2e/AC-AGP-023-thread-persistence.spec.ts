/**
 * AC-AGP-023 — Converse, reload, transcript restored; a second user cannot see it.
 * (ADR-0043 SS Verification: "user has a conversation -> reloads -> the transcript is
 * restored in order; a second user cannot see it.")
 *
 * Given a signed-in user opens the assistant panel and has a short conversation (send a
 * message, receive a reply),
 * When the user reloads the page and reopens the panel / navigates back to the same thread,
 * Then the full transcript is restored in its original order (user message, assistant
 * reply, in sequence) - and when a second user signs in, they see no trace of the first
 * user's thread (it does not appear in their thread list and is not fetchable by id).
 *
 * MECHANISM (binding note, see docs/plans/2026-07-03-agent-persistence.md Phase E / section 0):
 * `agent_threads`/`agent_runs`/`agent_events` INSERTs happen ONLY inside the real Deno
 * `agent-chat` edge function (`supabase/functions/agent-chat/persistence.ts`, bound to the
 * caller-JWT `callerClient`). `docs/environments.md` "Edge Functions" is explicit that the
 * edge runtime does NOT run in CI / this remote container (`[edge_runtime] enabled = false`
 * in `supabase/config.toml` - the Deno image cannot reach deno.land here and its failed
 * health check tears down the whole stack), so - exactly like every other agent e2e
 * (AC-AR-013, AC-CV-015) - `agent-chat` is intercepted via `page.route` with scripted SSE
 * frames for the LIVE conversation leg of the Given (no live LLM). A mocked SSE response
 * never reaches Postgres, so it cannot by itself produce the durable rows the reload leg
 * needs to restore from.
 *
 * To prove the reload leg for real (not weakened to "elements exist"), this test follows
 * the SAME precedented pattern already in this suite for exactly this class of problem
 * (`e2e/AC-VR-020-view-renderer-ownership.spec.ts`): after driving the live conversation
 * through the UI (mocked SSE, proving the Given), it seeds `agent_threads`/`agent_runs`/
 * `agent_events` via a service-role client (test-only, never used by the app) with rows
 * that mirror exactly what the real edge function's persistence.ts would have written for
 * that same exchange - same owner (the signed-in user's real profile id/org_id, resolved
 * live, never hardcoded), same seq-ordered user->assistant sequence. The reload step then
 * exercises the REAL `listAgentThreads`/`listRunEvents` DAL against REAL Postgres + REAL
 * owner-only RLS (0046_agent_persistence.sql) - the actual goal-oracle (restored order;
 * cross-user denial) is proven against the real backend, not stubbed.
 *
 * Requires: VITE_FEATURES_AGENT_ASSISTANT=true (Vite/SPA flag) and
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the process env (same convention as
 * AC-VR-020 - the local-stack service-role key is the well-known ephemeral demo key, never
 * a production secret).
 *
 * Runs in: CI `integration` job (PR->main), flag-gated. Locally: see the plan's Phase E2
 * gate commands.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signIn } from './helpers';

test.setTimeout(120_000);

const SERVICE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
// PostgREST/Kong requires an `apikey` header on every request in addition to the caller's
// bearer JWT. The anon key is not secret (it is RLS-scoped, publicly embedded in the built
// SPA, and printed by `supabase status`) - read from the same env var name the app's own
// build uses (VITE_SUPABASE_ANON_KEY, set in .env.local / CI's GITHUB_ENV convention).
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';

const ANN_EMAIL = 'admin@acme.test';
const BOB_EMAIL = 'engineer@acme.test';

const USER_MESSAGE = 'How many of my projects are active?';
const ASSISTANT_REPLY = 'You have 5 active projects.';

const RUN_ID = 'e2e-agp023-run-001';

/** Build an SSE body from an array of JSON payloads (same helper as AC-AR-013/AC-CV-015). */
function buildSseBody(payloads: unknown[]): string {
  return payloads.map((p) => `data: ${JSON.stringify(p)}\n\n`).join('');
}

const SSE_FRAMES = buildSseBody([
  {
    id: 'evt-agp023-1',
    runId: RUN_ID,
    type: 'assistant',
    text: ASSISTANT_REPLY,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'evt-agp023-2',
    runId: RUN_ID,
    type: 'status',
    payload: { status: 'completed' },
    createdAt: new Date().toISOString(),
  },
]);

// IDs the beforeAll seed step fills in and the tests/afterAll consume.
let annThreadId: string | null = null;
let annRunId: string | null = null;

test.beforeAll(async () => {
  if (!SERVICE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for AC-AGP-023 e2e test');
  }
  if (!ANON_KEY) {
    throw new Error('VITE_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY) is required for AC-AGP-023 e2e test');
  }
  const admin = createClient(SERVICE_URL, SERVICE_KEY);

  const { data: annProfile, error: profileError } = await admin
    .from('profiles')
    .select('id, org_id')
    .eq('email', ANN_EMAIL)
    .single();
  if (profileError || !annProfile) {
    throw new Error(`Ann profile not found for ${ANN_EMAIL}: ${profileError?.message}`);
  }

  // Seed the durable rows a real conversation (Given: "send a message, receive a reply")
  // would have left via the edge function's persistence.ts - same owner, same seq order.
  const { data: thread, error: threadError } = await admin
    .from('agent_threads')
    .insert({
      owner_id: annProfile.id,
      org_id: annProfile.org_id,
      title: USER_MESSAGE.slice(0, 60),
    })
    .select('id')
    .single();
  if (threadError || !thread) {
    throw new Error(`Failed to seed agent_threads: ${threadError?.message}`);
  }
  annThreadId = thread.id;

  const { data: run, error: runError } = await admin
    .from('agent_runs')
    .insert({
      thread_id: annThreadId,
      owner_id: annProfile.id,
      org_id: annProfile.org_id,
      status: 'completed',
    })
    .select('id')
    .single();
  if (runError || !run) {
    throw new Error(`Failed to seed agent_runs: ${runError?.message}`);
  }
  annRunId = run.id;

  const { error: eventsError } = await admin.from('agent_events').insert([
    {
      run_id: annRunId,
      owner_id: annProfile.id,
      org_id: annProfile.org_id,
      seq: 1,
      type: 'user',
      text: USER_MESSAGE,
    },
    {
      run_id: annRunId,
      owner_id: annProfile.id,
      org_id: annProfile.org_id,
      seq: 2,
      type: 'assistant',
      text: ASSISTANT_REPLY,
    },
  ]);
  if (eventsError) {
    throw new Error(`Failed to seed agent_events: ${eventsError.message}`);
  }
});

test.afterAll(async () => {
  if (!SERVICE_KEY) return;
  const admin = createClient(SERVICE_URL, SERVICE_KEY);
  if (annThreadId) {
    // agent_runs / agent_events cascade-delete via FK (on delete cascade, 0046 migration).
    await admin.from('agent_threads').delete().eq('id', annThreadId);
  }
});

test.describe('AC-AGP-023: converse, reload, transcript restored, second user cannot see it', () => {
  test('AC-AGP-023 converse reload transcript restored second user cannot see', async ({ page }) => {
    // -- 1. Live conversation leg (Given: send a message, receive a reply) -------------
    // agent-chat is intercepted (no live LLM) - same convention as AC-AR-013/AC-CV-015.
    await page.route('**/functions/v1/agent-chat', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        body: SSE_FRAMES,
      });
    });

    await signIn(page, ANN_EMAIL);
    await expect(page.getByRole('button', { name: 'Assistant' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Assistant' }).click();

    const panel = page.getByRole('complementary', { name: /agent assistant/i });
    await expect(panel).toBeVisible({ timeout: 5_000 });

    const composer = panel.getByRole('textbox', { name: /ask a question/i });
    await expect(composer).toBeVisible();
    await composer.fill(USER_MESSAGE);
    await composer.press('Enter');

    // Assistant reply renders - proves the Given's "receive a reply".
    await expect(panel.getByText(ASSISTANT_REPLY)).toBeVisible({ timeout: 15_000 });

    // -- 2. When: reload the page and reopen the panel / navigate back to the thread ---
    await page.reload();
    await expect(page.getByRole('button', { name: 'Assistant' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Assistant' }).click();

    const panelAfterReload = page.getByRole('complementary', { name: /agent assistant/i });
    await expect(panelAfterReload).toBeVisible({ timeout: 5_000 });

    // Open History (ThreadList) and open Ann's seeded thread.
    await panelAfterReload.getByRole('button', { name: 'History' }).click();
    const threadList = panelAfterReload.getByRole('list', { name: /recent conversations/i });
    await expect(threadList).toBeVisible({ timeout: 5_000 });
    await threadList.getByRole('button', { name: new RegExp(USER_MESSAGE.slice(0, 20)) }).click();

    // -- 3. Then: the full transcript is restored, in original order -------------------
    // Assert DOM order: the transcript log's items appear user-message-then-assistant-reply,
    // in sequence (seq-ordered restore, not created_at/insertion order) - the real goal.
    const transcriptLog = panelAfterReload.getByRole('log', { name: /conversation/i });
    await expect(transcriptLog.getByText(USER_MESSAGE)).toBeVisible({ timeout: 10_000 });
    await expect(transcriptLog.getByText(ASSISTANT_REPLY)).toBeVisible({ timeout: 10_000 });

    const restoredOrder = await transcriptLog.evaluate((log) => log.textContent ?? '');
    const userIdx = restoredOrder.indexOf(USER_MESSAGE);
    const assistantIdx = restoredOrder.indexOf(ASSISTANT_REPLY);
    expect(userIdx).toBeGreaterThanOrEqual(0);
    expect(assistantIdx).toBeGreaterThan(userIdx);

    // -- 4. Second user cannot see it ---------------------------------------------------
    // Close the panel first - it is a fixed-position overlay (z-[40]) that intercepts
    // pointer events over the app header, including the Sign out button.
    await panelAfterReload.getByRole('button', { name: 'Close assistant' }).click();
    await expect(panelAfterReload).not.toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login$/);

    await signIn(page, BOB_EMAIL);
    await expect(page.getByRole('button', { name: 'Assistant' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Assistant' }).click();

    const bobPanel = page.getByRole('complementary', { name: /agent assistant/i });
    await expect(bobPanel).toBeVisible({ timeout: 5_000 });
    await bobPanel.getByRole('button', { name: 'History' }).click();

    // ThreadList.tsx always renders the <ul> (even when empty, with zero <li>s) alongside
    // an explicit "No conversations yet." message - an empty <ul> with no content is not
    // itself a meaningful visibility oracle, so assert on the actual goal: Bob's history
    // is genuinely empty (Ann's thread does not appear, and the empty-state message shows).
    const bobThreadList = bobPanel.getByRole('list', { name: /recent conversations/i });
    await expect(bobThreadList.getByRole('listitem')).toHaveCount(0);
    // Ann's thread never appears in Bob's ThreadList.
    await expect(
      bobThreadList.getByRole('button', { name: new RegExp(USER_MESSAGE.slice(0, 20)) }),
    ).not.toBeVisible();
    await expect(bobPanel.getByText(/no conversations yet/i)).toBeVisible({ timeout: 5_000 });

    // Not fetchable by id either - a direct PostgREST query for Ann's run_id, made from
    // inside the page under BOB'S OWN session (the browser's live Supabase JWT, found by
    // scanning localStorage for the supabase-js auth-token entry - no app-internal storage
    // key assumed), returns zero rows. This proves the owner-only RLS wall itself denies
    // Bob (0046_agent_persistence.sql agent_events_select), not merely "the UI didn't show
    // it" - the same class of assertion AC-VR-020 makes for user_views.
    const bobEventsForAnnRun = await page.evaluate(
      async ({ runId, supabaseUrl, anonKey }) => {
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
          `${supabaseUrl}/rest/v1/agent_events?run_id=eq.${runId}&select=id`,
          {
            headers: {
              apikey: anonKey,
              Authorization: `Bearer ${accessToken}`,
            },
          },
        );
        const rows = (await res.json()) as unknown[];
        return Array.isArray(rows) ? rows.length : -1;
      },
      { runId: annRunId, supabaseUrl: SERVICE_URL, anonKey: ANON_KEY },
    );
    expect(bobEventsForAnnRun).toBe(0);
  });
});
