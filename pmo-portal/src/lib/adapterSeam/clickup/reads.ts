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

/** Pages one bound List may read per sweep cycle. The edge function's wall clock is 150 s (see
 *  `_shared/jobRun.ts`) and the bulk lane allows 100 requests/min (`rateLimit.ts`), so the 1000-page
 *  safety valve is ~10 minutes of reads: the platform would kill the invocation before any cursor was
 *  written. A capped read is not lost work: it reports `complete: false` with a keyset resume cursor. */
export const SWEEP_LIST_PAGE_CAP = 10;

/**
 * A read cursor is the last `date_updated` (ms) fully read, optionally with a page offset
 * (`"<ms>:<page>"`) that resumes INSIDE a run of tasks sharing one timestamp that is wider than the
 * page cap — `date_updated_gt` alone can never get past such a tie, so the offset is what drains it.
 * A plain `"<ms>"` (the only form the rest of the system writes) always means offset 0.
 */
export function parseReadCursor(cursor: string): { ms: number; page: number } {
  const [ms, page] = cursor.split(':');
  return { ms: Number(ms), page: page === undefined ? 0 : Number(page) };
}

/** The later of two cursors (by timestamp, then page offset) — never rewinds a stored watermark. */
export function laterReadCursor(a: string, b: string): string {
  const x = parseReadCursor(a);
  const y = parseReadCursor(b);
  return y.ms > x.ms || (y.ms === x.ms && y.page > x.page) ? b : a;
}

/**
 * Build the `date_updated_gt` + `page` query string for one keyset step. `gtMs` is the exclusive lower
 * bound (the cursor minus 1 ms, so the boundary timestamp is re-read: inclusive).
 *
 * `GET /list/{id}/task` EXCLUDES four categories by default (ClickUp REST v2) — each flag below closes
 * one hole in the read-hygiene sweep:
 *   - `include_closed=true`: without it, closed-status tasks never reach the change-feed (found by the
 *     live smoke, 2026-07-11 — a completion made in ClickUp would never mirror into PMO).
 *   - `subtasks=true`: without it, ClickUp subtasks NEVER reach PMO at all. With it, the feed carries
 *     tasks whose `parent` field `inboundRecord.ts` resolves to the PMO parent link.
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
function buildListQuery(gtMs: number | null, page: number, reverse: boolean): URLSearchParams {
  const query = new URLSearchParams({
    order_by: 'updated',
    reverse: String(reverse),
    page: String(page),
    include_closed: 'true',
    subtasks: 'true',
    archived: 'true',
    include_timl: 'true',
  });
  if (gtMs !== null) query.set('date_updated_gt', String(Math.max(0, gtMs)));
  return query;
}

/** `asc` / `desc` when a page's timestamps strictly move one way, else `null` (one timestamp, or unordered). */
function pageDirection(tasks: ClickUpTask[]): 'asc' | 'desc' | null {
  const ms = tasks.map((t) => Number(t.date_updated));
  let asc = true;
  let desc = true;
  for (let i = 1; i < ms.length; i += 1) {
    if (ms[i] < ms[i - 1]) asc = false;
    if (ms[i] > ms[i - 1]) desc = false;
  }
  if (asc === desc) return null;
  return asc ? 'asc' : 'desc';
}

/**
 * Page `GET /list/{list_id}/task` by KEYSET on `date_updated` until the server signals `last_page` (or a
 * page/time budget runs out), shared by the mapped read and the raw sweep source. Returns the LIVE
 * (non-archived) ClickUp tasks + a resume cursor.
 *
 * Why keyset, not `page=N` offsets: an offset shifts when an already-read task is edited mid-read (it
 * moves to the end, every later row slides up one, and the first row of the next page lands on the page
 * already read — skipped for good once the cursor passes it). Here every step asks for
 * `date_updated_gt = (greatest timestamp read so far) − 1` at `page=0`, so an edit can only move a task
 * LATER, where this read or the next one finds it. The greatest timestamp is taken over the whole page
 * (min/max, never first/last row), so the order inside a page does not matter.
 *
 * Ties: a page that is not the last and holds ONE timestamp means more rows share it than fit a page;
 * `date_updated_gt` alone can never get past them, so the page offset is used INSIDE that tie only
 * (`<ms>:<page>`). ponytail: that offset can still shift if a tied task is edited mid-drain (needs
 * >100 tasks sharing a millisecond AND a concurrent edit); ClickUp offers no id tie-break to do better.
 *
 * Direction: `reverse=true` is sent as "oldest first", but ClickUp's docs do not state the base order. The
 * first page with two timestamps settles it: a strictly newest-first page whose max has nothing newer
 * (the server is walking from the newest end) flips `reverse` once and re-asks; a second newest-first
 * answer is an error, never a silent partial read. A page merely LISTED newest-first inside an
 * oldest-window needs no flip, since the keyset step reads min/max, not row order.
 *
 * Archived tasks are excluded from the returned `tasks` (never mirrored as live — see `buildListQuery`)
 * but still count toward the cursor, else an org whose only recent activity is archiving a task would
 * re-fetch that page forever.
 *
 * Cursor: complete → the newest timestamp read (plain; the next read re-includes that boundary).
 * Stopped early → the keyset position `<anchor+1>[:<page>]`; everything older is read.
 */
async function pageListTasks(
  deps: ClickUpClientDeps & { listId: string; maxPages?: number; deadlineAtMs?: number },
  cursor: string | null,
  priority: ClickUpLanePriority,
): Promise<{ tasks: ClickUpTask[]; archivedTaskIds: string[]; nextCursor: string | null; complete: boolean }> {
  const start = cursor !== null ? parseReadCursor(cursor) : null;
  const maxPages = deps.maxPages ?? MAX_PAGES;
  const seen = new Map<string, ClickUpTask>();
  let anchor: number | null = start !== null ? Math.max(0, start.ms - 1) : null; // exclusive lower bound
  let page = start?.page ?? 0;
  let reverse = true;
  let directionSettled = false;
  let complete = false;
  let pagesRead = 0;
  while (pagesRead < maxPages && !(deps.deadlineAtMs !== undefined && Date.now() >= deps.deadlineAtMs)) {
    const request = async (gtMs: number | null = anchor, pageNo = page) =>
      (await clickUpRequest(deps, {
        method: 'GET',
        path: `/list/${deps.listId}/task?${buildListQuery(gtMs, pageNo, reverse).toString()}`,
        priority,
      })) as ClickUpTaskListResponse;
    let raw = await request();
    const direction = directionSettled ? null : pageDirection(raw.tasks ?? []);
    if (direction !== null) directionSettled = true;
    if (direction === 'desc' && raw.last_page !== true) {
      // Newest-first, or an oldest-window page merely listed backwards? The page of the NEWEST rows has
      // nothing newer than its own maximum; an oldest-window page does. Only the first answers an empty probe.
      const probe = await request(Math.max(...(raw.tasks ?? []).map((t) => Number(t.date_updated))), 0);
      if ((probe.tasks ?? []).length === 0) {
        reverse = !reverse;
        raw = await request();
        if (pageDirection(raw.tasks ?? []) === 'desc') {
          throw new Error('ClickUp returned the list newest-first with either reverse setting; refusing a partial read');
        }
      }
    }
    pagesRead += 1;
    const tasks = raw.tasks ?? [];
    for (const t of tasks) seen.set(t.id, t);
    if (tasks.length === 0 || raw.last_page === true) {
      complete = true;
      break;
    }
    const stamps = tasks.map((t) => Number(t.date_updated));
    const newest = Math.max(...stamps);
    if (Math.min(...stamps) === newest) {
      // A whole page at one timestamp: stay on it and move the offset (the first such page was page 0
      // of an older window, which re-anchored at newest−1 is page 1 of the same rows).
      page = anchor === newest - 1 ? page + 1 : 1;
    } else {
      page = 0;
    }
    anchor = newest - 1;
  }
  const all = [...seen.values()];
  const newestMs = all.length > 0 ? Math.max(...all.map((t) => Number(t.date_updated))) : null;
  let nextCursor: string | null;
  if (complete) nextCursor = newestMs !== null ? String(newestMs) : null;
  else if (pagesRead === 0 || anchor === null) nextCursor = null; // budget spent before the first page: nothing new to resume from
  else nextCursor = page > 0 ? `${anchor + 1}:${page}` : String(anchor + 1);
  const liveTasks = all.filter((t) => t.archived !== true);
  // SEC-MEDIUM-6: archived tasks are never mirrored as LIVE (see the module docstring), but they must
  // not be silently discarded either — a caller (the sweep) needs their ids to archive an EXISTING
  // mirror. Surfaced separately so every current consumer of `tasks` (live-only) is unaffected.
  const archivedTaskIds = all.filter((t) => t.archived === true).map((t) => t.id);
  return { tasks: liveTasks, archivedTaskIds, nextCursor, complete };
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
  deps: ClickUpReadDeps & { maxPages?: number; deadlineAtMs?: number },
): Promise<{ changes: ClickUpTask[]; archivedTaskIds: string[]; nextCursor: string | null; complete: boolean }> {
  const { tasks, archivedTaskIds, nextCursor, complete } = await pageListTasks(deps, cursor, 'bulk');
  return { changes: tasks, archivedTaskIds, nextCursor, complete };
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
  /** Lists whose read stopped at the page cap with more still unread. Their `perListNextCursor` is a
   *  safe partial resume point; the caller reports the List as incomplete and the next cycle continues. */
  incompleteListIds: string[];
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
  /** `deadlineAtMs`: the invocation's read budget (epoch ms) — a List not finished by then is reported
   *  incomplete with its keyset cursor. `maxPagesPerList` defaults to `SWEEP_LIST_PAGE_CAP`. */
  opts: { deadlineAtMs?: number; maxPagesPerList?: number } = {},
): Promise<ClickUpMultiListRawChanges> {
  const changes: ClickUpTaggedRawChange[] = [];
  const archivedTaskIds: string[] = [];
  const notFoundListIds: string[] = [];
  const incompleteListIds: string[] = [];
  const perListNextCursor: Record<string, string> = {};
  for (const list of lists) {
    try {
      const {
        changes: rawTasks,
        archivedTaskIds: archivedForList,
        nextCursor,
        complete,
      } = await clickUpListRawChangesSinceWatermark(list.cursor, {
        ...clientDeps,
        listId: list.listId,
        statusMap: list.statusMap,
        memberMap: list.memberMap,
        maxPages: opts.maxPagesPerList ?? SWEEP_LIST_PAGE_CAP,
        deadlineAtMs: opts.deadlineAtMs,
      });
      for (const t of rawTasks) changes.push({ task: t, listId: list.listId });
      archivedTaskIds.push(...archivedForList);
      if (nextCursor !== null) perListNextCursor[list.listId] = nextCursor;
      if (!complete) incompleteListIds.push(list.listId);
    } catch (err) {
      if (err instanceof ClickUpHttpError && err.status === 404) {
        notFoundListIds.push(list.listId);
        continue;
      }
      throw err;
    }
  }
  return { changes, archivedTaskIds, perListNextCursor, incompleteListIds, notFoundListIds };
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
