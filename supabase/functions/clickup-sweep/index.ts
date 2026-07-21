/**
 * clickup-sweep — Deno Edge Function entry point (Slice D, FR-CUA-045/048, AC-CUA-043/044).
 *
 * The reconciliation sweep — the safety net that catches webhook gaps (ADR-0055 §3: webhooks for
 * latency, sweep for truth). Dedicated-sweep-secret-guarded (`verify_jwt = false`; the handler verifies
 * the bearer itself — it MUST equal CLICKUP_SWEEP_SECRET, constant-time), mirroring agent-dispatch's
 * AGENT_DISPATCH_SECRET least-privilege pattern (0082): the caller is the pg_cron job (migration 0092),
 * not a browser JWT, and the dedicated sweep secret can at worst trigger a tick — never grant DB access.
 * The master SUPABASE_SERVICE_ROLE_KEY stays ONLY in this fn's env (used to mint the service client);
 * the cron never sees it (0092 reads clickup_sweep_url + clickup_sweep_secret from Vault, not the
 * master key). Registered-but-idle per the 0048/0082 precedent: the cron helper no-ops until an operator
 * creates those two Vault secrets, so the job fires as a no-op until then.
 *
 * Thin wiring ONLY — the sweep engine (apply via the shared source-mod-guarded applyInboundChange,
 * monotonic watermark advance, unreachable ⇒ no advance) is unit-tested under sweep.test.ts. This
 * file is INTEGRATION-ONLY — verified by `deno check` + the boot-smoke.
 *
 * Phase 1b (task 1.6): Per-org Vault credential resolution behind EXTERNAL_CONNECT_ENABLED flag.
 * When flag is ON: iterate external_org_bindings for ClickUp tier, resolve each org's token via Vault.
 * When flag is OFF (default): legacy global CLICKUP_API_TOKEN behavior unchanged.
 */

// Deno-native imports (not in pmo-portal/package.json)
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { constantTimeBearerEquals } from '../_shared/constantTimeBearerEquals.ts';
import {
  runMultiListSweep,
  type MultiListSweepBinding,
  type MultiListSweepPerListResult,
} from '../../../pmo-portal/src/lib/adapterSeam/clickup/multiListSweep.ts';
import { ClickUpRateLimiter } from '../../../pmo-portal/src/lib/adapterSeam/clickup/rateLimit.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { resolvePerOrgSecret } from '../_shared/perOrgSecret.ts';
import {
  CLICKUP_TIER,
  CLICKUP_TASKS_DOMAIN,
  mapsFromBindingConfig,
  createClickUpMirrorCallbacks,
} from '../_shared/clickupMirrorDeps.ts';

// Shared across invocations of this isolate (NFR-CUA-PERF-003). Bulk lane: the sweep yields to any
// in-flight interactive write.
const rateLimiter = new ClickUpRateLimiter();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * SEC-HIGH-1: each bound List gets its OWN watermark cursor row — never a single value shared/merged
 * across every List on the org (the org already has ONE `external_sync_watermarks` row per
 * (org, tier, domain); domain='tasks' stays the webhook's + onboard's org-level key, UNCHANGED). Keyed
 * by a distinct, per-List domain literal so no schema migration is needed and no OTHER caller of
 * `external_sync_watermarks` (webhook, onboard's pull-adopt, the ERPNext sweep) is affected — they
 * never read/write this literal. Confined to this file: `external_refs`/`recordExternalRef` (the
 * task-id -> PMO-record mapping) still uses the plain `CLICKUP_TASKS_DOMAIN` ('tasks'), unaffected.
 */
function listWatermarkDomain(listId: string): string {
  return `${CLICKUP_TASKS_DOMAIN}:list:${listId}`;
}

async function readListWatermark(serviceClient: SupabaseClient, orgId: string, listId: string): Promise<string | null> {
  const { data } = await serviceClient
    .from('external_sync_watermarks')
    .select('watermark_cursor')
    .eq('org_id', orgId)
    .eq('external_tier', CLICKUP_TIER)
    .eq('domain', listWatermarkDomain(listId))
    .maybeSingle();
  return (data as { watermark_cursor: string | null } | null)?.watermark_cursor ?? null;
}

async function advanceListWatermark(serviceClient: SupabaseClient, orgId: string, listId: string, cursor: string): Promise<void> {
  const { error } = await serviceClient.from('external_sync_watermarks').upsert(
    { org_id: orgId, external_tier: CLICKUP_TIER, domain: listWatermarkDomain(listId), watermark_cursor: cursor },
    { onConflict: 'org_id,external_tier,domain' },
  );
  if (error) throw new AppError(error.message, error.code);
}

/**
 * SEC-HIGH-2: resolve the project an EXISTING mirror actually belongs to — the deterministic-resolution
 * source of truth (never guessed off whichever List tagged the task this cycle).
 */
async function readMirrorProjectId(serviceClient: SupabaseClient, orgId: string, pmoRecordId: string): Promise<string | null> {
  const { data } = await serviceClient
    .from('tasks')
    .select('project_id')
    .eq('org_id', orgId)
    .eq('id', pmoRecordId)
    .maybeSingle();
  return (data as { project_id: string | null } | null)?.project_id ?? null;
}

/**
 * SEC-MEDIUM-6: archive an existing mirror whose ClickUp source task is now archived. `tasks.archived_at`
 * does NOT exist on `dev` yet — it lands with `origin/feat/task-model-fields` migration 0123, which is
 * deliberately NOT merged into this branch (same "no archived_at column" stance as reads.ts's
 * `buildListQuery` docstring). This write is coded AGAINST that column so it activates the moment that
 * migration merges; the untyped `SupabaseClient` here means this is not a compile-time error, only a
 * real-DB one, which no gate in this branch's verify suite exercises (no live e2e). The ONE test that
 * would prove a real round-trip is `.skip`-marked in `archiveMirror.test.ts`, naming this exact
 * dependency — the orchestration layer (`multiListSweep.test.ts`) already proves `archiveMirror` is
 * invoked with the correct `pmoRecordId`, which is everything provable without the column.
 */
export async function archiveMirror(serviceClient: SupabaseClient, orgId: string, pmoRecordId: string): Promise<void> {
  const { error } = await serviceClient
    .from('tasks')
    .update({ archived_at: new Date().toISOString() })
    .eq('org_id', orgId)
    .eq('id', pmoRecordId);
  if (error) throw new AppError(error.message, error.code);
}

/**
 * Mark a bound List's binding unhealthy (item 5, bound-List lifecycle): the List 404'd on read (deleted
 * or moved in ClickUp). Recorded in the binding's own `config` jsonb (no new table/column — the "P4
 * health surface" is org-tier-wide, not per-project-List-granular, so this is the smallest useful
 * per-binding signal). Deliberately does NOT attempt List-move recovery — that is a separate issue.
 * Best-effort: a failure here is logged, never thrown (must not abort the rest of the sweep).
 *
 * SEC-MEDIUM-4: the read-then-merge-then-write here raced a CONCURRENT writer of the SAME `config`
 * jsonb (e.g. `external-connect`'s clickup_actor_id persist on a DIFFERENT table's row, or two sweep
 * ticks overlapping) — the loser's stale merged object silently clobbered the winner's key. Routed
 * through the atomic `merge_external_project_binding_config` RPC (`config = config || patch` in ONE
 * statement) instead of a client-side read-then-write.
 */
async function markBindingUnhealthy(serviceClient: SupabaseClient, orgId: string, listId: string): Promise<void> {
  const { error } = await serviceClient.rpc('merge_external_project_binding_config', {
    p_org_id: orgId,
    p_external_tier: CLICKUP_TIER,
    p_container_id: listId,
    p_patch: {
      unhealthy: true,
      last_error: 'ClickUp List not found (404) — deleted or moved',
      last_error_at: new Date().toISOString(),
    },
  });
  if (error) {
    console.error(`[clickup-sweep] unhealthy-mark merge failed: org=${orgId} list=${listId}`, error);
  }
}

/** Sweep one org: enumerate changes across all its bound Lists (each on its OWN cursor), apply,
 *  archive, advance each List's watermark independently. */
async function sweepOrg(
  serviceClient: SupabaseClient,
  orgId: string,
  token: string,
): Promise<{ applied: number; archived: number; skippedAmbiguous: number; perList: MultiListSweepPerListResult[]; error?: string }> {
  // Load the org's ClickUp bindings (one List per bound project).
  const { data: bindingRows, error: bindingError } = await serviceClient
    .from('external_project_bindings')
    .select('project_id, external_container_id, config')
    .eq('org_id', orgId)
    .eq('external_tier', CLICKUP_TIER);
  if (bindingError) throw new AppError(bindingError.message, bindingError.code);
  const rows = (bindingRows as Array<{ project_id: string; external_container_id: string; config: unknown }> | null) ?? [];
  if (rows.length === 0) return { applied: 0, archived: 0, skippedAmbiguous: 0, perList: [] }; // bound to nothing yet

  const bindings: MultiListSweepBinding[] = rows.map((r) => {
    const { statusMap, memberMap } = mapsFromBindingConfig(r.config);
    return { listId: r.external_container_id, projectId: r.project_id, statusMap, memberMap };
  });

  // Shared mirror-callback bag (review fix #3): resolvePmoRecordId / readMirrorSourceMod /
  // updateMirror / recordExternalRef come from the shared factory. `mintMirror` is overridden below —
  // the multi-List sweep resolves the project PER task (SEC-HIGH-2), not from a single fixed projectId.
  const mirrorCallbacks = createClickUpMirrorCallbacks({ serviceClient, orgId });

  try {
    return await runMultiListSweep({
      bindings,
      clientDeps: { fetchImpl: fetch, token, rateLimiter },
      readListWatermark: (listId) => readListWatermark(serviceClient, orgId, listId),
      advanceListWatermark: (listId, cursor) => advanceListWatermark(serviceClient, orgId, listId, cursor),
      markListUnhealthy: (listId) => markBindingUnhealthy(serviceClient, orgId, listId),
      resolvePmoRecordId: mirrorCallbacks.resolvePmoRecordId,
      readMirrorSourceMod: mirrorCallbacks.readMirrorSourceMod,
      readMirrorProjectId: (pmoRecordId) => readMirrorProjectId(serviceClient, orgId, pmoRecordId),
      updateMirror: mirrorCallbacks.updateMirror,
      mintMirror: async (canonical, sourceModMs, projectId) => {
        const pmoRecordId = crypto.randomUUID();
        const { error } = await serviceClient.from('tasks').insert({
          id: pmoRecordId,
          org_id: orgId,
          project_id: projectId,
          name: canonical.name,
          status: canonical.status,
          assignee_id: canonical.assignee_id ?? null,
          start_date: canonical.start_date ?? null,
          end_date: canonical.end_date ?? null,
          completed_at: (canonical.completed_at as string | null | undefined) ?? null,
          source_updated_at: new Date(sourceModMs).toISOString(),
        });
        if (error) throw new AppError(error.message, error.code);
        return pmoRecordId;
      },
      recordExternalRef: mirrorCallbacks.recordExternalRef,
      archiveMirror: (pmoRecordId) => archiveMirror(serviceClient, orgId, pmoRecordId),
    });
  } catch (err) {
    // AC-CUA-044: an unreachable adapter (or any apply failure) leaves every List's watermark + the
    // read-model untouched (runMultiListSweep throws before advancing). Surface the per-org failure;
    // the next schedule retries.
    const message = err instanceof Error ? err.message : 'sweep failed';
    return { applied: 0, archived: 0, skippedAmbiguous: 0, perList: [], error: message };
  }
}

/** Resolve a single org's ClickUp token: Vault-first when EXTERNAL_CONNECT_ENABLED=true, else global fallback.
 * ClickUp: fail CLOSED on binding-vault-miss (bound org with missing Vault secret). */
async function resolveOrgClickUpToken(
  serviceClient: SupabaseClient,
  orgId: string,
): Promise<string> {
  const globalToken = Deno.env.get('CLICKUP_API_TOKEN') ?? '';

  // Use shared per-org Vault secret resolution (flag gate + binding lookup + tri-state result)
  const result = await resolvePerOrgSecret({
    connectEnabled: Deno.env.get('EXTERNAL_CONNECT_ENABLED') === 'true',
    orgId,
    tier: 'clickup',
    lookupBinding: async (orgId, tier) => {
      const { data, error } = await serviceClient
        .from('external_org_bindings')
        .select('secret_ref')
        .eq('org_id', orgId)
        .eq('external_tier', tier)
        .maybeSingle();
      if (error) return null;
      return data as { secret_ref?: string | null } | null;
    },
    readVaultSecret: async (ref) => {
      const { data, error } = await serviceClient.rpc('read_vault_secret', { p_secret_ref: ref });
      if (error) {
        console.error('read_vault_secret failed', error);
        return null;
      }
      return (data as string | null) ?? null;
    },
  });

  if (result.kind === 'resolved') {
    return result.secret;
  }
  if (result.kind === 'binding-vault-miss') {
    // Bound org but Vault secret missing — FAIL CLOSED (no global fallback)
    throw new AppError('ClickUp credentials unresolved for this org — check the binding secret_ref configuration', 'config-rejected');
  }
  // kind === 'no-binding' → use global fallback
  return globalToken;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // ── 1. Authorization: the caller (the pg_cron job) must present the DEDICATED sweep secret (NOT the
  //    master service_role key — least-privilege, mirroring 0082's AGENT_DISPATCH_SECRET). The cron
  //    presents this same secret from the Vault `clickup_sweep_secret`; the master key never crosses
  //    into the DB. ──
  const sweepSecret = Deno.env.get('CLICKUP_SWEEP_SECRET') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!sweepSecret || !(await constantTimeBearerEquals(authHeader, `Bearer ${sweepSecret}`))) {
    return json({ error: 'UNAUTHORIZED' }, 401);
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  // The master service_role key stays ONLY in this fn's env (used to mint the service client that
  // applies mirror writes). It is NEVER the auth bearer (the dedicated CLICKUP_SWEEP_SECRET is).
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'MISCONFIGURED', message: 'missing Supabase configuration' }, 500);

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  // ── 2. Iterate employing orgs via external_domain_ownership (ClickUp tasks tier) → sweep each with its token.
  // FIX-3: Restore legacy discovery (byte-for-byte the origin/dev query) so flag-off/prod works.
  const { data: ownership, error: ownershipError } = await serviceClient
    .from('external_domain_ownership')
    .select('org_id')
    .eq('external_tier', CLICKUP_TIER)
    .eq('domain', CLICKUP_TASKS_DOMAIN);
  if (ownershipError) return json({ error: ownershipError.code ?? 'OWNERSHIP_READ_FAILED', message: ownershipError.message }, 500);
  const orgIds = Array.from(new Set(((ownership as Array<{ org_id: string }> | null) ?? []).map((r) => r.org_id)));

  const perOrg = [];
  const failures = [];
  let totalApplied = 0;
  for (const orgId of orgIds) {
    // Per-org isolation: a fail-closed token error (bound org whose Vault secret is missing) or a
    // sweep error for ONE org must not abort reconciliation for the OTHERS (no cross-org DoS). Record
    // the failure and continue; the org's watermark simply does not advance and retries next schedule.
    try {
      const token = await resolveOrgClickUpToken(serviceClient, orgId);
      const result = await sweepOrg(serviceClient, orgId, token);
      totalApplied += result.applied;
      perOrg.push({ orgId, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[clickup-sweep] org sweep failed: org=${orgId} detail=${message}`);
      failures.push({ orgId, error: message });
    }
  }

  return json({ ok: true, orgs: orgIds.length, applied: totalApplied, perOrg, failures });
});