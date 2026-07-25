/**
 * clickup-onboard — Deno Edge Function entry point (Slice E, FR-CUA-063, AC-CUA-050..053).
 *
 * Thin wiring ONLY — the onboarding orchestration lives in the pure
 * `provisionBinding`/`pushSeed`/`pullAdopt` (pmo-portal/src/lib/adapterSeam/clickup/onboarding.ts),
 * unit-tested under onboarding.test.ts. This file is INTEGRATION-ONLY (not unit-tested) — verified by
 * `deno check` + the boot-smoke (the same contract as agent-dispatch/compose-view, ADR-0039/0044).
 *
 * Operator/service-role-guarded: `verify_jwt = false` (supabase/config.toml) and the handler verifies
 * the bearer itself (it MUST equal SUPABASE_SERVICE_ROLE_KEY, constant-time — the sole auth gate, same
 * stance as agent-dispatch/telegram-notify). Onboarding is an operator action, not a browser-JWT path,
 * so the service bearer is the trust boundary. (A dedicated CLICKUP_ONBOARD_SECRET can be added later
 * for least-privilege, mirroring AGENT_DISPATCH_SECRET — not required for P1 mocked-only.)
 *
 * Three operations (PMO domain language on the wire; ClickUp vocab confined to clickup/**):
 *   - provision : bind/create one ClickUp List, capture maps, persist the binding, pick the direction
 *                  (rejects the mixed case at provisioning — OD-CUA-3).
 *   - push-seed  : seed the project's PMO tasks into the (empty) bound List.
 *   - pull-adopt : mirror the bound List's ClickUp tasks into the read-model.
 *
 * captureMaps (the one piece of ClickUp I/O that lives here rather than in a pure module): fetches the
 * List's statuses + members and builds BOTH maps through the SHARED builders
 * (`statusMapBuilder.ts`/`memberMap.ts`) — the same ones `external-link` uses (OD-INT-10), so the two
 * link paths cannot drift apart again. Rejects (commit-rejected, 422) a List whose statuses cannot
 * cover all four PMO task_status values, rather than persisting a binding that fails on first write.
 * The exact ClickUp status/member wire shapes are PROVISIONAL here and re-verified in the deferred
 * live-smoke appendix (mocked-only in P1, same stance as mapping.ts).
 */

// Deno-native imports (not in pmo-portal/package.json)
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { constantTimeBearerEquals } from '../_shared/constantTimeBearerEquals.ts';
import {
  provisionBinding,
  pushSeed,
  pullAdopt,
  MIXED_ONBOARDING_MESSAGE,
  type ProvisioningTarget,
} from '../../../pmo-portal/src/lib/adapterSeam/clickup/onboarding.ts';
import { clickUpRequest } from '../../../pmo-portal/src/lib/adapterSeam/clickup/client.ts';
import { ClickUpRateLimiter } from '../../../pmo-portal/src/lib/adapterSeam/clickup/rateLimit.ts';
import type { ClickUpStatusMap } from '../../../pmo-portal/src/lib/adapterSeam/clickup/statusMap.ts';
import {
  buildClickUpMemberMap,
  type ClickUpMemberMap,
} from '../../../pmo-portal/src/lib/adapterSeam/clickup/memberMap.ts';
import {
  buildClickUpStatusMap,
  statusMapCoversAllPmoStatuses,
  type ClickUpListStatus,
} from '../../../pmo-portal/src/lib/adapterSeam/clickup/statusMapBuilder.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import {
  CLICKUP_TIER,
  CLICKUP_TASKS_DOMAIN,
  mapsFromBindingConfig,
  createClickUpMirrorCallbacks,
} from '../_shared/clickupMirrorDeps.ts';

// Shared across invocations of this isolate — the token bucket's budget is real only if it persists
// across requests (NFR-CUA-PERF-003). Bulk lane: onboarding yields to interactive writes.
const rateLimiter = new ClickUpRateLimiter();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A resolved per-project binding (the external_project_bindings row). */
interface ResolvedBinding {
  listId: string;
  statusMap: ClickUpStatusMap;
  memberMap: ClickUpMemberMap;
}

/** Load the bound List + maps for a project (push-seed/pull-adopt run after provision). */

/**
 * captureMaps (FR-CUA-011/013, OD-INT-10): fetch the List's available statuses + members and build
 * BOTH maps through the shared builders (`statusMapBuilder.ts`/`memberMap.ts`) — the same ones
 * `external-link` uses, so the two link paths cannot drift apart again. Rejects (AppError
 * `commit-rejected`, mapped to 422 below) when the List's statuses cannot cover all four PMO
 * statuses, rather than persisting a binding that will fail on its first outbound write.
 */
async function captureMaps(
  clientDeps: { fetchImpl: typeof fetch; token: string; baseUrl?: string },
  listId: string,
  serviceClient: SupabaseClient,
  orgId: string,
): Promise<{ statusMap: ClickUpStatusMap; memberMap: ClickUpMemberMap }> {
  const raw = (await clickUpRequest(clientDeps, {
    method: 'GET',
    path: `/list/${listId}`,
    priority: 'bulk',
  })) as { statuses?: ClickUpListStatus[] };
  const statusMap = buildClickUpStatusMap(raw.statuses ?? []);
  if (!statusMapCoversAllPmoStatuses(statusMap)) {
    throw new AppError(
      'ClickUp List cannot represent every PMO task status (To Do, In Progress, Done, Blocked) — ' +
        'add a status of each needed type in ClickUp before onboarding this List',
      'commit-rejected',
    );
  }

  // Best-effort member map (FR-CUA-013, OD-INT-10 §4): join PMO profiles to ClickUp List members by
  // email. Never blocks onboarding — a fetch failure or a List with no members yet simply degrades
  // to an empty map (an unmapped assignee is the routine, non-fatal case).
  let memberMap: ClickUpMemberMap = { pmoToClickUp: {}, clickUpToPmo: {} };
  try {
    const rawMembers = (await clickUpRequest(clientDeps, {
      method: 'GET',
      path: `/list/${listId}/member`,
      priority: 'bulk',
    })) as { members?: Array<{ id: number; email?: string }> };
    const clickUpMembers = (rawMembers.members ?? []).filter(
      (m): m is { id: number; email: string } => typeof m.email === 'string' && m.email.length > 0,
    );
    if (clickUpMembers.length > 0) {
      const { data: profiles, error } = await serviceClient.from('profiles').select('id, email').eq('org_id', orgId);
      if (!error && profiles) {
        memberMap = buildClickUpMemberMap(profiles as Array<{ id: string; email: string }>, clickUpMembers);
      } else {
        console.error('member-map profiles lookup failed (non-fatal, onboarding continues)', error);
      }
    }
  } catch (err) {
    console.error('ClickUp member map build failed (non-fatal, onboarding continues)', err);
  }

  return { statusMap, memberMap };
}

Deno.serve(async (req: Request): Promise<Response> => {
  // ── 1. Authorization: the caller (an Operator action) must present the service-role bearer. ──
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!serviceRoleKey || !(await constantTimeBearerEquals(authHeader, `Bearer ${serviceRoleKey}`))) {
    return json({ error: 'UNAUTHORIZED' }, 401);
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  if (!supabaseUrl) return json({ error: 'MISCONFIGURED', message: 'missing SUPABASE_URL' }, 500);

  // ── 2. Parse the request body. ──
  let body: { operation?: string; orgId?: string; projectId?: string; target?: ProvisioningTarget; projectName?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'BAD_REQUEST', message: 'invalid JSON body' }, 400);
  }
  const { operation, orgId, projectId } = body;
  if (!operation || !orgId || !projectId) {
    return json({ error: 'BAD_REQUEST', message: 'operation, orgId, and projectId are required' }, 400);
  }

  const token = Deno.env.get('CLICKUP_API_TOKEN') ?? '';
  const clientDeps = { fetchImpl: fetch, token, rateLimiter };
  // Cast: see adapter-dispatch/index.ts — the real supabase-js client structurally satisfies the
  // pure modules' service-client seams at runtime but is not nominally assignable (thenable
  // PostgrestFilterBuilder vs a plain Promise).
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  // Load the bound List + maps for a project (push-seed/pull-adopt run after provision). A closure
  // capturing serviceClient so the overloaded `createClient` generic is inferred exactly once.
  const resolveBinding = async (): Promise<ResolvedBinding> => {
    const { data, error } = await serviceClient
      .from('external_project_bindings')
      .select('external_container_id, config')
      .eq('org_id', orgId)
      .eq('project_id', projectId)
      .eq('external_tier', CLICKUP_TIER)
      .maybeSingle();
    if (error || !data) {
      throw new AppError('no external binding configured for this project — provision first', error?.code ?? 'BINDING_NOT_FOUND');
    }
    const { statusMap, memberMap } = mapsFromBindingConfig((data as { config: unknown }).config);
    return {
      listId: (data as { external_container_id: string }).external_container_id,
      statusMap,
      memberMap,
    };
  };

  try {
    // ── provision ──
    if (operation === 'provision') {
      if (!body.target) return json({ error: 'BAD_REQUEST', message: 'target is required for provision' }, 400);
      const result = await provisionBinding(projectId, {
        ...clientDeps,
        target: body.target,
        captureMaps: (listId: string) => captureMaps(clientDeps, listId, serviceClient, orgId),
        countPmoTasks: async (pid: string) => {
          const { count } = await serviceClient
            .from('tasks')
            .select('id', { count: 'exact', head: true })
            .eq('org_id', orgId)
            .eq('project_id', pid)
            .is('tombstoned_at', null);
          return count ?? 0;
        },
        countListTasks: async (listId: string) => {
          const raw = (await clickUpRequest(clientDeps, {
            method: 'GET',
            path: `/list/${listId}/task?page=0`,
            priority: 'bulk',
          })) as { tasks?: unknown[] };
          return raw.tasks?.length ?? 0;
        },
        upsertBinding: async (binding) => {
          const { error } = await serviceClient.from('external_project_bindings').upsert(
            {
              org_id: orgId,
              project_id: binding.projectId,
              external_tier: CLICKUP_TIER,
              external_container_id: binding.listId,
              config: { statusMap: binding.statusMap, memberMap: binding.memberMap },
            },
            { onConflict: 'org_id,project_id,external_tier' },
          );
          if (error) throw new AppError(error.message, error.code);
        },
      });
      return json({ ok: true, direction: result.direction, binding: result.binding });
    }

    // push-seed + pull-adopt both need the resolved binding.
    const binding = await resolveBinding();
    // Shared mirror-callback bag (review fix #3): push-seed + pull-adopt both reuse its recordExternalRef
    // (and pull-adopt reuses readWatermark/advanceWatermark/resolvePmoRecordId too). No projectId —
    // pull-adopt overrides mintMirror/updateMirror (no per-row source-mod); push-seed doesn't mint.
    const mirrorCallbacks = createClickUpMirrorCallbacks({ serviceClient, orgId });

    // ── push-seed ──
    if (operation === 'push-seed') {
      const result = await pushSeed(projectId, {
        ...clientDeps,
        listId: binding.listId,
        statusMap: binding.statusMap,
        memberMap: binding.memberMap,
        listPmoTasks: async (pid: string) => {
          const { data, error } = await serviceClient
            .from('tasks')
            .select('id, name, status, assignee_id, start_date, end_date')
            .eq('org_id', orgId)
            .eq('project_id', pid)
            .is('tombstoned_at', null);
          if (error) throw new AppError(error.message, error.code);
          return (data ?? []) as Array<{ id: string; name: string; status: string; assignee_id: string | null; start_date: string | null; end_date: string | null }>;
        },
        resolveExternalId: async (pmoRecordId: string) => {
          const { data } = await serviceClient
            .from('external_refs')
            .select('external_record_id')
            .eq('org_id', orgId)
            .eq('domain', CLICKUP_TASKS_DOMAIN)
            .eq('pmo_record_id', pmoRecordId)
            .maybeSingle();
          return (data as { external_record_id: string } | null)?.external_record_id ?? null;
        },
        recordExternalRef: mirrorCallbacks.recordExternalRef,
      });
      return json({ ok: true, ...result });
    }

    // ── pull-adopt ──
    if (operation === 'pull-adopt') {
      // readWatermark / advanceWatermark / resolvePmoRecordId / recordExternalRef come from the shared
      // bag above. mintMirror + updateMirror are OVERRIDDEN because the pull-adopt contract carries NO
      // per-row source-mod (it stamps source_updated_at = now()).
      const result = await pullAdopt(projectId, {
        ...clientDeps,
        listId: binding.listId,
        statusMap: binding.statusMap,
        memberMap: binding.memberMap,
        ...mirrorCallbacks,
        mintMirror: async (canonical) => {
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
            source_updated_at: new Date().toISOString(),
          });
          if (error) throw new AppError(error.message, error.code);
          return pmoRecordId;
        },
        updateMirror: async (pmoRecordId, canonical) => {
          const { error } = await serviceClient
            .from('tasks')
            .update({
              name: canonical.name,
              status: canonical.status,
              assignee_id: canonical.assignee_id ?? null,
              start_date: canonical.start_date ?? null,
              end_date: canonical.end_date ?? null,
              completed_at: (canonical.completed_at as string | null | undefined) ?? null,
              source_updated_at: new Date().toISOString(),
            })
            .eq('org_id', orgId)
            .eq('id', pmoRecordId);
          if (error) throw new AppError(error.message, error.code);
        },
      });
      return json({ ok: true, ...result });
    }

    return json({ error: 'BAD_REQUEST', message: `unknown operation "${operation}"` }, 400);
  } catch (err) {
    // The mixed-onboarding rejection (OD-CUA-3) is an operator-facing 422, not a server fault.
    if (err instanceof Error && err.message === MIXED_ONBOARDING_MESSAGE) {
      return json({ error: 'MIXED_ONBOARDING', message: err.message }, 422);
    }
    const appError = err instanceof AppError ? err : new AppError(err instanceof Error ? err.message : 'onboarding failed');
    const status = appError.code === 'external-unreachable' ? 502 : appError.code === 'commit-rejected' ? 422 : 500;
    return json({ error: appError.code ?? 'ONBOARDING_FAILED', message: appError.message }, status);
  }
});
