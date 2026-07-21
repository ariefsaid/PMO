/**
 * clickup-webhook-worker — Deno Edge Function entry point (OD-INT-11, 2026-07-20).
 *
 * The durable-queue processor for `clickup_webhook_inbox` (migration 0124). ClickUp's real webhook
 * delivery carries no task body and no timestamp, so `clickup-webhook` (the ingress) only verifies +
 * enqueues; THIS function re-GETs each pending task (`GET /task/{id}`) and applies the full current
 * state through the existing source-mod-guarded apply path (`applyWebhookEvent`,
 * `pmo-portal/src/lib/adapterSeam/clickup/webhookApply.ts`).
 *
 * Org/project binding resolution (FR-EAS-024): resolved from the re-GET'd `task.list.id` (the adopt
 * path) — NEVER from the payload, which never carries a `list_id` on a real delivery (that made the
 * adopt path unreachable dead code before this fix). The mapped path (an already-`external_refs`-linked
 * task) resolves without needing `list.id` at all, and also covers the `taskDeleted` / re-GET-404 branch
 * (there is no task to re-GET, so no `list.id` — the mapped lookup is the only way to find the org).
 *
 * Auth: a DEDICATED worker secret (CLICKUP_WEBHOOK_WORKER_SECRET, constant-time bearer check) — NOT the
 * master service_role key — mirrors clickup-sweep's least-privilege pattern (migration 0094/0124's
 * pg_cron tick presents this secret, never the master key, to the DB). Registered-but-idle until an
 * operator creates the two Vault secrets (0124), same precedent as 0048/0082/0094.
 *
 * The re-GET → resolve-binding → apply core (`processInboxRow`) and the claim/mark-done/mark-failed
 * bookkeeping (`runWorkerBatch`) are deps-injected and unit-tested (index.test.ts) with
 * `globalThis.fetch` mocked — no live ClickUp token or Supabase stack required. The bearer-auth
 * Deno.serve wrapper is INTEGRATION-ONLY (mirrors clickup-sweep), verified by `deno check` + the
 * boot-smoke.
 */

// Deno-native imports (not in pmo-portal/package.json)
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { constantTimeBearerEquals } from '../_shared/constantTimeBearerEquals.ts';
import { resolvePerOrgSecret } from '../_shared/perOrgSecret.ts';
import { clickUpGetTaskRaw } from '../../../pmo-portal/src/lib/adapterSeam/clickup/reads.ts';
import { applyWebhookEvent, type WebhookApplyDeps } from '../../../pmo-portal/src/lib/adapterSeam/clickup/webhookApply.ts';
import type { ApplyOutcome } from '../../../pmo-portal/src/lib/adapterSeam/applyEngine.ts';
import type { ClickUpHistoryItem, ClickUpTask, ClickUpWebhookEvent } from '../../../pmo-portal/src/lib/adapterSeam/clickup/types.ts';
import type { ClickUpStatusMap } from '../../../pmo-portal/src/lib/adapterSeam/clickup/statusMap.ts';
import type { ClickUpMemberMap } from '../../../pmo-portal/src/lib/adapterSeam/clickup/memberMap.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import {
  CLICKUP_TIER,
  CLICKUP_TASKS_DOMAIN,
  mapsFromBindingConfig,
  createClickUpMirrorCallbacks,
} from '../_shared/clickupMirrorDeps.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** One claimed `clickup_webhook_inbox` row — the worker's unit of work. */
export interface InboxRow {
  id: string;
  event: ClickUpWebhookEvent;
  task_id: string;
  team_id: string | null;
  history_items: ClickUpHistoryItem[];
}

/** A resolved org + project + status/member maps binding (mirrors clickup-webhook's pre-fix shape). */
export interface ResolvedBinding {
  orgId: string;
  projectId: string;
  statusMap: ClickUpStatusMap;
  memberMap: ClickUpMemberMap;
}

// ── processInboxRow — the re-GET + resolve-binding + apply core (unit-tested). ──────────────────────

/** The narrow, injectable surface `processInboxRow` needs. */
export interface ProcessRowDeps {
  /** Re-GET the task from ClickUp; `null` on a 404 (also used directly for `taskDeleted` — never
   *  called for that verb, there is nothing to re-GET). */
  resolveOrg: (teamId: string | null) => Promise<{ orgId: string; token: string } | null>;
  /** Re-GET the task from ClickUp with the already-authorized org token; `null` on a 404. */
  getTask: (taskId: string, token: string) => Promise<ClickUpTask | null>;
  /** Resolve the org/project binding: mapped path (task_id, works with a `null` listId) → adopt path
   *  (listId, from the re-GET'd `task.list.id` — never the payload) → the P1 single-org fallback.
   *  `null` when unresolvable (ack'd-and-skipped; the periodic sweep is the safety net). */
  resolveBinding: (taskId: string, listId: string | null) => Promise<ResolvedBinding | null>;
  /** Build the full `WebhookApplyDeps` bag (mirror callbacks + tombstoneMirror + archiveMirror) for a
   *  resolved binding. */
  buildApplyDeps: (binding: ResolvedBinding) => WebhookApplyDeps;
}

/**
 * Process one claimed inbox row: re-GET the task (skipped for `taskDeleted` — nothing to re-GET),
 * resolve the org/project binding from the re-GET's `list.id` (never the payload), and apply through
 * the existing source-mod-guarded engine. A binding that fails to resolve is ack'd (no-op) — the
 * periodic sweep (ADR-0055 §3) is the safety net, matching the pre-fix ingress's "no-binding" stance.
 */
export async function processInboxRow(row: InboxRow, deps: ProcessRowDeps): Promise<ApplyOutcome> {
  const org = await deps.resolveOrg(row.team_id);
  if (!org) return { kind: 'no-op' };
  const task = row.event === 'taskDeleted' ? null : await deps.getTask(row.task_id, org.token);
  const listId = task?.list?.id ?? null;
  const binding = await deps.resolveBinding(row.task_id, listId);
  if (!binding) return { kind: 'no-op' };
  const applyDeps = deps.buildApplyDeps(binding);
  return applyWebhookEvent({ event: row.event, taskId: row.task_id, historyItems: row.history_items, task }, applyDeps);
}

// ── runWorkerBatch — claim / process / mark-done / mark-failed bookkeeping (unit-tested). ──────────

export interface WorkerBatchDeps {
  claimPending: (batchSize: number) => Promise<InboxRow[]>;
  markDone: (id: string) => Promise<void>;
  markFailed: (id: string, error: string) => Promise<void>;
  processRow: (row: InboxRow) => Promise<ApplyOutcome>;
}

export interface WorkerBatchResult {
  claimed: number;
  processed: number;
  failed: number;
}

/**
 * Claim up to `batchSize` pending rows and process each. A `23505` (concurrent adopt — FR-CUA-064) is
 * RECOVERABLE, not a failure: the loser reconciles to the winner's mapping on the NEXT tick (the
 * per-row source-mod guard converges), so it is marked done rather than failed (never alert-spam). Any
 * other thrown error marks the row `failed` (with the detail + an incremented `attempts`) and the batch
 * continues — one row's failure must not block the rest (no cross-task DoS).
 */
export async function runWorkerBatch(deps: WorkerBatchDeps, batchSize = 25): Promise<WorkerBatchResult> {
  const rows = await deps.claimPending(batchSize);
  let processed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await deps.processRow(row);
      await deps.markDone(row.id);
      processed += 1;
    } catch (err) {
      const code = err instanceof AppError ? err.code : (err as { code?: string } | null)?.code;
      if (code === '23505') {
        await deps.markDone(row.id);
        processed += 1;
        continue;
      }
      const message = err instanceof Error ? err.message : 'processing failed';
      console.error(`[clickup-webhook-worker] row failed: id=${row.id} task=${row.task_id} event=${row.event} detail=${message}`);
      await deps.markFailed(row.id, message);
      failed += 1;
    }
  }
  return { claimed: rows.length, processed, failed };
}

// ── The real wiring the Deno.serve wrapper uses (DB + ClickUp HTTP + mirror callbacks). ────────────

export function getTaskWithToken(taskId: string, token: string): Promise<ClickUpTask | null> {
  return clickUpGetTaskRaw(taskId, { fetchImpl: fetch, token });
}

async function resolveOrgForTeam(
  serviceClient: SupabaseClient,
  teamId: string | null,
): Promise<{ orgId: string; token: string } | null> {
  if (!teamId) return null;
  const { data: binding, error } = await serviceClient
    .from('external_org_bindings')
    .select('org_id, secret_ref')
    .eq('external_tier', CLICKUP_TIER)
    .eq('config->>clickup_team_id', teamId)
    .maybeSingle();
  if (error || !binding) return null;
  const orgId = (binding as { org_id?: string }).org_id;
  if (!orgId) return null;
  const result = await resolvePerOrgSecret({
    connectEnabled: true,
    orgId,
    tier: CLICKUP_TIER,
    lookupBinding: async () => binding as { secret_ref?: string | null },
    readVaultSecret: async (ref) => {
      const { data, error: vaultError } = await serviceClient.rpc('read_vault_secret', { p_secret_ref: ref });
      if (vaultError) return null;
      return (data as string | null) ?? null;
    },
  });
  return result.kind === 'resolved' ? { orgId, token: result.secret } : null;
}

function bindingFromRow(row: { org_id: string; project_id: string; config: unknown }): ResolvedBinding {
  const { statusMap, memberMap } = mapsFromBindingConfig(row.config);
  return { orgId: row.org_id, projectId: row.project_id, statusMap, memberMap };
}

/** Resolve the per-project binding for a task — mirrors the pre-fix ingress's `resolveBinding`, now
 *  parameterized on an explicit `listId` (the WORKER's re-GET) instead of a nonexistent payload field. */
async function resolveBindingLive(
  serviceClient: SupabaseClient,
  taskId: string,
  listId: string | null,
): Promise<ResolvedBinding | null> {
  // 1. Mapped path: external_refs(task_id) -> org + pmo_record_id -> the task row's project. Works
  //    with NO listId (also serves the taskDeleted / re-GET-404 branch).
  const { data: ref } = await serviceClient
    .from('external_refs')
    .select('org_id, pmo_record_id')
    .eq('domain', CLICKUP_TASKS_DOMAIN)
    .eq('external_record_id', taskId)
    .maybeSingle();
  const mappedRef = ref as { org_id: string; pmo_record_id: string } | null;
  if (mappedRef) {
    const { data: taskRow } = await serviceClient
      .from('tasks')
      .select('project_id')
      .eq('org_id', mappedRef.org_id)
      .eq('id', mappedRef.pmo_record_id)
      .maybeSingle();
    const projectId = (taskRow as { project_id: string } | null)?.project_id;
    if (projectId) {
      const { data } = await serviceClient
        .from('external_project_bindings')
        .select('org_id, project_id, config')
        .eq('org_id', mappedRef.org_id)
        .eq('project_id', projectId)
        .eq('external_tier', CLICKUP_TIER)
        .maybeSingle();
      const row = data as { org_id: string; project_id: string; config: unknown } | null;
      if (row) return bindingFromRow(row);
    }
  }

  // 2. Adopt path: the re-GET'd task's List id -> the binding directly (carries org + project + maps).
  //    2026-07-20 fix: `listId` is the worker's re-GET (`task.list.id`), NEVER the payload — the
  //    payload never carries a list_id on a real delivery, which made this path unreachable before.
  if (listId) {
    const { data: byList } = await serviceClient
      .from('external_project_bindings')
      .select('org_id, project_id, config')
      .eq('external_tier', CLICKUP_TIER)
      .eq('external_container_id', listId)
      .maybeSingle();
    const row = byList as { org_id: string; project_id: string; config: unknown } | null;
    if (row) return bindingFromRow(row);
  }

  // 3. P1 fallback: a single employing org with a single binding. If unambiguous, use it; else null.
  const { data: ownership } = await serviceClient
    .from('external_domain_ownership')
    .select('org_id')
    .eq('external_tier', CLICKUP_TIER)
    .eq('domain', CLICKUP_TASKS_DOMAIN);
  const orgIds = ((ownership as Array<{ org_id: string }> | null) ?? []).map((r) => r.org_id);
  if (orgIds.length === 1) {
    const { data: anyBinding } = await serviceClient
      .from('external_project_bindings')
      .select('org_id, project_id, config')
      .eq('org_id', orgIds[0])
      .eq('external_tier', CLICKUP_TIER)
      .maybeSingle();
    const row = anyBinding as { org_id: string; project_id: string; config: unknown } | null;
    if (row) return bindingFromRow(row);
  }

  return null;
}

/** Build the full `WebhookApplyDeps` bag for a resolved binding: the shared mirror callbacks
 *  (resolvePmoRecordId/updateMirror/mintMirror/watermark/recordExternalRef) + tombstoneMirror +
 *  archiveMirror. `archiveMirror` writes `tasks.archived_at` — that column ships on migration 0123
 *  (`origin/feat/task-model-fields`), NOT on `dev` yet (see docs/plans/2026-07-20-clickup-integration-
 *  completion.md's OD-INT-9 note). This write path is coded AGAINST that column now (the correct
 *  shipped behavior once merged); it will 42703 (undefined column) if actually exercised against a `dev`
 *  DB before that migration lands. Nothing exercises this path today (the flag is off, no live archive
 *  events occur) — see the ONE skipped integration-style test in index.test.ts naming this dependency. */
function buildApplyDepsLive(serviceClient: SupabaseClient, binding: ResolvedBinding): WebhookApplyDeps {
  const mirrorCallbacks = createClickUpMirrorCallbacks({
    serviceClient,
    orgId: binding.orgId,
    projectId: binding.projectId,
  });
  return {
    ...mirrorCallbacks,
    statusMap: binding.statusMap,
    memberMap: binding.memberMap,
    tombstoneMirror: async (pmoRecordId) => {
      const { error } = await serviceClient
        .from('tasks')
        .update({ tombstoned_at: new Date().toISOString() })
        .eq('org_id', binding.orgId)
        .eq('id', pmoRecordId);
      if (error) throw new AppError(error.message, error.code);
    },
    archiveMirror: async (pmoRecordId, archivedAtIso) => {
      const { error } = await serviceClient
        .from('tasks')
        .update({ archived_at: archivedAtIso })
        .eq('org_id', binding.orgId)
        .eq('id', pmoRecordId);
      if (error) throw new AppError(error.message, error.code);
    },
    surfaceDeletion: async (pmoRecordId, externalRecordId) => {
      console.warn(
        `[clickup-webhook-worker] task tombstoned: org=${binding.orgId} pmoRecordId=${pmoRecordId} clickupTaskId=${externalRecordId}`,
      );
    },
  };
}

async function claimPendingLive(serviceClient: SupabaseClient, batchSize: number): Promise<InboxRow[]> {
  const { data, error } = await serviceClient
    .from('clickup_webhook_inbox')
    .select('id, event, task_id, team_id, history_items')
    .eq('status', 'pending')
    .order('received_at', { ascending: true })
    .limit(batchSize);
  if (error) throw new AppError(error.message, error.code);
  const rows = (data as InboxRow[] | null) ?? [];
  // Best-effort claim: mark processing before working the batch (not a fenced/SKIP LOCKED claim — the
  // apply path is idempotent under a rare double-dequeue by a second concurrent tick, so at-least-once
  // is acceptable here; see the plan's "simplest thing that survives a >7s budget" stance).
  if (rows.length > 0) {
    await serviceClient
      .from('clickup_webhook_inbox')
      .update({ status: 'processing' })
      .in('id', rows.map((r) => r.id));
  }
  return rows;
}

async function markDoneLive(serviceClient: SupabaseClient, id: string): Promise<void> {
  const { error } = await serviceClient
    .from('clickup_webhook_inbox')
    .update({ status: 'done', processed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new AppError(error.message, error.code);
}

async function markFailedLive(serviceClient: SupabaseClient, id: string, message: string): Promise<void> {
  // Best-effort read-then-increment (matches the best-effort claim above — no fencing needed, this is
  // an operator-visible retry counter, not a correctness guard).
  const { data } = await serviceClient.from('clickup_webhook_inbox').select('attempts').eq('id', id).maybeSingle();
  const currentAttempts = (data as { attempts: number } | null)?.attempts ?? 0;
  const { error } = await serviceClient
    .from('clickup_webhook_inbox')
    .update({
      status: 'failed',
      last_error: message,
      attempts: currentAttempts + 1,
      processed_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new AppError(error.message, error.code);
}

if (import.meta.main) {
  Deno.serve(async (req: Request): Promise<Response> => {
    // The DEDICATED worker secret (NOT the master service_role key — least-privilege, mirrors
    // clickup-sweep's CLICKUP_SWEEP_SECRET pattern). The pg_cron tick (migration 0124) presents this
    // same secret from Vault; the master key never crosses into the DB.
    const workerSecret = Deno.env.get('CLICKUP_WEBHOOK_WORKER_SECRET') ?? '';
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!workerSecret || !(await constantTimeBearerEquals(authHeader, `Bearer ${workerSecret}`))) {
      return json({ error: 'UNAUTHORIZED' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: 'MISCONFIGURED', message: 'missing Supabase configuration' }, 500);
    }
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    const result = await runWorkerBatch({
      claimPending: (batchSize) => claimPendingLive(serviceClient, batchSize),
      markDone: (id) => markDoneLive(serviceClient, id),
      markFailed: (id, message) => markFailedLive(serviceClient, id, message),
      processRow: (row) =>
        processInboxRow(row, {
          resolveOrg: (teamId) => resolveOrgForTeam(serviceClient, teamId),
          getTask: (taskId, token) => getTaskWithToken(taskId, token),
          resolveBinding: (taskId, listId) => resolveBindingLive(serviceClient, taskId, listId),
          buildApplyDeps: (binding) => buildApplyDepsLive(serviceClient, binding),
        }),
    });
    return json({ ok: true, ...result });
  });
}
