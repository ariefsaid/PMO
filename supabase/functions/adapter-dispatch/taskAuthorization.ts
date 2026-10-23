import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';

export interface TaskAuthorizationClient {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
  from(table: string): { select(columns: string): TaskQuery };
}

interface TaskQuery {
  eq(column: string, value: string): TaskQuery;
  is(column: string, value: null): TaskQuery;
  maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }>;
}

export type TaskAuthorizationResult = { ok: true } | { ok: false; message: string };

/** Authorize task dispatch using stored task/project state and the PMO task policy. */
export async function authorizeClickUpTaskCommand(
  client: TaskAuthorizationClient,
  orgId: string,
  userId: string,
  command: AdapterCommand,
): Promise<TaskAuthorizationResult> {
  const requestedProjectId = (command.record as { project_id?: unknown }).project_id;

  const { data: actor, error: actorError } = await client.rpc('actor_authorization_state', {
    p_org_id: orgId,
    p_user_id: userId,
  });
  if (actorError || !actor) return { ok: false, message: 'caller is not an active member' };
  const { role, active } = actor as { role?: string | null; active?: boolean };
  if (!active || !role) return { ok: false, message: 'caller is not an active member' };

  const operation = String(command.operation);
  const deliveryRole = role === 'Admin' || role === 'Executive' || role === 'Project Manager';
  let projectId: string;
  if (operation === 'create') {
    if (typeof requestedProjectId !== 'string' || !requestedProjectId) {
      return { ok: false, message: 'task project is required' };
    }
    if (!deliveryRole && role !== 'Engineer' && role !== 'Finance') return { ok: false, message: 'caller cannot create a task' };
    projectId = requestedProjectId;
    const { data: project, error: projectError } = await client.from('projects').select('id')
      .eq('org_id', orgId).eq('id', requestedProjectId).maybeSingle();
    if (projectError || !project) return { ok: false, message: 'task project not found' };
  } else {
    const { data: task, error: taskError } = await client.from('tasks').select('id, org_id, project_id, created_by, assignee_id')
      .eq('org_id', orgId).eq('id', String(command.record.id)).maybeSingle();
    if (taskError || !task) return { ok: false, message: 'task not found' };
    const stored = task as { org_id: string; project_id: string; created_by: string | null; assignee_id: string | null };
    if (requestedProjectId !== undefined &&
        (typeof requestedProjectId !== 'string' || stored.project_id !== requestedProjectId)) {
      return { ok: false, message: 'task project does not match' };
    }
    projectId = stored.project_id;
    const { data: externallyOwned, error: ownershipError } = await client.rpc('task_domain_externally_owned', {
      p_project_id: stored.project_id,
    });
    if (ownershipError) return { ok: false, message: 'task ownership could not be verified' };
    const allowed = operation === 'delete'
      ? deliveryRole
      : operation === 'update'
        ? deliveryRole || (stored.created_by === userId && externallyOwned !== true)
        : operation === 'transition'
          ? deliveryRole || ((role === 'Engineer' || role === 'Finance') && stored.assignee_id === userId)
          : false;
    if (!allowed) return { ok: false, message: 'caller cannot perform this task operation' };
  }

  const { data: binding, error: bindingError } = await client.from('external_project_bindings')
    .select('id').eq('org_id', orgId).eq('project_id', projectId).eq('external_tier', 'clickup')
    .is('disconnected_at', null).maybeSingle();
  if (bindingError || !binding) return { ok: false, message: 'no active task binding' };
  return { ok: true };
}
