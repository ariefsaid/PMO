/**
 * ClickUp reads (FR-CUA-002..008): `listChangesSinceWatermark` (the reconciliation-sweep source,
 * paginated, inclusive re-fetch boundary) and `getByExternalId` (resolve/reconcile a ref, 404 -> null).
 */
import type { ChangesSinceWatermark, PmoDomain, PmoRecord } from '../contract.ts';
import { clickUpRequest, ClickUpHttpError, type ClickUpClientDeps } from './client.ts';
import { clickUpTaskToPmoRecord, type ClickUpMaps } from './mapping.ts';
import type { ClickUpLanePriority } from './rateLimit.ts';
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

/** Build the `date_updated_gt` + `page` query string for a given cursor (inclusive `>=` boundary). */
function buildListQuery(cursor: string | null, page: number): URLSearchParams {
  const query = new URLSearchParams({ order_by: 'updated', page: String(page) });
  if (cursor !== null) query.set('date_updated_gt', String(Math.max(0, Number(cursor) - 1)));
  return query;
}

/**
 * Page `GET /list/{list_id}/task` until the server signals `last_page` (shared by the mapped read
 * and the raw sweep source — DRY). Returns the raw ClickUp tasks + the max `date_updated` observed
 * as the next cursor (`null` at exhaustion). The cursor is made inclusive (`date_updated_gt` =
 * cursor − 1ms) so a task last seen exactly at the boundary is re-included, not silently skipped.
 */
async function pageListTasks(
  deps: ClickUpClientDeps & { listId: string },
  cursor: string | null,
  priority: ClickUpLanePriority,
): Promise<{ tasks: ClickUpTask[]; nextCursor: string | null }> {
  const allTasks: ClickUpTask[] = [];
  let page = 0;
  for (;;) {
    const query = buildListQuery(cursor, page);
    const raw = (await clickUpRequest(deps, {
      method: 'GET',
      path: `/list/${deps.listId}/task?${query.toString()}`,
      priority,
    })) as ClickUpTaskListResponse;
    const tasks = raw.tasks ?? [];
    allTasks.push(...tasks);
    if (tasks.length === 0 || raw.last_page === true || page >= MAX_PAGES) break;
    page += 1;
  }
  const nextCursor = allTasks.length > 0 ? String(Math.max(...allTasks.map((t) => Number(t.date_updated)))) : null;
  return { tasks: allTasks, nextCursor };
}

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
  const { tasks, nextCursor } = await pageListTasks(deps, cursor, 'bulk');
  const changes: PmoRecord[] = tasks.map((t) => clickUpTaskToPmoRecord(t, maps));
  return { changes, nextCursor };
}

/**
 * The sweep's source read (FR-CUA-049 "any apply" needs the per-row source-mod): returns the RAW
 * ClickUp tasks (with `date_updated` preserved) + the max `date_updated` nextCursor, so the sweep
 * can apply each through the source-mod-guarded path alongside the webhook. Same inclusive-`>=`
 * pagination as the mapped read. Bulk lane (NFR-CUA-PERF-003).
 */
export async function clickUpListRawChangesSinceWatermark(
  cursor: string | null,
  deps: ClickUpReadDeps,
): Promise<{ changes: ClickUpTask[]; nextCursor: string | null }> {
  const { tasks, nextCursor } = await pageListTasks(deps, cursor, 'bulk');
  return { changes: tasks, nextCursor };
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
