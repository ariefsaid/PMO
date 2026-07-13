// @e2e-isolation: serial — mutates org-global state (see design 2026-07-11-e2e-parallel-isolation).
/**
 * AC-CUA-090 -- Employed-ClickUp task write-through journey (the ONE genuine cross-stack flow).
 *
 * Given an org whose `tasks` domain is employed by ClickUp (a project with a mirrored task + its
 * `external_project_bindings` row), when a user changes the task's status on the board, then:
 *   1. the write routes to the `adapter-dispatch` edge-function boundary -- NOT a direct PostgREST
 *      `tasks` write -- proving repository -> dispatch (ADR-0056, FR-CUA-022);
 *   2. the card walks pushing -> pushed (AC-CUA-060);
 *   3. the read-model converges to the committed value, and a reload shows the mirrored status
 *      (FR-CUA-025/070) -- proving dispatch -> adapter -> ClickUp -> read-model end to end.
 *
 * MECHANISM (Director ruling + the shipped house pattern for edge-fn e2e -- AC-AR-013 /
 * AC-AAN-036 / AC-AGP-023): the edge runtime does NOT run in this environment
 * (`supabase/config.toml` `[edge_runtime] enabled = false` -- the local Deno image health-check
 * would tear down the whole stack), so the `adapter-dispatch` boundary is intercepted via
 * `page.route`. The handler IS the mock edge function: it reads the PMO-domain command body,
 * mirrors the real `writeReadModel` for the `tasks` transition branch
 * (`supabase/functions/adapter-dispatch/index.ts` -- update the read-model row from the canonical
 * record + stamp `source_updated_at`), and fulfills with the real `CommandResult` shape
 * (`{ externalRecordId, canonical }`). No live ClickUp call, no served Deno function. A second
 * `page.route` watches the PostgREST tasks endpoint (`/rest/v1/tasks`) to PROVE no direct mutating
 * write escaped the routing seam (the byte-for-byte routing oracle).
 *
 * SETUP / RESTORE (shared-stack trap -- leave seed state EXACTLY as found): `beforeEach` seeds the
 * org-level flip (`external_domain_ownership`), the per-project binding (`external_project_bindings`
 * + status/member maps), the mirrored task's `external_refs` mapping, and stamps the task
 * `source_updated_at` -- all via a service-role client (test-only, never used by the app; the flip
 * is Operator-only at the policy layer). `afterEach` restores the task row verbatim and deletes the
 * three seeded rows, so the shared local DB is byte-for-byte for the next spec.
 *
 * Requires: SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY in the process env
 * (the local-stack ephemeral demo key, never a production secret -- same convention as AC-VR-020 /
 * AC-AAN-036). Runs in: CI `integration` job (PR->main).
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signIn } from '../helpers';

test.setTimeout(120_000);

const SERVICE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const ADMIN_EMAIL = 'admin@acme.test';
const ORG_ID = '00000000-0000-0000-0000-000000000001';
const PROJECT_ID = '40000000-0000-0000-0000-000000000001'; // "Innovate Corp HQ Fit-Out"
const TASK_ID = '80000000-0000-0000-0000-000000000002'; // "Fit-out" (seeded 'In Progress')
const TASK_NAME = 'Fit-out';
const FROM_STATUS = 'In Progress';
const TO_STATUS = 'Done';
const CLICKUP_LIST_ID = 'cu-list-e2e-fitout';
const CLICKUP_TASK_ID = 'cu-task-fitout-001';

/** The hold (ms) the mock edge fn pauses before fulfilling -- keeps the `pushing` lifecycle state
 *  observable so the pushing->pushed walk is assertable (mirrors AC-AR-013's SSE hold). */
const DISPATCH_HOLD_MS = 500;

// Counters shared with the route handlers (Node-side). Reset in beforeEach.
let dispatchHits = 0;
let directTaskMutations = 0;
// NOTE: this spec FORCES its precondition in beforeEach and restores to the SEED-canonical state in
// afterEach (not a captured "as found" value). Capturing + restoring verbatim was non-idempotent: a
// prior serial-lane spec/attempt that left the 'Fit-out' task 'Done' got captured then re-restored,
// so the FROM_STATUS precondition (line ~275) failed deterministically. Force + canonical-restore.

test.beforeEach(async () => {
  if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for AC-CUA-090 e2e');
  if (!SERVICE_URL) throw new Error('SUPABASE_URL (or VITE_SUPABASE_URL) is required for AC-CUA-090 e2e');

  dispatchHits = 0;
  directTaskMutations = 0;

  const admin = createClient(SERVICE_URL, SERVICE_KEY);

  // Verify the seed task exists (fail loudly if the fixture drifted), but do NOT rely on its current
  // status for the precondition — beforeEach forces it below.
  const { data: task, error: taskErr } = await admin
    .from('tasks')
    .select('id')
    .eq('id', TASK_ID)
    .maybeSingle();
  if (taskErr || !task) {
    throw new Error(`AC-CUA-090: seed task ${TASK_ID} not found: ${taskErr?.message}`);
  }

  // -- Flip the org's `tasks` domain to ClickUp (delete-first for crash-recovery idempotency). --
  await admin
    .from('external_domain_ownership')
    .delete()
    .eq('org_id', ORG_ID)
    .eq('external_tier', 'clickup')
    .eq('domain', 'tasks');
  const { error: flipErr } = await admin
    .from('external_domain_ownership')
    .insert({ org_id: ORG_ID, external_tier: 'clickup', domain: 'tasks' });
  if (flipErr) throw new Error(`AC-CUA-090: failed to flip org tasks->clickup: ${flipErr.message}`);

  // -- Seed the per-project ClickUp List binding + status/member maps (plan fixture). --
  await admin
    .from('external_project_bindings')
    .delete()
    .eq('org_id', ORG_ID)
    .eq('project_id', PROJECT_ID)
    .eq('external_tier', 'clickup');
  const { error: bindErr } = await admin.from('external_project_bindings').insert({
    org_id: ORG_ID,
    project_id: PROJECT_ID,
    external_tier: 'clickup',
    external_container_id: CLICKUP_LIST_ID,
    config: {
      statusMap: {
        pmoToClickUp: { 'To Do': 'to do', 'In Progress': 'in progress', Done: 'complete', Blocked: 'blocked' },
        clickUpToPmo: { complete: 'Done', open: 'To Do', 'in progress': 'In Progress' },
        defaultPmoStatus: 'To Do',
      },
      memberMap: { pmoToClickUp: {}, clickUpToPmo: {} },
    },
  });
  if (bindErr) throw new Error(`AC-CUA-090: failed to seed external_project_bindings: ${bindErr.message}`);

  // -- Seed the mirrored task's external_refs mapping (faithful: the task has a ClickUp id). --
  await admin
    .from('external_refs')
    .delete()
    .eq('org_id', ORG_ID)
    .eq('domain', 'tasks')
    .eq('external_record_id', CLICKUP_TASK_ID);
  const { error: refErr } = await admin.from('external_refs').insert({
    org_id: ORG_ID,
    domain: 'tasks',
    pmo_record_id: TASK_ID,
    external_tier: 'clickup',
    external_record_id: CLICKUP_TASK_ID,
  });
  if (refErr) throw new Error(`AC-CUA-090: failed to seed external_refs: ${refErr.message}`);

  // -- FORCE the known precondition (idempotent across retries + prior serial-lane drift): the task
  // -- starts at FROM_STATUS, not-completed, and marked as a mirror (source_updated_at set). --
  await admin
    .from('tasks')
    .update({ status: FROM_STATUS, completed_at: null, source_updated_at: new Date().toISOString() })
    .eq('id', TASK_ID);
});

test.afterEach(async () => {
  if (!SERVICE_KEY) return;
  const admin = createClient(SERVICE_URL, SERVICE_KEY);
  // Restore the task to its SEED-canonical state ('Fit-out' = FROM_STATUS='In Progress', not
  // completed, not a mirror) — NOT a captured "as found" value, which could be a prior spec's drift.
  await admin
    .from('tasks')
    .update({ status: FROM_STATUS, completed_at: null, source_updated_at: null })
    .eq('id', TASK_ID);
  await admin
    .from('external_refs')
    .delete()
    .eq('org_id', ORG_ID)
    .eq('domain', 'tasks')
    .eq('external_record_id', CLICKUP_TASK_ID);
  await admin
    .from('external_project_bindings')
    .delete()
    .eq('org_id', ORG_ID)
    .eq('project_id', PROJECT_ID)
    .eq('external_tier', 'clickup');
  await admin
    .from('external_domain_ownership')
    .delete()
    .eq('org_id', ORG_ID)
    .eq('external_tier', 'clickup')
    .eq('domain', 'tasks');
});

test.describe('AC-CUA-090: employed-ClickUp task write-through journey', () => {
  test(
    'AC-CUA-090 a board status change on a flipped task routes through adapter-dispatch (no direct tasks write), walks pushing->pushed, and the read-model converges (reload persists)',
    async ({ page }) => {
      const svc = createClient(SERVICE_URL, SERVICE_KEY);

      // -- Intercept the adapter-dispatch boundary (the mock edge function). --
      // The handler mirrors adapter-dispatch/index.ts's `writeReadModel` for the tasks transition
      // branch (update the read-model row from the canonical record + stamp source_updated_at) and
      // fulfills with the real CommandResult shape. The hold keeps the "pushing" state observable.
      await page.route('**/functions/v1/adapter-dispatch', async (route) => {
        const req = route.request();
        // Preflight guard (mirrors the real edge fn's OPTIONS branch; rarely issued here but
        // faithful + safe). Does NOT count as a dispatch hit.
        if (req.method().toUpperCase() === 'OPTIONS') {
          await route.fulfill({
            status: 204,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
              'Access-Control-Allow-Methods': 'POST, OPTIONS',
            },
          });
          return;
        }
        dispatchHits += 1;

        let body: { domain?: string; operation?: string; record?: { id?: string; status?: string } } = {};
        try {
          body = JSON.parse(req.postData() ?? '{}') as typeof body;
        } catch {
          // non-JSON body -- fall through to the default fulfill below
        }
        const record = body.record ?? {};

        if (body.domain === 'tasks' && body.operation === 'transition' && record.id && record.status) {
          // Read the task's existing fields so the canonical mirrors them (faithful to the adapter,
          // which returns the full canonical record, not just the transitioned field).
          const { data: t } = await svc
            .from('tasks')
            .select('name, assignee_id, start_date, end_date')
            .eq('id', record.id)
            .maybeSingle();
          const existing = (t ?? {}) as { name?: string | null; assignee_id?: string | null; start_date?: string | null; end_date?: string | null };
          const completedAt = record.status === 'Done' ? new Date().toISOString() : null;
          // Mirror the real writeReadModel (tasks transition): update the row + stamp source_updated_at.
          await svc
            .from('tasks')
            .update({
              status: record.status,
              completed_at: completedAt,
              source_updated_at: new Date().toISOString(),
            })
            .eq('id', record.id);
          const canonical = {
            id: record.id,
            name: existing.name ?? null,
            status: record.status,
            assignee_id: existing.assignee_id ?? null,
            start_date: existing.start_date ?? null,
            end_date: existing.end_date ?? null,
            completed_at: completedAt,
          };
          await new Promise((r) => setTimeout(r, DISPATCH_HOLD_MS));
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ externalRecordId: CLICKUP_TASK_ID, canonical }),
          });
          return;
        }

        // Defensive default (never reached by this journey): the real success shape.
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ externalRecordId: CLICKUP_TASK_ID, canonical: { id: record.id ?? TASK_ID } }),
        });
      });

      // -- Watch the PostgREST tasks endpoint: PROVE no direct mutating write escapes the seam. --
      // GETs (listTasks/getTask) pass through; only POST/PATCH/PUT/DELETE are counted.
      await page.route(/\/rest\/v1\/tasks(\?|$)/, async (route) => {
        const method = route.request().method().toUpperCase();
        if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
          directTaskMutations += 1;
        }
        await route.continue();
      });

      // -- Given: sign in + open the project Tasks tab -> Board view. --
      await signIn(page, ADMIN_EMAIL);
      await page.goto(`/projects/${PROJECT_ID}/tasks`);
      await expect(page.getByTestId('liststate-loading')).not.toBeVisible({ timeout: 20_000 });
      await page.getByRole('tab', { name: /^board$/i }).click();

      const statusSelect = page.getByLabel(`Status for ${TASK_NAME}`);
      await expect(statusSelect).toBeVisible({ timeout: 15_000 });
      await expect(statusSelect).toHaveValue(FROM_STATUS);

      // -- When: change the task's status on the board. --
      await statusSelect.selectOption(TO_STATUS);

      // -- Then 1: the card walks pushing -> pushed (AC-CUA-060). --
      await expect(page.getByRole('status', { name: /pushing to external system/i })).toBeVisible({
        timeout: 5_000,
      });
      await expect(page.getByRole('status', { name: /pushed to external system/i })).toBeVisible({
        timeout: 10_000,
      });

      // -- Then 2: the write routed through adapter-dispatch -- NOT a direct PostgREST write. --
      // pushed only appears after the dispatch fulfilled, so dispatchHits >= 1 is guaranteed here.
      expect(dispatchHits).toBeGreaterThanOrEqual(1);
      expect(directTaskMutations).toBe(0);

      // -- Then 3: the read-model converged -- the committed value renders on the card. --
      await expect(statusSelect).toHaveValue(TO_STATUS, { timeout: 10_000 });

      // -- Then 4: a reload shows the mirrored status (read-model persisted). --
      await page.reload();
      await expect(page.getByTestId('liststate-loading')).not.toBeVisible({ timeout: 20_000 });
      await expect(page.getByLabel(`Status for ${TASK_NAME}`)).toHaveValue(TO_STATUS, { timeout: 15_000 });
    },
  );
});
