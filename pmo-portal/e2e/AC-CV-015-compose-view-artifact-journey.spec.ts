/**
 * AC-CV-015 — Ask in panel → artifact view renders → Save → reopen from My Views.
 *
 * Curated E2E journey (ADR-0010, ADR-0039 §CI-test-isolation):
 *   - The Supabase Edge Function `agent-chat` is intercepted via page.route — NO live LLM.
 *   - The Supabase `projects` data endpoint is intercepted — NO live DB for chart data.
 *   - The Supabase `user_views` endpoint is intercepted for Save POST and list/get GETs.
 *   - The mocked spec is a StatusBarChart on 'projects' (valid, passes compileCompositionSpec).
 *
 * Flags required (fast-lane PR→dev, Vite dev server):
 *   VITE_FEATURES_AGENT_ASSISTANT=true
 *   VITE_FEATURES_AI_COMPOSER=true
 *
 * Journey:
 *   1. Authenticate as admin@acme.test.
 *   2. Open AssistantPanel (Ctrl+J).
 *   3. Type "show me active projects by status" and press Enter.
 *   4. Composer is disabled while streaming.
 *   5. Assistant text bubble "Here is a dashboard..." appears.
 *   6. ArtifactSlot renders with heading "Active projects by status".
 *   7. Chart content is visible inside the slot.
 *   8. "Save to My Views" button is visible and enabled.
 *   9. User clicks "Save to My Views".
 *  10. "Saved" indicator appears; "Open view →" link is visible.
 *  11. User navigates to /views (My Views).
 *  12. "Active projects by status" appears in the list.
 *  13. User clicks the view → navigates to /views/saved-view-1 → I3 renderer shows the view.
 *
 * No-auto-save assertion: user_views POST count is 0 between artifact render and Save click.
 *
 * Verify parse (no live server needed):
 *   npx playwright test e2e/AC-CV-015-compose-view-artifact-journey.spec.ts --list
 *
 * Platform note: Linux CI uses Ctrl+J (Control+j) since Meta is not available.
 */
import { test, expect } from '@playwright/test';
import type { CompositionSpec } from '../src/lib/viewspec/types';
import { signIn } from './helpers';

test.setTimeout(120_000);

/** Build an SSE body from an array of JSON payloads. */
function buildSseBody(payloads: unknown[]): string {
  return payloads.map((p) => `data: ${JSON.stringify(p)}\n\n`).join('');
}

const RUN_ID = 'e2e-cv015-run-001';
const SAVED_VIEW_ID = 'saved-view-1';
const VIEW_TITLE = 'Active projects by status';

/**
 * StatusBarChart CompositionSpec: one panel using 'projects' entity with groupBy.
 * This spec is valid: passes compileCompositionSpec (entity whitelisted, columns allowed,
 * aggregate valid, no requiredFilter on 'projects').
 */
const MOCK_ARTIFACT_SPEC: CompositionSpec = {
  version: 1,
  panels: [
    {
      id: 'p1',
      primitive: 'StatusBarChart',
      querySpec: {
        entity: 'projects',
        select: ['status', 'id'],
        groupBy: 'status',
        aggregate: { fn: 'count', column: 'id', alias: 'count' },
      },
    },
  ],
};

/** The saved user_views row returned by the mock POST and subsequent GET calls. */
const MOCK_SAVED_VIEW = {
  id: SAVED_VIEW_ID,
  name: VIEW_TITLE,
  description: null,
  spec: MOCK_ARTIFACT_SPEC,
  scope: 'private',
  org_id: 'org-test',
  user_id: 'user-test',
  archived_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

/** SSE frames for the agent-chat response: user echo, assistant text, artifact, completed. */
const SSE_FRAMES = buildSseBody([
  // Frame 1: user echo
  {
    id: 'evt-1',
    runId: RUN_ID,
    type: 'user',
    text: 'show me active projects by status',
    createdAt: new Date().toISOString(),
  },
  // Frame 2: assistant text
  {
    id: 'evt-2',
    runId: RUN_ID,
    type: 'assistant',
    text: 'Here is a dashboard of your active projects by status:',
    createdAt: new Date().toISOString(),
  },
  // Frame 3: artifact event with the compose_view payload
  {
    id: 'evt-3',
    runId: RUN_ID,
    type: 'artifact',
    payload: {
      kind: 'compose_view',
      spec: MOCK_ARTIFACT_SPEC,
      title: VIEW_TITLE,
      repairAttempts: 0,
      tokensUsed: 320,
    },
    createdAt: new Date().toISOString(),
  },
  // Frame 4: completed status
  {
    id: 'evt-4',
    runId: RUN_ID,
    type: 'status',
    payload: { status: 'completed' },
    createdAt: new Date().toISOString(),
  },
]);

test.describe('AC-CV-015: compose-view artifact journey', () => {
  test('AC-CV-015 ask in panel → artifact renders → Save → appears in My Views', async ({
    page,
  }) => {
    // ── Intercept agent-chat (SSE stream) ─────────────────────────────────────
    await page.route('**/functions/v1/agent-chat', async (route) => {
      const req = route.request();
      if (req.method() === 'GET') {
        // Handle legacy GET subscribe path defensively
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
          body: SSE_FRAMES,
        });
        return;
      }
      // POST: createRun or followUp — return the run object first, then SSE on the same call
      // PmoNativeRuntime uses a single POST that returns SSE (text/event-stream)
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        body: SSE_FRAMES,
      });
    });

    // ── Intercept projects data for the ArtifactSlot's executeCompiledQuery ──
    // The StatusBarChart executeCompiledQuery generates a PostgREST request against
    // the projects table. We return pre-grouped mock data.
    await page.route('**/rest/v1/projects*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Content-Range': '0-1/2' },
        body: JSON.stringify([
          { status: 'active', count: 5 },
          { status: 'on_hold', count: 2 },
        ]),
      });
    });

    // ── Intercept user_views: stateful POST (save) + GET (list/by-id) ─────────
    let userViewsPostCount = 0;

    await page.route('**/rest/v1/user_views*', async (route) => {
      const req = route.request();

      if (req.method() === 'POST') {
        userViewsPostCount++;
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          headers: {
            'Content-Range': '0-0/1',
            // PostgREST returns the inserted row via Prefer: return=representation
          },
          body: JSON.stringify(MOCK_SAVED_VIEW),
        });
        return;
      }

      // GET: list or single by id (for My Views page and UserViewRenderer)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Content-Range': '0-0/1' },
        body: JSON.stringify([MOCK_SAVED_VIEW]),
      });
    });

    // ── 1. Authenticate ───────────────────────────────────────────────────────
    await signIn(page, 'admin@acme.test');

    // ── 2. Open the AssistantPanel via Ctrl+J (Linux CI) ─────────────────────
    // Open the panel deterministically via the Rail "Assistant" toggle (a real click,
    // no global-hotkey race). Opening is setup here, not the behavior under test.
    await page.getByRole('button', { name: 'Assistant' }).click();

    const panel = page.getByRole('complementary', { name: /agent assistant/i });
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // ── 3. Empty state visible ────────────────────────────────────────────────
    await expect(panel.getByText(/ask your agent/i)).toBeVisible({ timeout: 5_000 });

    // ── 4. Type and press Enter ────────────────────────────────────────────────
    const composer = panel.getByRole('textbox', { name: /ask a question/i });
    await expect(composer).toBeVisible();
    await composer.fill('show me active projects by status');
    await composer.press('Enter');

    // ── 5. Composer disabled while streaming (Stop button appears) ────────────
    await expect(
      panel.getByRole('button', { name: /stop generating/i }),
    ).toBeVisible({ timeout: 10_000 });

    // ── 6. Assistant text bubble appears ─────────────────────────────────────
    await expect(
      panel.getByText(/here is a dashboard/i),
    ).toBeVisible({ timeout: 15_000 });

    // ── 7. ArtifactSlot renders with heading ──────────────────────────────────
    // The slot uses <section aria-label="Composed view: Active projects by status">
    // which gets the implicit ARIA role 'region' when it has an accessible name.
    const artifactSlot = panel.getByRole('region', { name: /active projects by status/i });
    await expect(artifactSlot).toBeVisible({ timeout: 15_000 });

    // ── No-auto-save: assert user_views POST count is 0 before Save click ─────
    // (FR-CV-019: agent NEVER auto-persists; the count was 0 up to this point)
    expect(userViewsPostCount).toBe(0);

    // ── 8. Save button is visible and enabled ─────────────────────────────────
    const saveButton = artifactSlot.getByRole('button', { name: /save/i });
    await expect(saveButton).toBeVisible({ timeout: 10_000 });
    await expect(saveButton).toBeEnabled();

    // ── 9. Click Save ─────────────────────────────────────────────────────────
    await saveButton.click();

    // ── 10. "Saved" indicator appears + "Open view" link ─────────────────────
    // The ArtifactSlot replaces the Save button with "Saved" text and an "Open view →" link.
    // Match the visible badge exactly ('Saved') so we don't also catch the sr-only
    // aria-live status "View saved successfully" (also contains "saved") — that
    // ambiguity is a strict-mode violation.
    await expect(artifactSlot.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 });
    const openViewLink = artifactSlot.getByRole('link', { name: /open view/i });
    await expect(openViewLink).toBeVisible({ timeout: 5_000 });

    // Confirm the POST was called exactly once (the explicit Save click)
    expect(userViewsPostCount).toBe(1);

    // ── 11. Navigate to My Views ─────────────────────────────────────────────
    await page.goto('/views');
    await expect(page).toHaveURL('/views');

    // ── 12. "Active projects by status" appears in My Views list ─────────────
    // Scoped to <main> (the rail nav also has "My Views" links)
    await expect(
      page.getByRole('main').getByRole('link', { name: VIEW_TITLE }),
    ).toBeVisible({ timeout: 10_000 });

    // ── 13. Click the view → UserViewRenderer (I3) loads it ──────────────────
    await page.getByRole('main').getByRole('link', { name: VIEW_TITLE }).click();

    // Should navigate to /views/saved-view-1
    await expect(page).toHaveURL(new RegExp(`/views/${SAVED_VIEW_ID}`), { timeout: 10_000 });

    // The I3 renderer shows the view heading (not the not-found state)
    await expect(
      page.getByRole('main').getByRole('heading', { name: VIEW_TITLE }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
