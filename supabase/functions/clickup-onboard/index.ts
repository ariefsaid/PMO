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
 * captureMaps (the one piece of ClickUp logic that lives here rather than in the pure module): fetches
 * the List's available statuses and builds a statusMap by convention. The exact ClickUp status/member
 * wire shapes are PROVISIONAL here and re-verified in the deferred live-smoke appendix (mocked-only in
 * P1, same stance as mapping.ts); member-map capture is operator-configured (left empty by auto-capture).
 */

// Deno-native imports (not in pmo-portal/package.json)
import { createClient } from '@supabase/supabase-js';
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
import type { ClickUpMemberMap } from '../../../pmo-portal/src/lib/adapterSeam/clickup/memberMap.ts';
import { recordExternalRef as recordExternalRefWrite } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';

const CLICKUP_TIER = 'clickup';
const TASKS_DOMAIN = 'tasks';

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
 * captureMaps (FR-CUA-011/013): fetch the List's available statuses and build a statusMap by
 * convention (a `closed` status → PMO 'Done'; any other → 'To Do'). memberMap is operator-configured
 * (auto-capture leaves it empty) — pending the live-smoke appendix. PROVISIONAL wire shape.
 */
async function captureMaps(
  clientDeps: { fetchImpl: typeof fetch; token: string; baseUrl?: string },
  listId: string,
): Promise<{ statusMap: ClickUpStatusMap; memberMap: ClickUpMemberMap }> {
  const raw = (await clickUpRequest(clientDeps, {
    method: 'GET',
    path: `/list/${listId}`,
    priority: 'bulk',
  })) as { statuses?: Array<{ status: string; type?: string }> };
  const statuses = raw.statuses ?? [];
  const clickUpToPmo: Record<string, string> = {};
  let toDoStatus: string | undefined;
  let doneStatus: string | undefined;
  for (const s of statuses) {
    const isClosed = s.type === 'closed';
    clickUpToPmo[s.status] = isClosed ? 'Done' : 'To Do';
    if (isClosed && !doneStatus) doneStatus = s.status;
    if (!isClosed && !toDoStatus) toDoStatus = s.status;
  }
  const statusMap: ClickUpStatusMap = {
    pmoToClickUp: {
      ...(toDoStatus ? { 'To Do': toDoStatus } : {}),
      ...(doneStatus ? { Done: doneStatus } : {}),
    },
    clickUpToPmo,
    defaultPmoStatus: 'To Do',
  };
  // Member mapping is operator-configured (a PMO-profile ↔ ClickUp-member join by email is a real
  // integration step, out of scope for P1 mocked-only); auto-capture leaves it empty.
  const memberMap: ClickUpMemberMap = { pmoToClickUp: {}, clickUpToPmo: {} };
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
    const config = ((data as { config: unknown }).config ?? {}) as { statusMap?: ClickUpStatusMap; memberMap?: ClickUpMemberMap };
    return {
      listId: (data as { external_container_id: string }).external_container_id,
      statusMap: config.statusMap ?? { pmoToClickUp: {}, clickUpToPmo: {}, defaultPmoStatus: 'To Do' },
      memberMap: config.memberMap ?? { pmoToClickUp: {}, clickUpToPmo: {} },
    };
  };

  try {
    // ── provision ──
    if (operation === 'provision') {
      if (!body.target) return json({ error: 'BAD_REQUEST', message: 'target is required for provision' }, 400);
      const result = await provisionBinding(projectId, {
        ...clientDeps,
        target: body.target,
        captureMaps: (listId: string) => captureMaps(clientDeps, listId),
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
            .eq('domain', TASKS_DOMAIN)
            .eq('pmo_record_id', pmoRecordId)
            .maybeSingle();
          return (data as { external_record_id: string } | null)?.external_record_id ?? null;
        },
        recordExternalRef: (mapping) =>
          recordExternalRefWrite(serviceClient as never, { ...mapping, orgId }),
      });
      return json({ ok: true, ...result });
    }

    // ── pull-adopt ──
    if (operation === 'pull-adopt') {
      const result = await pullAdopt(projectId, {
        ...clientDeps,
        listId: binding.listId,
        statusMap: binding.statusMap,
        memberMap: binding.memberMap,
        readWatermark: async () => {
          const { data } = await serviceClient
            .from('external_sync_watermarks')
            .select('watermark_cursor')
            .eq('org_id', orgId)
            .eq('external_tier', CLICKUP_TIER)
            .eq('domain', TASKS_DOMAIN)
            .maybeSingle();
          return (data as { watermark_cursor: string | null } | null)?.watermark_cursor ?? null;
        },
        advanceWatermark: async (cursor: string) => {
          const { error } = await serviceClient.from('external_sync_watermarks').upsert(
            { org_id: orgId, external_tier: CLICKUP_TIER, domain: TASKS_DOMAIN, watermark_cursor: cursor },
            { onConflict: 'org_id,external_tier,domain' },
          );
          if (error) throw new AppError(error.message, error.code);
        },
        resolvePmoRecordId: async (externalRecordId: string) => {
          const { data } = await serviceClient
            .from('external_refs')
            .select('pmo_record_id')
            .eq('org_id', orgId)
            .eq('domain', TASKS_DOMAIN)
            .eq('external_record_id', externalRecordId)
            .maybeSingle();
          return (data as { pmo_record_id: string } | null)?.pmo_record_id ?? null;
        },
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
        recordExternalRef: (mapping) =>
          recordExternalRefWrite(serviceClient as never, { ...mapping, orgId }),
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
