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

/**
 * Build the `date_updated_gt` + `page` query string for a given cursor (inclusive `>=` boundary).
 *
 * `GET /list/{id}/task` EXCLUDES four categories by default (ClickUp REST v2) — each flag below closes
 * one hole in the read-hygiene sweep:
 *   - `include_closed=true`: without it, closed-status tasks never reach the change-feed (found by the
 *     live smoke, 2026-07-11 — a completion made in ClickUp would never mirror into PMO).
 *   - `subtasks=true`: without it, ClickUp subtasks NEVER reach PMO at all. With it, the feed now
 *     carries tasks whose `parent` field PMO does not map — they flow through `mapping.ts` as flat
 *     top-level tasks (no parent/child link). The subtask DATA MODEL is a separate, later issue —
 *     this fix only stops silently dropping the tasks.
 *   - `archived=true`: without it, an archived ClickUp task vanishes from the feed while its PMO mirror
 *     (if one was already minted) lives on forever, never converging. With it, the feed now carries
 *     archived tasks — `pageListTasks` below filters them back OUT of every returned change set, since
 *     there is no `archived_at` column on this branch to record the state faithfully (one exists on
 *     `origin/feat/task-model-fields`, migration 0123, deliberately not pulled in here). This is an
 *     interim "never mirror archived as live" stance, not a full archived-tasks model.
 *   - `include_timl=true` ("tasks in multiple lists"): without it, a task that also lives in another
 *     ClickUp List is seen or missed depending on which List happens to be polled. With it, the raw
 *     reader deliberately tags every occurrence; the multi-List sweep deduplicates those occurrences,
 *     preserves an existing mirror's project, and holds an unmapped task seen in multiple bound Lists
 *     rather than adopting it ambiguously.
 */
function buildListQuery(cursor: string | null, page: number): URLSearchParams {
  const query = new URLSearchParams({
    order_by: 'updated',
    page: String(page),
    include_closed: 'true',
    subtasks: 'true',
    archived: 'true',
    include_timl: 'true',
  });
  if (cursor !== null) query.set('date_updated_gt', String(Math.max(0, Number(cursor) - 1)));
  return query;
}

/**
 * Page `GET /list/{list_id}/task` until the server signals `last_page` (shared by the mapped read
 * and the raw sweep source — DRY). Returns the LIVE (non-archived) ClickUp tasks + the max
 * `date_updated` observed **across every task fetched, archived or not** as the next cursor (`null` at
 * exhaustion). Archived tasks are excluded from the returned `tasks` (never mirrored as live — see
 * `buildListQuery`'s `archived=true` note) but still count toward the cursor: otherwise an org whose
 * only recent ClickUp activity is archiving a task would re-fetch that same page forever (the cursor
 * would never move past it). The cursor is made inclusive (`date_updated_gt` = cursor − 1ms) so a task
 * last seen exactly at the boundary is re-included, not silently skipped.
 */
async function pageListTasks(
  deps: ClickUpClientDeps & { listId: string },
  cursor: string | null,
  priority: ClickUpLanePriority,
): Promise<{ tasks: ClickUpTask[]; archivedTaskIds: string[]; nextCursor: string | null }> {
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
  const liveTasks = allTasks.filter((t) => t.archived !== true);
  // SEC-MEDIUM-6: archived tasks are never mirrored as LIVE (see the module docstring), but they must
  // not be silently discarded either — a caller (the sweep) needs their ids to archive an EXISTING
  // mirror. Surfaced separately so every current consumer of `tasks` (live-only) is unaffected.
  const archivedTaskIds = allTasks.filter((t) => t.archived === true).map((t) => t.id);
  return { tasks: liveTasks, archivedTaskIds, nextCursor };
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
): Promise<{ changes: ClickUpTask[]; archivedTaskIds: string[]; nextCursor: string | null }> {
  const { tasks, archivedTaskIds, nextCursor } = await pageListTasks(deps, cursor, 'bulk');
  return { changes: tasks, archivedTaskIds, nextCursor };
}

/**
 * A single bound List the multi-List sweep enumerates (item 5, bound-List lifecycle). Carries the
 * List's OWN watermark cursor (SEC-HIGH-1) — the org has ONE `external_sync_watermarks` row shared
 * across every bound List; when List A 404s but List B is healthy, advancing a SINGLE merged
 * org-cursor off B's progress silently skips over any UNREAD change still sitting behind A's own
 * (unmoved) cursor once A is restored — data lost forever, since the next read of A starts from the
 * now-advanced org cursor, not from where A itself left off. Each List's cursor must be read AND
 * advanced independently.
 */
export interface ClickUpListBindingRef {
  listId: string;
  statusMap: ClickUpStatusMap;
  memberMap: ClickUpMemberMap;
  /** This List's OWN cursor — never a value shared/merged with any other List. */
  cursor: string | null;
}

/** One raw task tagged with the List it came from (the sweep resolves the adopt-mint project by this). */
export interface ClickUpTaggedRawChange {
  task: ClickUpTask;
  listId: string;
}

export interface ClickUpMultiListRawChanges {
  changes: ClickUpTaggedRawChange[];
  /** Every archived task id seen across every List that read successfully this cycle (SEC-MEDIUM-6) —
   *  `pageListTasks` filters archived tasks out of `changes` (never mirrored as live); a caller with an
   *  EXISTING mirror for one of these ids archives it. */
  archivedTaskIds: string[];
  /** Each List's OWN next cursor, keyed by `listId` — present ONLY for a List that read successfully
   *  AND had something to advance past (absent for a 404'd List or one with nothing new since its own
   *  cursor). SEC-HIGH-1: never a merged/org-wide value — a caller advances EACH List's watermark row
   *  independently off this map, so a List's own progress is never contaminated by a sibling's outage
   *  or a sibling simply being further ahead. */
  perListNextCursor: Record<string, string>;
  /** listIds whose `GET /list/{id}/task` 404'd this cycle — the List was deleted/moved. The caller
   *  marks these bindings unhealthy (P4 health surface) rather than failing the whole org sweep. */
  notFoundListIds: string[];
}

/**
 * Read raw changes across every List a sweep enumerates for one org (item 5, bound-List lifecycle),
 * each on its OWN cursor (SEC-HIGH-1 — see `ClickUpListBindingRef`). Previously, `clickup-sweep`'s
 * per-org loop threw on the FIRST List read failure — including a 404 from a deleted/moved List —
 * which aborted the WHOLE org's sweep. A 404 is caught PER LIST: that List is skipped (reported in
 * `notFoundListIds`, its own cursor left completely untouched by the caller) and every other bound
 * List still enumerates + still reports its own progress. Any OTHER error (network, 5xx, 4xx) still
 * propagates — only a 404 (the specific "this List no longer exists here" signal) is skippable.
 */
export async function clickUpListRawChangesAcrossLists(
  lists: ClickUpListBindingRef[],
  clientDeps: Pick<ClickUpClientDeps, 'fetchImpl' | 'token' | 'baseUrl' | 'rateLimiter' | 'onRateLimitInfo'>,
): Promise<ClickUpMultiListRawChanges> {
  const changes: ClickUpTaggedRawChange[] = [];
  const archivedTaskIds: string[] = [];
  const notFoundListIds: string[] = [];
  const perListNextCursor: Record<string, string> = {};
  for (const list of lists) {
    try {
      const {
        changes: rawTasks,
        archivedTaskIds: archivedForList,
        nextCursor,
      } = await clickUpListRawChangesSinceWatermark(list.cursor, {
        ...clientDeps,
        listId: list.listId,
        statusMap: list.statusMap,
        memberMap: list.memberMap,
      });
      for (const t of rawTasks) changes.push({ task: t, listId: list.listId });
      archivedTaskIds.push(...archivedForList);
      if (nextCursor !== null) perListNextCursor[list.listId] = nextCursor;
    } catch (err) {
      if (err instanceof ClickUpHttpError && err.status === 404) {
        notFoundListIds.push(list.listId);
        continue;
      }
      throw err;
    }
  }
  return { changes, archivedTaskIds, perListNextCursor, notFoundListIds };
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

/**
 * The WORKER's re-GET (OD-INT-11, 2026-07-20): `GET /task/{id}` returning the RAW `ClickUpTask` — not
 * the mapped canonical `clickUpGetByExternalId` returns — because the worker needs fields the mapping
 * discards: `list.id` (binding resolution, never the payload's nonexistent `list_id`), `date_updated`
 * (the source-mod cursor, never on a webhook payload), and `archived`. `null` on a 404 (the task no
 * longer exists — the caller collapses this to the same tombstone-if-mapped path as a `taskDeleted`).
 * Interactive lane (`priority: 'interactive'` default omitted ⇒ `'bulk'` is NOT used here — this is a
 * single-row, latency-sensitive webhook-worker read, not a bulk sweep page).
 */
export async function clickUpGetTaskRaw(
  taskId: string,
  deps: ClickUpClientDeps,
): Promise<ClickUpTask | null> {
  try {
    return (await clickUpRequest(deps, {
      method: 'GET',
      path: `/task/${taskId}`,
      priority: 'interactive',
    })) as ClickUpTask;
  } catch (err) {
    if (err instanceof ClickUpHttpError && err.status === 404) return null;
    throw err;
  }
}
