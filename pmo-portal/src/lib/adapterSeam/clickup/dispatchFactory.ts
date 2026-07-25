/**
 * ClickUp dispatch factory (review fix #9). The generic `adapter-dispatch` edge fn resolves the ClickUp
 * adapter for a `tasks` command OPAQUELY through this factory — all ClickUp-specific config/member
 * resolution (the per-project `external_project_bindings` lookup + the external_refs/assignee resolvers)
 * lives here in the pure `clickup/**` lib, not inline in the generic dispatcher. The dispatcher passes
 * the caller's org + the parsed command + an injected service-client seam + ClickUp client deps; it
 * never sees ClickUp vocabulary (confinement, FR-CUA-012).
 *
 * Pure + portable (Vitest + Deno): the service client is a STRUCTURAL seam (the real supabase-js client
 * satisfies it at runtime; the `as never` cast at the call site bridges the nominal mismatch). env reads
 * (`CLICKUP_API_TOKEN`) + `fetch` stay at the edge-fn boundary — passed in, never read here.
 */
import { createClickUpAdapter, CLICKUP_TIER, CLICKUP_TASKS_DOMAIN } from './adapter.ts';
import { mapsFromBindingConfig } from './bindingConfig.ts';
import type { Adapter, AdapterCommand } from '../contract.ts';
import type { ClickUpRateLimiter } from './rateLimit.ts';
import { AppError } from '../../appError.ts';

/** Structural service-role client seam for the binding/refs/assignee lookups (matches supabase-js):
 *  `.from(t).select(c).eq(...).eq(...).maybeSingle()|single()` — the filter builder is chainable. */
export interface DispatchServiceClient {
  from(table: string): {
    select(columns: string): DispatchFilterBuilder;
  };
}

export interface DispatchFilterBuilder {
  eq(column: string, value: string): DispatchFilterBuilder;
  maybeSingle(): Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
  single(): Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
}

export interface ClickUpDispatchFactoryDeps {
  serviceClient: DispatchServiceClient;
  orgId: string;
  command: AdapterCommand;
  fetchImpl: typeof fetch;
  token: string;
  baseUrl?: string;
  rateLimiter: ClickUpRateLimiter;
}

/**
 * Resolve the ClickUp adapter for a task command (AC-CUA-030 dispatch-side select): load the project's
 * binding (List id + maps), then build the adapter with the external_refs/assignee resolvers scoped to
 * the caller's org. Throws `AppError('BAD_REQUEST')` when the command carries no project_id, and
 * `AppError('BINDING_NOT_FOUND')` when no binding is configured for the project.
 */
export async function resolveClickUpDispatchAdapter(deps: ClickUpDispatchFactoryDeps): Promise<Adapter> {
  const projectId = (deps.command.record as { project_id?: string }).project_id;
  if (!projectId) {
    throw new AppError('project_id is required to resolve the ClickUp binding for a task command', 'BAD_REQUEST');
  }

  const { data: binding, error: bindingError } = await deps.serviceClient
    .from('external_project_bindings')
    .select('external_container_id, config')
    .eq('org_id', deps.orgId)
    .eq('project_id', projectId)
    .eq('external_tier', CLICKUP_TIER)
    .maybeSingle();
  if (bindingError || !binding) {
    throw new AppError('no external binding configured for this project', bindingError?.code ?? 'BINDING_NOT_FOUND');
  }

  const { statusMap, memberMap } = mapsFromBindingConfig((binding as { config: unknown }).config);

  return createClickUpAdapter({
    fetchImpl: deps.fetchImpl,
    token: deps.token,
    baseUrl: deps.baseUrl,
    listId: (binding as { external_container_id: string }).external_container_id,
    statusMap,
    memberMap,
    rateLimiter: deps.rateLimiter,
    resolveExternalId: async (pmoRecordId: string) => {
      const { data, error } = await deps.serviceClient
        .from('external_refs')
        .select('external_record_id')
        .eq('org_id', deps.orgId)
        .eq('domain', CLICKUP_TASKS_DOMAIN)
        .eq('pmo_record_id', pmoRecordId)
        .single();
      if (error || !data) throw new AppError('no ClickUp mapping recorded for this task', error?.code ?? 'REF_NOT_FOUND');
      return (data as { external_record_id: string }).external_record_id;
    },
    resolvePreviousAssigneeIds: async (pmoRecordId: string) => {
      const { data } = await deps.serviceClient
        .from('tasks')
        .select('assignee_id')
        .eq('org_id', deps.orgId)
        .eq('id', pmoRecordId)
        .maybeSingle();
      const pmoAssigneeId = (data as { assignee_id: string | null } | null)?.assignee_id;
      if (!pmoAssigneeId) return [];
      const clickUpId = memberMap.pmoToClickUp[pmoAssigneeId];
      return clickUpId !== undefined ? [clickUpId] : [];
    },
    resolveParentExternalId: async (pmoParentTaskId: string) => {
      const { data, error } = await deps.serviceClient
        .from('external_refs')
        .select('external_record_id')
        .eq('org_id', deps.orgId)
        .eq('domain', CLICKUP_TASKS_DOMAIN)
        .eq('pmo_record_id', pmoParentTaskId)
        .maybeSingle();
      if (error || !data) {
        console.warn(`[clickup-dispatch] parent task ${pmoParentTaskId} not yet mirrored to ClickUp (no external_refs row); child will be created flat`);
        return null;
      }
      return (data as { external_record_id: string }).external_record_id;
    },
  });
}
