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

/** `status` is set when the refusal is a business rule (422) rather than an authorization failure (403). */
export type TaskAuthorizationResult = { ok: true } | { ok: false; message: string; status?: number };

const refusePlacement = (message: string): TaskAuthorizationResult => ({ ok: false, message, status: 422 });

/** Placement checks that must hold BEFORE ClickUp is changed: a parent or milestone that is not in the
 *  task's project would fail at the database only after ClickUp already moved the task, and clearing the
 *  parent of a subtask is something ClickUp's API cannot do. `storedParentId` is the task's current
 *  parent on an update. */
async function checkTaskPlacement(
  client: TaskAuthorizationClient,
  orgId: string,
  projectId: string,
  command: AdapterCommand,
  storedParentId: string | null,
): Promise<TaskAuthorizationResult> {
  const record = command.record as Record<string, unknown>;
  for (const [column, table] of [['parent_task_id', 'tasks'], ['milestone_id', 'project_milestones']] as const) {
    if (!(column in record)) continue;
    const id = record[column];
    if (id === null || id === '') {
      if (column === 'parent_task_id' && storedParentId) {
        return refusePlacement('ClickUp cannot move a subtask back to the top level. Change it in ClickUp.');
      }
      continue;
    }
    if (typeof id !== 'string') return refusePlacement(`task ${column} is invalid`);
    if (column === 'parent_task_id' && id === record.id) return refusePlacement('a task cannot be its own parent');
    const { data, error } = await client.from(table).select('id, project_id')
      .eq('org_id', orgId).eq('id', id).maybeSingle();
    if (error || !data || (data as { project_id?: string }).project_id !== projectId) {
      return refusePlacement(`the chosen ${column === 'parent_task_id' ? 'parent task' : 'phase'} is not in this project`);
    }
  }
  return { ok: true };
}

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
  let storedParentId: string | null = null;
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
    const { data: task, error: taskError } = await client.from('tasks').select('id, org_id, project_id, created_by, assignee_id, parent_task_id')
      .eq('org_id', orgId).eq('id', String(command.record.id)).maybeSingle();
    if (taskError || !task) return { ok: false, message: 'task not found' };
    const stored = task as { org_id: string; project_id: string; created_by: string | null; assignee_id: string | null; parent_task_id?: string | null };
    if (requestedProjectId !== undefined &&
        (typeof requestedProjectId !== 'string' || stored.project_id !== requestedProjectId)) {
      return { ok: false, message: 'task project does not match' };
    }
    projectId = stored.project_id;
    storedParentId = stored.parent_task_id ?? null;
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
  // Placement belongs to create/update only; a transition never carries it (the writer ignores it too).
  if (operation === 'create' || operation === 'update') return checkTaskPlacement(client, orgId, projectId, command, storedParentId);
  return { ok: true };
}
