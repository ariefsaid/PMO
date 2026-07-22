/**
 * ClickUp REST v2 wire shapes (FR-CUA-012 confinement: ClickUp vocabulary lives ONLY here + the
 * clickup-webhook function). Nothing above this module — the contract, dispatch, repositories, UI —
 * ever imports these types.
 */

/** A ClickUp task's status sub-object (REST v2). */
export interface ClickUpTaskStatus {
  status: string;
}

/** A ClickUp assignee reference (REST v2 `assignees[]` entry). */
export interface ClickUpAssigneeRef {
  id: number;
}

/** The ClickUp List a task belongs to (REST v2 `list` sub-object on a full task GET). */
export interface ClickUpTaskList {
  id: string;
}

/** The ClickUp REST v2 task shape (subset — only the fields the mapping set consumes, FR-CUA-010). */
export interface ClickUpTask {
  id: string;
  name: string;
  status: ClickUpTaskStatus;
  assignees: ClickUpAssigneeRef[];
  /** Unix-ms as a string (ClickUp convention), or null when unset. */
  start_date: string | null;
  /** Unix-ms as a string (ClickUp convention), or null when unset. */
  due_date: string | null;
  /** Unix-ms as a string — the ClickUp last-modified timestamp (the sync-cursor field). Only ever
   *  observed on a `GET /task/{id}` response — a webhook delivery carries NO `date_updated`
   *  (2026-07-20 live-verified, 7/7 real deliveries) so this is now the WORKER's re-GET cursor, never
   *  read off a webhook payload. */
  date_updated: string;
  /** Unix-ms as a string — set when the task was marked done; null otherwise (FR-CUA-030 Finding 6). */
  date_done?: string | null;
  /** The List this task belongs to — only present on a full task GET, never on a webhook payload. The
   *  worker's re-GET is the ONLY source of `list.id` for binding resolution (2026-07-20 fix — the
   *  payload's `list_id` never exists on a real delivery, so the old payload-driven adopt path was
   *  unreachable dead code). */
  list?: ClickUpTaskList;
  /** Current archived state. Present on a full task GET, and on sweep reads because they now pass
   *  `archived=true` (read-hygiene fix) — `pageListTasks` filters archived rows out of every returned
   *  change set so one is never mirrored as live. Archiving fires `taskUpdated` with a
   *  `history_items[].field === 'archived'` entry (NEVER `taskDeleted`), which the worker maps to
   *  `tasks.archived_at` (the column now exists — migration `0140`). */
  archived?: boolean;
  /** The parent task id when this is a ClickUp subtask. Only present because reads now pass
   *  `subtasks=true` (read-hygiene fix). PMO now HAS `tasks.parent_task_id` (migration `0140`), but the
   *  two are NOT yet wired together — a ClickUp subtask still flows through mapping as a flat
   *  top-level task, and this field is deliberately never read by `mapping.ts`. Syncing
   *  `parent` ↔ `parent_task_id` is its own issue. */
  parent?: string | null;
}

/** A page of tasks from `GET /list/{list_id}/task` (REST v2). */
export interface ClickUpTaskListResponse {
  tasks: ClickUpTask[];
  /** True when this is the last page (ClickUp REST v2 pagination convention). */
  last_page?: boolean;
}

/** ClickUp v2 **create** body (`POST /list/{list_id}/task`) — assignees is a flat id array. */
export interface ClickUpCreateTaskBody {
  name?: string;
  status?: string;
  assignees?: number[];
  start_date?: number;
  due_date?: number;
  /** Parent task id (ClickUp subtask parent) — settable on create to make the task a subtask in the same List. */
  parent?: string | null;
}

/** ClickUp v2 **update** body (`PUT /task/{id}`) — assignees is an add/rem delta, not a flat array. */
export interface ClickUpUpdateTaskBody {
  name?: string;
  status?: string;
  assignees?: { add: number[]; rem: number[] };
  start_date?: number;
  due_date?: number;
  /** Parent task id — set to re-parent, or `null` to promote to top-level. */
  parent?: string | null;
}

// ── Webhook ingress shapes (FR-CUA-040..044) ───────────────────────────────────────────────────
// REAL wire shape (2026-07-20 live-verified against the real ClickUp API, 7/7 deliveries, identical
// envelope): `{event, task_id, team_id, webhook_id, history_items}`. NO `task` object, NO
// `date_updated`, NO `list_id` — ever. ClickUp webhook vocabulary is confined to this file + the
// clickup-webhook / clickup-webhook-worker fns.

/** The four ClickUp task-webhook event verbs (FR-CUA-040). `taskStatusUpdated` is a pure duplicate of
 *  `taskUpdated` for a status change (one status change fires BOTH) — still accepted here because a
 *  currently-registered ClickUp webhook may still be subscribed to it; the worker treats it identically
 *  to `taskUpdated` (re-GET + apply full state). New webhook registrations should subscribe to
 *  `taskCreated`/`taskUpdated`/`taskDeleted` only. */
export type ClickUpWebhookEvent = 'taskCreated' | 'taskUpdated' | 'taskStatusUpdated' | 'taskDeleted';

/** One ClickUp `history_items[]` entry (REST v2 webhook envelope) — the only per-change detail a
 *  delivery carries. `field`/`after` are the ones this codebase reads (e.g. `field: 'archived'`,
 *  `after: 'true'|'false'` — ClickUp stringifies the boolean here); the rest passes through opaque. */
export interface ClickUpHistoryItem {
  field: string;
  after?: unknown;
  before?: unknown;
  /** Unix-ms as a string — when this specific history entry happened. */
  date?: string;
  [key: string]: unknown;
}

/**
 * A ClickUp task-webhook payload — the REAL envelope (2026-07-20 live-verified): the event verb, the
 * ClickUp task id, `team_id`/`webhook_id` (both undocumented-but-present, `team_id` is a usable org
 * hint), and `history_items` (empty on `taskDeleted`). Carries NO task body and NO timestamp — the
 * worker re-GETs the task for both (OD-INT-11).
 */
export interface ClickUpWebhookPayload {
  event: ClickUpWebhookEvent;
  /** The ClickUp task id this event concerns. */
  task_id: string;
  /** The ClickUp Workspace (Team) id — undocumented by ClickUp but present on every real delivery; a
   *  usable org-narrowing hint, never the sole binding-resolution key (P1 remains single-org). */
  team_id?: string;
  webhook_id?: string;
  /** Per-change detail; empty array on `taskDeleted` (ClickUp sends no state at all for a delete). */
  history_items: ClickUpHistoryItem[];
}

const KNOWN_WEBHOOK_EVENTS: ReadonlySet<string> = new Set([
  'taskCreated',
  'taskUpdated',
  'taskStatusUpdated',
  'taskDeleted',
]);

/**
 * Validate + narrow an unknown parsed JSON body into a `ClickUpWebhookPayload` — the ingress's ONLY
 * read of the raw envelope. Requires `event` (a known verb) and a non-empty `task_id`; `team_id`/
 * `webhook_id` are optional passthrough; `history_items` defaults to `[]` when absent/malformed.
 * Returns `null` for anything that doesn't satisfy the minimum shape (the ingress replies 400).
 */
export function parseWebhookEnvelope(raw: unknown): ClickUpWebhookPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const event = obj.event;
  if (typeof event !== 'string' || !KNOWN_WEBHOOK_EVENTS.has(event)) return null;
  const taskId = obj.task_id;
  if (typeof taskId !== 'string' || taskId.length === 0) return null;
  const historyItems = Array.isArray(obj.history_items) ? (obj.history_items as ClickUpHistoryItem[]) : [];
  return {
    event: event as ClickUpWebhookEvent,
    task_id: taskId,
    team_id: typeof obj.team_id === 'string' ? obj.team_id : undefined,
    webhook_id: typeof obj.webhook_id === 'string' ? obj.webhook_id : undefined,
    history_items: historyItems,
  };
}
