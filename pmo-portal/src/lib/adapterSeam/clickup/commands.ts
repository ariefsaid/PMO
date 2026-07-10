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
}

/** Commit one task command against ClickUp REST v2 (FR-CUA-002..008, AC-CUA-031/032/033). */
export async function commitClickUpTaskCommand(
  command: AdapterCommand,
  deps: ClickUpCommandDeps,
): Promise<CommandResult> {
  const maps: ClickUpMaps = { statusMap: deps.statusMap, memberMap: deps.memberMap };

  if (command.operation === 'create') {
    const body = pmoTaskToClickUpBody(command.record, maps, { mode: 'create' });
    const raw = (await clickUpRequest(deps, {
      method: 'POST',
      path: `/list/${deps.listId}/task`,
      body,
      priority: 'interactive',
    })) as ClickUpTask;
    return toResult(command.record.id, raw, maps);
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
    const body = pmoTaskToClickUpBody(command.record, maps, { mode: 'update', previousAssigneeIds });
    const raw = (await clickUpRequest(deps, {
      method: 'PUT',
      path: `/task/${externalId}`,
      body,
      priority: 'interactive',
    })) as ClickUpTask;
    return toResult(command.record.id, raw, maps, externalId);
  }

  throw new AdapterError('commit-rejected', `unsupported ClickUp operation "${command.operation}"`);
}

function toResult(pmoRecordId: string, raw: ClickUpTask, maps: ClickUpMaps, externalIdOverride?: string): CommandResult {
  const canonical: PmoRecord = { ...clickUpTaskToPmoRecord(raw, maps), id: pmoRecordId };
  return { externalRecordId: externalIdOverride ?? raw.id, canonical };
}
