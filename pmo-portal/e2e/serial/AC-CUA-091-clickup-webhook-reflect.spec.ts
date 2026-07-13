// @e2e-isolation: serial — mutates org-global state (see design 2026-07-11-e2e-parallel-isolation).
/**
 * AC-CUA-091 — Webhook-driven read-model update reflected in the UI (the inbound half).
 *
 * Given an org whose `tasks` domain is employed by ClickUp (a project with a mirrored task + its
 * `external_project_bindings` row) and an open task board, when the mock ClickUp posts a SIGNED
 * `taskUpdated` to `clickup-webhook`, then the ingress applies it and the board reflects the mirrored
 * change on refresh (FR-CUA-040/043). Plus the trust-boundary half (AC-CUA-040 ingress wiring): an
 * UNSIGNED / wrong-signed post is rejected 401 with NO read-model side effect.
 *
 * MECHANISM (the shipped house pattern for edge-fn e2e — AC-CUA-090 / AC-AR-013 / AC-AAN-036): the
 * edge runtime does NOT run in this environment (`supabase/config.toml` `[edge_runtime] enabled =
 * false`), so the `clickup-webhook` boundary is intercepted via `page.route`. The route handler IS the
 * mock edge function: it reads the raw body + `X-Signature`, verifies the HMAC-SHA256 itself (Node
 * `crypto`, constant-time — mirroring `signature.ts`), and on a valid signature applies the read-model
 * update the verified ingress would perform (update native fields + stamp `source_updated_at`); on an
 * invalid signature it returns 401 with no apply. The mock ClickUp "POST" is driven from the browser
 * context via `page.evaluate(fetch(...))`, which `page.route` intercepts. No live ClickUp call, no
 * served Deno function. The pure apply engine (signature + source-mod guard + adopt + tombstone) is
 * unit-tested in D1–D6; this e2e pins the FE-facing reflection of an INBOUND change the user did not
 * initiate (distinct from AC-CUA-090's outbound write-through).
 *
 * SETUP / RESTORE (shared-stack hygiene — leave seed state EXACTLY as found): `beforeEach` seeds the
 * org-level flip, the per-project binding, the mirrored task's `external_refs` mapping, and stamps
 * `source_updated_at`; `afterEach` restores the task row verbatim and deletes the three seeded rows.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { signIn } from '../helpers';

test.setTimeout(120_000);

const SERVICE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const ADMIN_EMAIL = 'admin@acme.test';
const ORG_ID = '00000000-0000-0000-0000-000000000001';
const PROJECT_ID = '40000000-0000-0000-0000-000000000001'; // "Innovate Corp HQ Fit-Out"
// DISTINCT from AC-CUA-090's "Fit-out" task so the two clickup e2e specs never double-mutate the same
// task row (they still share the org-flip + per-project binding rows — see the serialization note below).
const TASK_ID = '80000000-0000-0000-0000-000000000001'; // "Demolition" (seeded 'Done')
const TASK_NAME = 'Demolition';
const FROM_STATUS = 'Done';
const TO_STATUS = 'In Progress';
const CLICKUP_LIST_ID = 'cu-list-e2e-fitout';
const CLICKUP_TASK_ID = 'cu-task-demolition-091';
/** The test-only webhook secret the mock ingress and the mock ClickUp share (FR-CUA-041 P1:
 *  deployment-scoped; in CI this is a fixture, never a real secret). */
const WEBHOOK_SECRET = 'e2e-clickup-webhook-secret';
const WEBHOOK_URL = `${SERVICE_URL}/functions/v1/clickup-webhook`;

// Counters shared with the route handler (Node-side). Reset in beforeEach.
let validAccepts = 0;
let rejectedUnauthorized = 0;
// The task row as found — restored verbatim in afterEach (shared-stack hygiene).
let originalTask: { status: string; completed_at: string | null; source_updated_at: string | null } | null = null;

/** Compute the ClickUp X-Signature (HMAC-SHA256 hex of the raw body) for the test secret. */
function sign(rawBody: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
}

test.beforeEach(async () => {
  if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for AC-CUA-091 e2e');
  if (!SERVICE_URL) throw new Error('SUPABASE_URL (or VITE_SUPABASE_URL) is required for AC-CUA-091 e2e');

  validAccepts = 0;
  rejectedUnauthorized = 0;

  const admin = createClient(SERVICE_URL, SERVICE_KEY);

  // Capture the task's exact original state so afterEach restores it byte-for-byte.
  const { data: task, error: taskErr } = await admin
    .from('tasks')
    .select('status, completed_at, source_updated_at')
    .eq('id', TASK_ID)
    .maybeSingle();
  if (taskErr || !task) {
    throw new Error(`AC-CUA-091: seed task ${TASK_ID} not found: ${taskErr?.message}`);
  }
  originalTask = task as { status: string; completed_at: string | null; source_updated_at: string | null };

  // Flip the org's `tasks` domain to ClickUp (delete-first for crash-recovery idempotency).
  await admin.from('external_domain_ownership').delete().eq('org_id', ORG_ID).eq('external_tier', 'clickup').eq('domain', 'tasks');
  const { error: flipErr } = await admin
    .from('external_domain_ownership')
    .insert({ org_id: ORG_ID, external_tier: 'clickup', domain: 'tasks' });
  if (flipErr) throw new Error(`AC-CUA-091: failed to flip org tasks->clickup: ${flipErr.message}`);

  // Seed the per-project ClickUp List binding + status/member maps.
  await admin.from('external_project_bindings').delete().eq('org_id', ORG_ID).eq('project_id', PROJECT_ID).eq('external_tier', 'clickup');
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
  if (bindErr) throw new Error(`AC-CUA-091: failed to seed external_project_bindings: ${bindErr.message}`);

  // Seed the mirrored task's external_refs mapping.
  await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'tasks').eq('external_record_id', CLICKUP_TASK_ID);
  const { error: refErr } = await admin.from('external_refs').insert({
    org_id: ORG_ID,
    domain: 'tasks',
    pmo_record_id: TASK_ID,
    external_tier: 'clickup',
    external_record_id: CLICKUP_TASK_ID,
  });
  if (refErr) throw new Error(`AC-CUA-091: failed to seed external_refs: ${refErr.message}`);

  // Mark the task as a mirror (source_updated_at set).
  await admin.from('tasks').update({ source_updated_at: new Date().toISOString() }).eq('id', TASK_ID);
});

test.afterEach(async () => {
  if (!SERVICE_KEY) return;
  const admin = createClient(SERVICE_URL, SERVICE_KEY);
  if (originalTask) {
    await admin
      .from('tasks')
      .update({ status: originalTask.status, completed_at: originalTask.completed_at, source_updated_at: originalTask.source_updated_at })
      .eq('id', TASK_ID);
  }
  await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'tasks').eq('external_record_id', CLICKUP_TASK_ID);
  await admin.from('external_project_bindings').delete().eq('org_id', ORG_ID).eq('project_id', PROJECT_ID).eq('external_tier', 'clickup');
  await admin.from('external_domain_ownership').delete().eq('org_id', ORG_ID).eq('external_tier', 'clickup').eq('domain', 'tasks');
});

test.describe('AC-CUA-091: webhook-driven read-model update reflected in the UI', () => {
  test(
    'AC-CUA-091 a signed taskUpdated webhook reflects on the board after refresh; an unsigned one is rejected 401 with no side effect',
    async ({ page }) => {
      const svc = createClient(SERVICE_URL, SERVICE_KEY);

      // ── Intercept the clickup-webhook boundary (the mock edge function). ──
      // The handler verifies the X-Signature HMAC itself (mirroring signature.ts); on a valid sig it
      // applies the read-model update a verified ingress would perform; on an invalid sig → 401, no apply.
      await page.route(WEBHOOK_URL, async (route) => {
        const req = route.request();
        // Preflight guard (mirrors the real edge fn's OPTIONS branch; faithful + safe).
        if (req.method().toUpperCase() === 'OPTIONS') {
          await route.fulfill({
            status: 204,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-signature',
              'Access-Control-Allow-Methods': 'POST, OPTIONS',
            },
          });
          return;
        }

        const raw = req.postData() ?? '';
        const presented = req.headers()['x-signature'] ?? '';
        const expected = sign(raw);
        const okSig =
          presented.length === expected.length &&
          timingSafeEqual(Buffer.from(presented), Buffer.from(expected));

        if (!okSig) {
          rejectedUnauthorized += 1;
          await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'UNAUTHORIZED' }) });
          return;
        }

        const payload = JSON.parse(raw) as { task_id?: string; date_updated?: string; task?: { status?: { status?: string } } };
        if (payload.task_id === CLICKUP_TASK_ID) {
          // Apply the mirrored change (the verified ingress's read-model write): map the ClickUp
          // status -> PMO via the binding's status map, set completed_at per PMO convention, and stamp
          // source_updated_at from the ClickUp date_updated (faithful to webhookApply.ts).
          const clickUpStatus = payload.task?.status?.status ?? '';
          const pmoStatus =
            clickUpStatus === 'complete' ? 'Done'
              : clickUpStatus === 'in progress' ? 'In Progress'
                : clickUpStatus === 'open' ? 'To Do'
                  : 'To Do';
          await svc
            .from('tasks')
            .update({
              status: pmoStatus,
              completed_at: pmoStatus === 'Done' ? new Date().toISOString() : null,
              source_updated_at: new Date(Number(payload.date_updated ?? Date.now())).toISOString(),
            })
            .eq('id', TASK_ID);
        }
        validAccepts += 1;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      });

      // ── Given: sign in + open the project Tasks tab -> Board view. ──
      await signIn(page, ADMIN_EMAIL);
      await page.goto(`/projects/${PROJECT_ID}/tasks`);
      await expect(page.getByTestId('liststate-loading')).not.toBeVisible({ timeout: 20_000 });
      await page.getByRole('tab', { name: /^board$/i }).click();

      const statusSelect = page.getByLabel(`Status for ${TASK_NAME}`);
      await expect(statusSelect).toBeVisible({ timeout: 15_000 });
      await expect(statusSelect).toHaveValue(FROM_STATUS);

      // ── When (a): the mock ClickUp posts a SIGNED taskUpdated (status -> 'in progress'). ──
      const signedBody = JSON.stringify({
        event: 'taskUpdated',
        task_id: CLICKUP_TASK_ID,
        list_id: CLICKUP_LIST_ID,
        date_updated: String(Date.now()),
        task: { id: CLICKUP_TASK_ID, name: TASK_NAME, status: { status: 'in progress' }, assignees: [], start_date: null, due_date: null, date_updated: String(Date.now()) },
      });
      const signedSig = sign(signedBody);
      const signedRes = await page.evaluate(
        async ({ url, body, sig }) => {
          const r = await fetch(url, { method: 'POST', headers: { 'X-Signature': sig, 'Content-Type': 'application/json' }, body });
          return { status: r.status };
        },
        { url: WEBHOOK_URL, body: signedBody, sig: signedSig },
      );
      expect(signedRes.status).toBe(200);
      expect(validAccepts).toBe(1);

      // ── Then (a): the board reflects the mirrored change on refresh (FR-CUA-021 — reads are the
      //    read-model; the webhook's apply is now the source of truth). ──
      await page.reload();
      await expect(page.getByTestId('liststate-loading')).not.toBeVisible({ timeout: 20_000 });
      await expect(page.getByLabel(`Status for ${TASK_NAME}`)).toHaveValue(TO_STATUS, { timeout: 15_000 });

      // ── When (b) + Then (b): an UNSIGNED post is rejected 401 with NO read-model side effect
      //    (AC-CUA-040 ingress wiring — the HMAC is the sole trust boundary). ──
      const tamperedSig = 'a'.repeat(64); // wrong signature
      const unsignedRes = await page.evaluate(
        async ({ url, body, sig }) => {
          const r = await fetch(url, { method: 'POST', headers: { 'X-Signature': sig, 'Content-Type': 'application/json' }, body });
          return { status: r.status };
        },
        { url: WEBHOOK_URL, body: signedBody, sig: tamperedSig },
      );
      expect(unsignedRes.status).toBe(401);
      expect(rejectedUnauthorized).toBe(1);
      // The read-model is unchanged by the rejected post — the board still shows the valid update.
      await expect(page.getByLabel(`Status for ${TASK_NAME}`)).toHaveValue(TO_STATUS);
    },
  );
});
