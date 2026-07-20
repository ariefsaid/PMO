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
import { runSweep, type SweepChange } from '../../../pmo-portal/src/lib/adapterSeam/clickup/sweep.ts';
import { clickUpListRawChangesAcrossLists } from '../../../pmo-portal/src/lib/adapterSeam/clickup/reads.ts';
import { clickUpTaskToPmoRecord, type ClickUpMaps } from '../../../pmo-portal/src/lib/adapterSeam/clickup/mapping.ts';
import { ClickUpRateLimiter } from '../../../pmo-portal/src/lib/adapterSeam/clickup/rateLimit.ts';
import type { ClickUpStatusMap } from '../../../pmo-portal/src/lib/adapterSeam/clickup/statusMap.ts';
import type { ClickUpMemberMap } from '../../../pmo-portal/src/lib/adapterSeam/clickup/memberMap.ts';
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

/** A loaded per-project binding (the external_project_bindings row, PMO-shaped). */
interface LoadedBinding {
  orgId: string;
  projectId: string;
  listId: string;
  statusMap: ClickUpStatusMap;
  memberMap: ClickUpMemberMap;
}

function mapsOf(binding: LoadedBinding): ClickUpMaps {
  return { statusMap: binding.statusMap, memberMap: binding.memberMap };
}

/**
 * Mark a bound List's binding unhealthy (item 5, bound-List lifecycle): the List 404'd on read (deleted
 * or moved in ClickUp). Recorded in the binding's own `config` jsonb (no new table/column — the "P4
 * health surface" is org-tier-wide, not per-project-List-granular, so this is the smallest useful
 * per-binding signal). Deliberately does NOT attempt List-move recovery — that is a separate issue.
 * Best-effort: a failure here is logged, never thrown (must not abort the rest of the sweep).
 */
async function markBindingUnhealthy(serviceClient: SupabaseClient, orgId: string, listId: string): Promise<void> {
  const { data: current, error: readError } = await serviceClient
    .from('external_project_bindings')
    .select('config')
    .eq('org_id', orgId)
    .eq('external_tier', CLICKUP_TIER)
    .eq('external_container_id', listId)
    .is('disconnected_at', null)
    .maybeSingle();
  if (readError) {
    console.error(`[clickup-sweep] unhealthy-mark config read failed: org=${orgId} list=${listId}`, readError);
    return;
  }
  const mergedConfig = {
    ...((current?.config as Record<string, unknown> | null) ?? {}),
    unhealthy: true,
    last_error: 'ClickUp List not found (404) — deleted or moved',
    last_error_at: new Date().toISOString(),
  };
  const { error: updateError } = await serviceClient
    .from('external_project_bindings')
    .update({ config: mergedConfig })
    .eq('org_id', orgId)
    .eq('external_tier', CLICKUP_TIER)
    .eq('external_container_id', listId)
    .is('disconnected_at', null);
  if (updateError) {
    console.error(`[clickup-sweep] unhealthy-mark update failed: org=${orgId} list=${listId}`, updateError);
  }
}

/** Sweep one org: enumerate changes across all its bound Lists, apply, advance the org watermark. */
async function sweepOrg(serviceClient: SupabaseClient, orgId: string, token: string): Promise<{ applied: number; nextCursor: string | null; error?: string }> {
  // Load the org's ClickUp bindings (one List per bound project).
  const { data: bindingRows, error: bindingError } = await serviceClient
    .from('external_project_bindings')
    .select('project_id, external_container_id, config')
    .eq('org_id', orgId)
    .eq('external_tier', CLICKUP_TIER);
  if (bindingError) throw new AppError(bindingError.message, bindingError.code);
  const rows = (bindingRows as Array<{ project_id: string; external_container_id: string; config: unknown }> | null) ?? [];
  if (rows.length === 0) return { applied: 0, nextCursor: null }; // bound to nothing yet — nothing to sweep

  const bindings: LoadedBinding[] = rows.map((r) => {
    const { statusMap, memberMap } = mapsFromBindingConfig(r.config);
    return {
      orgId,
      projectId: r.project_id,
      listId: r.external_container_id,
      statusMap,
      memberMap,
    };
  });

  // For adopt-mint project resolution: each enumerated task is tagged with its List's project here.
  const projectByClickUpTaskId = new Map<string, string>();
  // Shared mirror-callback bag (review fix #3): resolvePmoRecordId / readMirrorSourceMod /
  // updateMirror / readWatermark / advanceWatermark / recordExternalRef all come from the shared
  // factory. `mintMirror` is overridden below (the multi-List sweep resolves the project per task).
  const mirrorCallbacks = createClickUpMirrorCallbacks({ serviceClient, orgId, projectId: bindings[0].projectId });

  try {
    return {
      ...await runSweep({
        ...mirrorCallbacks,
        statusMap: bindings[0].statusMap, // maps are per-List; the apply-side mapping happens in
        memberMap: bindings[0].memberMap,  // listChanges below (per binding), so these are unused there
        // Merged multi-List enumeration: query every bound List with the org cursor, merge changes
        // (each tagged with its project), return the max nextCursor across the Lists that read OK.
        // A 404'd List (deleted/moved) is skipped — not thrown — so it no longer poisons the WHOLE
        // org's sweep (item 5, bound-List lifecycle); its binding is marked unhealthy instead.
        listChanges: async (cursor): Promise<{ changes: SweepChange[]; nextCursor: string | null }> => {
          const bindingByListId = new Map(bindings.map((b) => [b.listId, b]));
          const { changes: tagged, nextCursor, notFoundListIds } = await clickUpListRawChangesAcrossLists(
            cursor,
            bindings.map((b) => ({ listId: b.listId, statusMap: b.statusMap, memberMap: b.memberMap })),
            { fetchImpl: fetch, token, rateLimiter },
          );
          for (const listId of notFoundListIds) {
            await markBindingUnhealthy(serviceClient, orgId, listId);
          }
          const all: SweepChange[] = tagged.map(({ task: t, listId }) => {
            const binding = bindingByListId.get(listId);
            if (binding) projectByClickUpTaskId.set(t.id, binding.projectId); // tag for adopt-mint resolution
            const maps = binding ? mapsOf(binding) : { statusMap: bindings[0].statusMap, memberMap: bindings[0].memberMap };
            return { record: clickUpTaskToPmoRecord(t, maps), sourceModMs: Number(t.date_updated) };
          });
          return { changes: all, nextCursor };
        },
        mintMirror: async (canonical, sourceModMs) => {
          // Adopt: the project is the change's List's project (tagged during listChanges). Overrides the
          // shared mintMirror because the multi-List sweep resolves the project PER task.
          const mintProjectId = projectByClickUpTaskId.get(canonical.id) ?? bindings[0].projectId;
          const pmoRecordId = crypto.randomUUID();
          const { error } = await serviceClient.from('tasks').insert({
            id: pmoRecordId,
            org_id: orgId,
            project_id: mintProjectId,
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
      }),
    };
  } catch (err) {
    // AC-CUA-044: an unreachable adapter (or any apply failure) leaves the watermark + read-model
    // untouched (runSweep threw before advancing). Surface the per-org failure; the next schedule retries.
    const message = err instanceof Error ? err.message : 'sweep failed';
    return { applied: 0, nextCursor: null, error: message };
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