/**
 * ClickUp reads (FR-CUA-002..008): `listChangesSinceWatermark` (the reconciliation-sweep source,
 * paginated, inclusive re-fetch boundary) and `getByExternalId` (resolve/reconcile a ref, 404 -> null).
 */
import type { ChangesSinceWatermark, PmoDomain, PmoRecord } from '../contract.ts';
import { clickUpRequest, ClickUpHttpError, type ClickUpClientDeps } from './client.ts';
import { clickUpTaskToPmoRecord, type ClickUpMaps } from './mapping.ts';
import type { ClickUpMemberMap } from './memberMap.ts';
import type { ClickUpStatusMap } from './statusMap.ts';
import type { ClickUpTask, ClickUpTaskListResponse } from './types.ts';

export interface ClickUpReadDeps extends ClickUpClientDeps {
  /** The ClickUp List this project is bound to. */
  listId: string;
  statusMap: ClickUpStatusMap;
  memberMap: ClickUpMemberMap;
}

// Safety valve: bounded pagination loop so a misbehaving/malicious server (never sending
// `last_page: true`) cannot spin this into an infinite loop.
const MAX_PAGES = 1000;

/**
 * `list-changes-since-watermark` (AC-CUA-035): pages `GET /list/{list_id}/task` until the server
 * signals `last_page`, returns canonical records + the max `date_updated` observed as the next
 * cursor (`null` at exhaustion). Subtracts 1ms from the cursor before querying (`date_updated_gt`)
 * so a task last seen exactly at the boundary is re-included, not silently skipped.
 */
export async function clickUpListChangesSinceWatermark(
  _domain: PmoDomain,
  cursor: string | null,
  deps: ClickUpReadDeps,
): Promise<ChangesSinceWatermark> {
  const maps: ClickUpMaps = { statusMap: deps.statusMap, memberMap: deps.memberMap };
  const since = cursor !== null ? Math.max(0, Number(cursor) - 1) : null;

  const allTasks: ClickUpTask[] = [];
  let page = 0;
  for (;;) {
    const query = new URLSearchParams({ order_by: 'updated', page: String(page) });
    if (since !== null) query.set('date_updated_gt', String(since));
    const raw = (await clickUpRequest(deps, {
      method: 'GET',
      path: `/list/${deps.listId}/task?${query.toString()}`,
      priority: 'bulk',
    })) as ClickUpTaskListResponse;
    const tasks = raw.tasks ?? [];
    allTasks.push(...tasks);
    if (tasks.length === 0 || raw.last_page === true || page >= MAX_PAGES) break;
    page += 1;
  }

  const changes: PmoRecord[] = allTasks.map((t) => clickUpTaskToPmoRecord(t, maps));
  const nextCursor = allTasks.length > 0 ? String(Math.max(...allTasks.map((t) => Number(t.date_updated)))) : null;
  return { changes, nextCursor };
}

/** `get-by-external-id` (AC-CUA-036): resolves a ClickUp task by id, or `null` on a 404. */
export async function clickUpGetByExternalId(
  _domain: PmoDomain,
  externalRecordId: string,
  deps: ClickUpReadDeps,
): Promise<PmoRecord | null> {
  const maps: ClickUpMaps = { statusMap: deps.statusMap, memberMap: deps.memberMap };
  try {
    const raw = (await clickUpRequest(deps, {
      method: 'GET',
      path: `/task/${externalRecordId}`,
      priority: 'bulk',
    })) as ClickUpTask;
    return clickUpTaskToPmoRecord(raw, maps);
  } catch (err) {
    if (err instanceof ClickUpHttpError && err.status === 404) return null;
    throw err;
  }
}
