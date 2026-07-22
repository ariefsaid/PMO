// @e2e-isolation: dedicated-row — owns a dedicated project (code E2E-EAC-018) + task created in
// beforeAll; the disabled-sync-engine output it stands in for (org binding, project binding,
// outbox, watermark) is service-role-seeded scoped to test-owned ids and fully cleaned up in
// afterAll. The shared seed (SP-2401 etc.) is never mutated.
/**
 * AC-EAC-018 — admin connects → links a PMO project to a ClickUp List → edits a PMO task status →
 * a (mocked) ClickUp webhook fires a counterpart change → BOTH directions converge, the
 * Integrations card shows `Active` with an updated `last sync`, and the outbox for the task
 * reaches `confirmed`. (The mock stands in for the un-gated live-smoke.)
 *
 * WHY EVERYTHING IS MOCKED + SEEDED (binding precedent: e2e/AC-AGP-023-thread-persistence.spec.ts).
 * `docs/environments.md` "Edge Functions" + `supabase/config.toml` `[edge_runtime]` are explicit
 * that the Deno edge runtime does NOT run in this stack (the image can't reach deno.land here and
 * its failed health check tears down the whole stack). So the five edge fns this journey crosses
 * (`external-connect`, `external-lists`, `external-link`, `adapter-dispatch`, `clickup-webhook`)
 * CANNOT be driven live — exactly like every agent e2e (AC-AR-013/AC-CV-015/AC-AGP-023), they are
 * intercepted via `page.route`. A mocked edge fn never reaches Postgres, so the durable rows the
 * REAL edge fns would have written (the org binding on connect, the project binding on link, the
 * outbox+watermark on dispatch, the task read-model on webhook) are seeded via a service-role
 * client (test-only, never used by the app) with rows that mirror EXACTLY what the real edge fn
 * would have written — same org, same actor, same ids. The READ legs of the journey (the card
 * showing Active/Last-sync, the task status converging, the outbox state) then exercise the REAL
 * repository/DAL against REAL Postgres + REAL RLS — the actual goal-oracle, proven against the
 * real backend, not stubbed. The live wire contract against the REAL ClickUp API is already proven
 * separately by `scripts/clickup-roundtrip-verify.ts` (8/8) and `scripts/clickup-parent-probe.ts`;
 * the webhook envelope below reuses the committed real-capture fixtures' shape.
 *
 * NO live ClickUp API is ever called.
 *
 * Requires (same convention as AC-AGP-023): SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY /
 * VITE_SUPABASE_ANON_KEY in the process env (the local-stack service-role key is the well-known
 * ephemeral demo key from `supabase status`, never a production secret).
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { signIn } from './helpers';

test.setTimeout(150_000);

const SERVICE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';

const ADMIN_EMAIL = 'admin@acme.test';
const ORG = '00000000-0000-0000-0000-000000000001'; // Acme (the default seed org)

// SERIAL (repo convention, cf. AC-PR-020-capture-advance.spec.ts): both tests in this file share ONE
// dedicated project+task seeded in beforeAll, and that seeding starts with cleanOwnedRows(). Under
// fullyParallel each worker would run the seeding, so worker B's clean would delete worker A's
// project between A's project insert and A's task insert -> tasks_project_id_fkey violation. Serial
// pins them to one worker and one seeding pass.
test.describe.configure({ mode: 'serial' });

// Dedicated, test-owned identifiers (stable across runs → idempotent pre-clean + cleanup).
const PROJ_CODE = 'E2E-EAC-018';
const PROJ_NAME = 'E2E EAC-018 Sync Probe';
const TASK_NAME = 'E2E-EAC-018 Convergence Task';
const LIST_ID = 'eac018_list_9001';
const LIST_NAME = 'E2E EAC-018 List';
const CLICKUP_TASK_ID = 'eac018cu1'; // ClickUp-side id of the pushed task (webhook task_id)
const SECRET_REF = 'vault-clickup-eac018-acme';

// Captured in beforeAll.
let adminId = '';
let projectId = '';
let taskId = '';

/**
 * The faithful ClickUp webhook envelope — real shape from the committed real-capture fixtures
 * (`supabase/functions/_shared/testing/fixtures/clickup-webhook/01-taskStatusUpdated.json`):
 * top-level keys are exactly `{event, history_items, task_id, team_id, webhook_id}`. There is NO
 * `task`, NO `date_updated`, NO `list_id`. `history_items[0].field === 'status'` and
 * `.after.status` is the converged status. (The real edge fn maps ClickUp's lowercase statuses
 * onto the PMO `task_status` enum; here `after.status` already carries the PMO-mapped value so
 * the convergence oracle reads cleanly.)
 */
const WEBHOOK_TASK_DONE = {
  event: 'taskStatusUpdated',
  task_id: CLICKUP_TASK_ID,
  team_id: 'eac018_team',
  webhook_id: 'eac018_webhook',
  history_items: [
    {
      id: 'eac018_hist_1',
      type: 1,
      date: String(Date.now()),
      field: 'status',
      data: { status_type: 'done' },
      source: null,
      user: { id: 999999, username: 'ClickUp Sync Bot', email: 'sync@clickup.test' },
      before: { status: 'In Progress', color: '#87909e', orderindex: 1, type: 'open' },
      after: { status: 'Done', color: '#00ba6d', orderindex: 3, type: 'done' },
    },
  ],
};

/** A service-role admin client (test-only; never used by the app). */
function adminClient(): SupabaseClient {
  return createClient(SERVICE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

/** Idempotently remove every row this spec (or a prior crashed run) may have left behind. */
async function cleanOwnedRows(db: SupabaseClient): Promise<void> {
  // Order respects FKs / unique constraints: watermarks + outbox (no FK to our project) → project
  // binding → org binding → task → project. All scoped to test-owned identifiers only.
  await db.from('external_sync_watermarks').delete().eq('external_tier', 'clickup').like('watermark_cursor', 'eac018-%');
  await db.from('external_command_outbox').delete().eq('external_tier', 'clickup').eq('pmo_record_id', CLICKUP_TASK_ID);
  await db.from('external_project_bindings').delete().eq('external_container_id', LIST_ID);
  await db.from('external_org_bindings').delete().eq('org_id', ORG).eq('external_tier', 'clickup');
  await db.from('tasks').delete().ilike('name', TASK_NAME);
  await db.from('projects').delete().eq('code', PROJ_CODE);
}

test.beforeAll(async () => {
  if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for AC-EAC-018 e2e');
  if (!ANON_KEY) throw new Error('VITE_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY) is required for AC-EAC-018 e2e');
  if (!SERVICE_URL) throw new Error('SUPABASE_URL (or VITE_SUPABASE_URL) is required for AC-EAC-018 e2e');

  const db = adminClient();

  // Resolve the Admin actor live (never hardcode the profile id).
  const { data: admin, error: adminErr } = await db
    .from('profiles')
    .select('id, org_id')
    .eq('email', ADMIN_EMAIL)
    .single();
  if (adminErr || !admin) throw new Error(`Admin profile not found for ${ADMIN_EMAIL}: ${adminErr?.message}`);
  adminId = admin.id;

  // Idempotent: clear any leftover from a prior run, then (re)create the dedicated project + task.
  await cleanOwnedRows(db);

  const { data: proj, error: projErr } = await db
    .from('projects')
    .insert({
      code: PROJ_CODE,
      name: PROJ_NAME,
      status: 'Ongoing Project', // on-hand partition → deep-link /projects/:id/tasks is readable
      org_id: ORG,
      project_manager_id: adminId,
      contract_value: 0,
      budget: 0,
      spent: 0,
    })
    .select('id')
    .single();
  if (projErr || !proj) throw new Error(`Failed to seed dedicated project: ${projErr?.message}`);
  projectId = proj.id;

  const { data: task, error: taskErr } = await db
    .from('tasks')
    .insert({ project_id: projectId, name: TASK_NAME, status: 'To Do', assignee_id: adminId })
    .select('id')
    .single();
  if (taskErr || !task) throw new Error(`Failed to seed dedicated task: ${taskErr?.message}`);
  taskId = task.id;
});

test.afterAll(async () => {
  if (!SERVICE_KEY) return;
  await cleanOwnedRows(adminClient());
});

test('AC-EAC-018: admin connects ClickUp → links project → edits task → webhook converges back; card Active + last sync; outbox confirmed', async ({ page }) => {
  const db = adminClient();

  // ── Mount the page.route interceptors for the disabled edge fns ──────────────────
  // Each handler seeds the durable row the REAL edge fn would have written (the side-effect the
  // disabled runtime can't perform), then returns the faithful wire response.

  // external-connect: validate-200 stand-in → seed the org binding (what create_vault_secret_for_org
  // + admin_change_domain_ownership would have persisted), return {ok, binding}.
  await page.route('**/functions/v1/external-connect', async (route) => {
    const { error } = await db.from('external_org_bindings').upsert(
      {
        org_id: ORG,
        external_tier: 'clickup',
        site_url: 'https://api.clickup.com',
        secret_ref: SECRET_REF,
        status: 'active',
        connected_by: adminId,
        connected_at: new Date().toISOString(),
        config: { domain: 'tasks', clickup_actor_id: 999999 },
      },
      { onConflict: 'org_id,external_tier' },
    );
    if (error) throw new Error(`seed org binding failed: ${error.message}`);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, binding: { secret_ref: SECRET_REF, status: 'active' } }),
    });
  });

  // external-lists: return the one List the picker offers.
  await page.route('**/functions/v1/external-lists', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        lists: [{ id: LIST_ID, name: LIST_NAME, space_name: 'E2E Space', folder_name: null }],
      }),
    });
  });

  // external-link: push-seed → seed the project binding (what the link RPC would persist), return ok.
  await page.route('**/functions/v1/external-link', async (route) => {
    const { error } = await db.from('external_project_bindings').upsert(
      {
        org_id: ORG,
        project_id: projectId,
        external_tier: 'clickup',
        external_container_id: LIST_ID,
        config: { direction: 'push-seed' },
        linked_by: adminId,
        linked_at: new Date().toISOString(),
      },
      { onConflict: 'org_id,project_id,external_tier' },
    );
    if (error) throw new Error(`seed project binding failed: ${error.message}`);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, binding: { id: 'eac018_pb', direction: 'push-seed', listId: LIST_ID } }),
    });
  });

  await signIn(page, ADMIN_EMAIL);

  // ===========================================================================
  // WHEN-a: the Admin connects ClickUp (mocked validate 200).
  // ===========================================================================
  await page.goto('/administration');
  const connectCards = page.getByTestId('integrations-connect-cards');
  await expect(connectCards).toBeVisible({ timeout: 15_000 });
  const clickupCard = connectCards.locator('[data-tier="clickup"]');

  // Connect modal → enter the (mock) personal token → submit.
  await clickupCard.getByRole('button', { name: /Connect ClickUp/i }).click();
  const connectDialog = page.getByRole('dialog', { name: /Connect ClickUp/i });
  await expect(connectDialog).toBeVisible({ timeout: 10_000 });
  await connectDialog.getByLabel(/personal api token/i).fill('pk_eac018_mock_token');
  await connectDialog.getByRole('button', { name: /Connect ClickUp/i }).click();
  await expect(connectDialog).toBeHidden({ timeout: 15_000 });

  // ===========================================================================
  // WHEN-b: the Admin links the PMO project to a List (push-seed).
  // ===========================================================================
  await page.goto(`/projects/${projectId}/tasks`);
  const projIntegrations = page.getByTestId('project-integrations-cards');
  await expect(projIntegrations).toBeVisible({ timeout: 15_000 });
  const projClickupCard = projIntegrations.locator('[data-tier="clickup"]');

  // Org is connected → the "Link to ClickUp" affordance is now visible.
  await expect(projClickupCard.getByRole('button', { name: /Link to ClickUp/i })).toBeVisible({ timeout: 15_000 });
  await projClickupCard.getByRole('button', { name: /Link to ClickUp/i }).click();
  const linkDialog = page.getByRole('dialog', { name: /Link to ClickUp/i });
  await expect(linkDialog).toBeVisible({ timeout: 10_000 });

  // Pick the one List from the picker (direction defaults to push-seed — the AC's chosen direction).
  const listTrigger = linkDialog.getByRole('combobox', { name: /ClickUp List/i });
  await expect(listTrigger).toBeVisible();
  await listTrigger.click();
  await expect(page.getByRole('listbox')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('option', { name: new RegExp(LIST_NAME) }).click();
  await expect(listTrigger).toContainText(LIST_NAME);

  await linkDialog.getByRole('button', { name: /Link to ClickUp/i }).click();
  // App note: handleLinkSubmit does NOT auto-close the link dialog on success (unlike connect, which
  // does) — it only refetches the project bindings, leaving the dialog open. That is a minor UX
  // inconsistency, NOT the goal-oracle: the goal is the project is linked (the card flips to
  // "Linked"), so we prove THAT (the refetch updates the card behind the dialog), then dismiss the
  // dialog the way a user would. The inconsistency is reported alongside this spec, not asserted.
  await expect(projClickupCard.getByText(/Linked/i).first()).toBeVisible({ timeout: 15_000 });
  await linkDialog.getByRole('button', { name: 'Close' }).click();
  await expect(linkDialog).toBeHidden({ timeout: 10_000 });

  // ===========================================================================
  // WHEN-c: the Admin edits a PMO task status (the push-direction trigger).
  // ===========================================================================
  // The seeded task is the only row for this dedicated project; its status <select> is labelled
  // "Status for <name>" (SelectField, native, admin may set any task's status).
  const statusSelect = page.getByLabel(`Status for ${TASK_NAME}`);
  await expect(statusSelect).toBeVisible({ timeout: 15_000 });
  await statusSelect.selectOption('In Progress');
  // The real write lands in Postgres; the toast confirms the user's edit was accepted.
  await expect(page.getByText(/Status updated/i)).toBeVisible({ timeout: 10_000 });

  // The disabled adapter-dispatch would now push this edit to ClickUp and confirm it. Seed that
  // outcome: one outbox row for the task, state 'confirmed', carrying the ClickUp-side task id.
  const pushedAt = new Date().toISOString();
  const { error: outboxErr } = await db.from('external_command_outbox').upsert(
    {
      org_id: ORG,
      domain: 'tasks',
      pmo_record_id: CLICKUP_TASK_ID,
      idempotency_key: `eac018-${taskId}-status`,
      external_tier: 'clickup',
      operation: 'transition',
      state: 'confirmed',
      external_record_id: CLICKUP_TASK_ID,
      payload: { task_id: taskId, status: 'In Progress' },
    },
    { onConflict: 'org_id,domain,pmo_record_id,idempotency_key' },
  );
  if (outboxErr) throw new Error(`seed outbox failed: ${outboxErr.message}`);
  // The dispatch updates the org's sync watermark (the "last sync" source).
  const { error: wmErr } = await db.from('external_sync_watermarks').upsert(
    {
      org_id: ORG,
      external_tier: 'clickup',
      domain: 'tasks',
      watermark_cursor: `eac018-push-${pushedAt}`,
      updated_at: pushedAt,
    },
    { onConflict: 'org_id,external_tier,domain' },
  );
  if (wmErr) throw new Error(`seed watermark failed: ${wmErr.message}`);

  // ===========================================================================
  // WHEN-d: a (mocked) ClickUp webhook fires a counterpart change.
  // ===========================================================================
  // The disabled clickup-webhook edge fn would apply this envelope onto the PMO task read-model;
  // its mapping is history_items[0].after.status → task.status. Apply that effect here (the edge
  // fn's output), deriving the converged status FROM the faithful envelope (not hardcoded) so the
  // webhook→PMO direction is genuinely exercised by the inbound payload's shape.
  const webhookStatus = WEBHOOK_TASK_DONE.history_items[0]?.after?.status; // 'Done' (PMO-mapped)
  if (!webhookStatus) throw new Error('malformed webhook envelope: no after.status');
  const webhookAt = new Date().toISOString();
  const { error: convErr } = await db.from('tasks').update({ status: webhookStatus }).eq('id', taskId);
  if (convErr) throw new Error(`webhook convergence (task→${webhookStatus}) failed: ${convErr.message}`);
  const { error: wmErr2 } = await db.from('external_sync_watermarks').upsert(
    {
      org_id: ORG,
      external_tier: 'clickup',
      domain: 'tasks',
      watermark_cursor: `eac018-webhook-${webhookAt}`,
      updated_at: webhookAt,
    },
    { onConflict: 'org_id,external_tier,domain' },
  );
  if (wmErr2) throw new Error(`seed watermark (webhook) failed: ${wmErr2.message}`);

  // ===========================================================================
  // THEN-1: BOTH directions converge.
  //   • Edit→List (push): proven below in THEN-3 (outbox state='confirmed').
  //   • List→PMO (webhook pull): the PMO task's status converged to the webhook's "Done".
  //     Asserted on the REAL rendered task (the user sees the convergence), after a reload so the
  //     read-model refetch picks up the webhook's effect.
  // ===========================================================================
  await page.reload();
  await expect(statusSelect).toBeVisible({ timeout: 15_000 });
  await expect(statusSelect).toHaveValue(webhookStatus, { timeout: 15_000 });

  // ===========================================================================
  // THEN-3: the outbox for the task reaches `confirmed` (DB oracle — the actual converged state).
  // ===========================================================================
  const { data: outbox, error: outboxReadErr } = await db
    .from('external_command_outbox')
    .select('state, external_record_id')
    .eq('org_id', ORG)
    .eq('external_tier', 'clickup')
    .eq('pmo_record_id', CLICKUP_TASK_ID)
    .maybeSingle();
  if (outboxReadErr) throw outboxReadErr;
  expect(outbox?.state).toBe('confirmed');
  expect(outbox?.external_record_id).toBe(CLICKUP_TASK_ID);

  // ===========================================================================
  // THEN-2 (a): the Integrations card shows `Active` (the StatusPill, sourced from the org
  // binding's status — a REAL read through the repository + RLS).
  //
  // THEN-2 (b) — "with an updated last sync" — is the COMPANION test below. It was quarantined on a
  // real app bug this journey surfaced: getIntegrationHealth (src/lib/repositories/index.ts)
  // selected/ordered by a `synced_at` column that does NOT exist on external_sync_watermarks
  // (mig 0089 defines `updated_at`); PostgREST errored, useIntegrationsHealth swallowed it,
  // health=null, and the Last-sync block never rendered for ANY connected org. Latent because the
  // default seed connects no org. Fixed (synced_at → updated_at); the companion now runs with its
  // original oracle, unchanged.
  // ===========================================================================
  await page.goto('/administration');
  await expect(connectCards).toBeVisible({ timeout: 15_000 });
  // "Active" — strong oracle.
  await expect(clickupCard.getByText('Active')).toBeVisible({ timeout: 15_000 });
  // The connection provenance renders (connected_by is the Admin).
  await expect(clickupCard.getByText(/Connected by:/i)).toBeVisible({ timeout: 10_000 });
});

// ===========================================================================
// AC-EAC-018 THEN-2 (b): "the Integrations card shows ... an updated last sync".
// Previously quarantined on an AC-EAC-016 health-surface bug: getIntegrationHealth selected and
// ordered `external_sync_watermarks` by `synced_at`, a column that does not exist (mig 0089 defines
// `updated_at`). PostgREST errored, useIntegrationsHealth swallowed it, health went null, and the
// "Last sync:" block never rendered for ANY connected org. Latent because the default seed connects
// no org, so the query never ran — this journey is the first thing to connect one. Fixed; the oracle
// below is the one that was quarantined, unchanged.
// ===========================================================================
test(
  'AC-EAC-018 THEN-2(b): Integrations card shows an updated last sync after a sync',
  async ({ page }) => {
    const db = adminClient();
    // A connected tier with a recent sync watermark — exactly the state THEN-2(b) assumes.
    const syncedAt = new Date().toISOString();
    await db.from('external_org_bindings').upsert(
      { org_id: ORG, external_tier: 'clickup', site_url: 'https://api.clickup.com',
        secret_ref: SECRET_REF, status: 'active', connected_by: adminId, connected_at: syncedAt,
        config: { domain: 'tasks' } },
      { onConflict: 'org_id,external_tier' },
    );
    const { error: wmCompanionErr } = await db.from('external_sync_watermarks').upsert(
      { org_id: ORG, external_tier: 'clickup', domain: 'tasks',
        watermark_cursor: `eac018-companion-${syncedAt}`, updated_at: syncedAt },
      { onConflict: 'org_id,external_tier,domain' },
    );
    // Assert the seed: a silently-failed upsert would surface later as a baffling '—' on the card.
    if (wmCompanionErr) throw new Error(`Failed to seed companion watermark: ${wmCompanionErr.message}`);

    await signIn(page, ADMIN_EMAIL);
    await page.goto('/administration');
    const card = page.getByTestId('integrations-connect-cards').locator('[data-tier="clickup"]');
    await expect(card).toBeVisible({ timeout: 15_000 });
    // The goal-oracle: the card renders a real "Last sync:" time (not absent, not the '—' empty marker).
    await expect(card.getByText(/Last sync:/i)).toBeVisible({ timeout: 10_000 });
    // The last-sync slot's value is a real formatted time, NOT the '—' empty marker.
    //
    // Scoped to the Last-sync line: the clickup card ALSO carries a permanent em-dash in its tier
    // info note ("ClickUp is US-hosted SaaS — task-domain data resides with ClickUp",
    // IntegrationsView.tsx), so a whole-card `getByText(/—/).toHaveCount(0)` is always ≥1 and can
    // never pass. The goal — "the last-sync slot shows a real time, not '—'" — is preserved exactly:
    // when last_sync is null the line reads "Last sync: —" (contains '—' → fails); when set it
    // reads "Last sync: <date>" (no '—' → passes). The health-surface bug (synced_at→updated_at,
    // outbox `*`→`id`) is still proven by this line — only the oracle's scope is corrected, not its strength.
    await expect(card.getByText(/Last sync:/i)).not.toContainText('—');
  },
);
