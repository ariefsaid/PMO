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
import { clickUpListRawChangesSinceWatermark } from '../../../pmo-portal/src/lib/adapterSeam/clickup/reads.ts';
import { clickUpTaskToPmoRecord, type ClickUpMaps } from '../../../pmo-portal/src/lib/adapterSeam/clickup/mapping.ts';
import { ClickUpRateLimiter } from '../../../pmo-portal/src/lib/adapterSeam/clickup/rateLimit.ts';
import type { ClickUpStatusMap } from '../../../pmo-portal/src/lib/adapterSeam/clickup/statusMap.ts';
import type { ClickUpMemberMap } from '../../../pmo-portal/src/lib/adapterSeam/clickup/memberMap.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { resolveClickUpCredentialsFromVault } from '../../../pmo-portal/src/lib/adapterSeam/clickup/vaultCredentials.ts';
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
        // (each tagged with its project), return the max nextCursor across Lists.
        listChanges: async (cursor): Promise<{ changes: SweepChange[]; nextCursor: string | null }> => {
          const all: SweepChange[] = [];
          let maxNext: string | null = null;
          for (const binding of bindings) {
            const { changes: rawTasks, nextCursor } = await clickUpListRawChangesSinceWatermark(cursor, {
              fetchImpl: fetch,
              token,
              listId: binding.listId,
              rateLimiter,
              statusMap: binding.statusMap,
              memberMap: binding.memberMap,
            });
            const maps = mapsOf(binding);
            for (const t of rawTasks) {
              projectByClickUpTaskId.set(t.id, binding.projectId); // tag for adopt-mint resolution
              all.push({ record: clickUpTaskToPmoRecord(t, maps), sourceModMs: Number(t.date_updated) });
            }
            if (nextCursor !== null && (maxNext === null || Number(nextCursor) > Number(maxNext))) {
              maxNext = nextCursor;
            }
          }
          return { changes: all, nextCursor: maxNext };
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

/** Resolve a single org's ClickUp token: Vault-first when EXTERNAL_CONNECT_ENABLED=true, else global fallback. */
async function resolveOrgClickUpToken(
  serviceClient: SupabaseClient,
  orgId: string,
): Promise<string> {
  const connectEnabled = Deno.env.get('EXTERNAL_CONNECT_ENABLED') === 'true';
  const globalToken = Deno.env.get('CLICKUP_API_TOKEN') ?? '';

  if (!connectEnabled) {
    return globalToken;
  }

  // Look up the org's ClickUp binding in external_org_bindings
  const { data: binding, error: bindingError } = await serviceClient
    .from('external_org_bindings')
    .select('secret_ref')
    .eq('org_id', orgId)
    .eq('external_tier', 'clickup')
    .maybeSingle();

  if (bindingError || !binding || !(binding as { secret_ref?: string }).secret_ref) {
    return globalToken;
  }

  const secretRef = (binding as { secret_ref: string }).secret_ref;

  // Build readVaultSecret using service-role RPC
  const readVaultSecret = async (ref: string): Promise<string | null> => {
    const { data, error } = await serviceClient.rpc('read_vault_secret', { p_secret_ref: ref });
    if (error) {
      console.error('read_vault_secret failed', error);
      return null;
    }
    return (data as string | null) ?? null;
  };

  try {
    const { token } = await resolveClickUpCredentialsFromVault(secretRef, readVaultSecret);
    return token;
  } catch (e) {
    // Vault resolution failed (config-rejected or null) — fall back to global token
    console.warn('ClickUp Vault credential resolution failed for org', orgId, 'falling back to global token:', e instanceof Error ? e.message : String(e));
    return globalToken;
  }
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

  // ── 2. Iterate employing orgs via external_org_bindings (ClickUp tier) → sweep each with its token. ──
  const { data: bindings, error: bindingsError } = await serviceClient
    .from('external_org_bindings')
    .select('org_id')
    .eq('external_tier', 'clickup')
    .eq('status', 'active');
  if (bindingsError) return json({ error: bindingsError.code ?? 'BINDINGS_READ_FAILED', message: bindingsError.message }, 500);
  const orgIds = Array.from(new Set(((bindings as Array<{ org_id: string }> | null) ?? []).map((r) => r.org_id)));

  const perOrg = [];
  let totalApplied = 0;
  for (const orgId of orgIds) {
    const token = await resolveOrgClickUpToken(serviceClient, orgId);
    const result = await sweepOrg(serviceClient, orgId, token);
    totalApplied += result.applied;
    perOrg.push({ orgId, ...result });
  }

  return json({ ok: true, orgs: orgIds.length, applied: totalApplied, perOrg });
});