/**
 * ClickUp write commands (FR-CUA-002..008): create/update/transition/delete a task via REST v2,
 * resolving the ClickUp task id from an injected `resolveExternalId` (the `external_refs` mapping —
 * commands.ts never touches Supabase directly, keeping it pure + Deno-importable).
 */
import type { AdapterCommand, CommandResult, PmoRecord } from '../contract.ts';
import { AdapterError } from '../contract.ts';
import { clickUpRequest, type ClickUpClientDeps } from './client.ts';
import { clickUpTaskToPmoRecord, pmoTaskToClickUpBody, type ClickUpMaps } from './mapping.ts';
import type { ClickUpMemberMap } from './memberMap.ts';
import type { ClickUpStatusMap } from './statusMap.ts';
import type { ClickUpTask } from './types.ts';

export interface ClickUpCommandDeps extends ClickUpClientDeps {
  /** The ClickUp List this project is bound to (`external_project_bindings.external_container_id`). */
  listId: string;
  statusMap: ClickUpStatusMap;
  memberMap: ClickUpMemberMap;
  /** Resolve a PMO record id to its mapped ClickUp task id (the `external_refs` lookup, injected). */
  resolveExternalId: (pmoRecordId: string) => Promise<string>;
  /** Resolve the ClickUp member ids currently assigned, for the update-mode add/rem delta. Optional
   * — omitted (or unresolvable) degrades to "no prior assignee known" rather than failing the write. */
  resolvePreviousAssigneeIds?: (pmoRecordId: string) => Promise<number[]>;
  /** Resolve a PMO parent_task_id to its mapped ClickUp task id (the `external_refs` lookup, injected).
   * `null` = the parent has no ClickUp mapping; a command that names such a parent is REFUSED (it must
   * never reach ClickUp as a task with no parent while PMO records the nesting). */
  resolveParentExternalId?: (pmoParentTaskId: string) => Promise<string | null>;
}

/** The ClickUp id of the parent a command names, or a clear refusal when it has no ClickUp mapping. */
async function mappedParentClickUpId(deps: ClickUpCommandDeps, pmoParentTaskId: string): Promise<string> {
  const id = deps.resolveParentExternalId ? await deps.resolveParentExternalId(pmoParentTaskId) : null;
  if (!id) throw new AdapterError('commit-rejected', 'The chosen parent task is not linked to ClickUp yet, so it cannot be used as a parent.');
  return id;
}

/** Commit one task command against ClickUp REST v2 (FR-CUA-002..008, AC-CUA-031/032/033). */
export async function commitClickUpTaskCommand(
  command: AdapterCommand,
  deps: ClickUpCommandDeps,
): Promise<CommandResult> {
  const maps: ClickUpMaps = { statusMap: deps.statusMap, memberMap: deps.memberMap };

  if (command.operation === 'create') {
    const record = command.record as PmoRecord & { parent_task_id?: string | null };
    const parentClickUpId = record.parent_task_id ? await mappedParentClickUpId(deps, record.parent_task_id) : undefined;
    const body = pmoTaskToClickUpBody(record, maps, { mode: 'create', parentClickUpId });
    const raw = (await clickUpRequest(deps, {
      method: 'POST',
      path: `/list/${deps.listId}/task`,
      body,
      priority: 'interactive',
    })) as ClickUpTask;
    return toResult(command.record.id, raw, maps, undefined, parentClickUpId ? { pmoId: record.parent_task_id!, clickUpId: parentClickUpId } : undefined);
  }

  if (command.operation === 'delete') {
    const externalId = await deps.resolveExternalId(command.record.id);
    await clickUpRequest(deps, { method: 'DELETE', path: `/task/${externalId}`, priority: 'interactive' });
    return { externalRecordId: externalId, canonical: { id: command.record.id } };
  }

  if (command.operation === 'update' || command.operation === 'transition') {
    const externalId = await deps.resolveExternalId(command.record.id);
    const previousAssigneeIds = deps.resolvePreviousAssigneeIds
      ? await deps.resolvePreviousAssigneeIds(command.record.id)
      : [];
    const record = command.record as PmoRecord & { parent_task_id?: string | null };
    // Placement is an `update` concern only: a status transition never carries it to ClickUp.
    // A null parent is NOT sent: ClickUp's Update Task cannot convert a subtask to a task ("You cannot
    // convert a subtask to a task by setting parent to null"), so the dispatch refuses a clear before it
    // gets here and a null reaching this point (no parent to clear) changes nothing.
    const parent =
      command.operation === 'update' && record.parent_task_id
        ? { pmoId: record.parent_task_id, clickUpId: await mappedParentClickUpId(deps, record.parent_task_id) }
        : undefined;
    const body = pmoTaskToClickUpBody(record, maps, { mode: 'update', previousAssigneeIds, parentClickUpId: parent?.clickUpId });
    const raw = (await clickUpRequest(deps, {
      method: 'PUT',
      path: `/task/${externalId}`,
      body,
      priority: 'interactive',
    })) as ClickUpTask;
    return toResult(command.record.id, raw, maps, externalId, parent);
  }

  throw new AdapterError('commit-rejected', `unsupported ClickUp operation "${command.operation}"`);
}

/** The canonical result. `parent_task_id` is stamped ONLY when ClickUp's own response confirms the parent
 *  the command asked for (`raw.parent`): the mirror records what ClickUp accepted, never the request. */
function toResult(
  pmoRecordId: string,
  raw: ClickUpTask,
  maps: ClickUpMaps,
  externalIdOverride?: string,
  requestedParent?: { pmoId: string; clickUpId: string },
): CommandResult {
  const canonical: PmoRecord = {
    ...clickUpTaskToPmoRecord(raw, maps),
    id: pmoRecordId,
    ...(requestedParent && raw.parent === requestedParent.clickUpId ? { parent_task_id: requestedParent.pmoId } : {}),
  };
  return { externalRecordId: externalIdOverride ?? raw.id, canonical };
}
