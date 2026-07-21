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
  /** Unix-ms as a string — the ClickUp last-modified timestamp (the sync-cursor field). */
  date_updated: string;
  /** Unix-ms as a string — set when the task was marked done; null otherwise (FR-CUA-030 Finding 6). */
  date_done?: string | null;
  /** True when the task is archived in ClickUp. Only present because reads now pass `archived=true`
   *  (read-hygiene fix); `pageListTasks` filters these out of every returned change set — an archived
   *  task must never be mirrored as live (no `archived_at` column on this branch to record the state
   *  faithfully instead). */
  archived?: boolean;
  /** The parent task id when this is a ClickUp subtask. Only present because reads now pass
   *  `subtasks=true` (read-hygiene fix). PMO does NOT model parent/child yet — a subtask flows through
   *  mapping as a flat top-level task (this field is deliberately never read by `mapping.ts`); the
   *  subtask data model is a separate, later issue. */
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
}

/** ClickUp v2 **update** body (`PUT /task/{id}`) — assignees is an add/rem delta, not a flat array. */
export interface ClickUpUpdateTaskBody {
  name?: string;
  status?: string;
  assignees?: { add: number[]; rem: number[] };
  start_date?: number;
  due_date?: number;
}

// ── Webhook ingress shapes (FR-CUA-040..044) ───────────────────────────────────────────────────
// PROVISIONAL wire shape (mocked-only in P1; re-verified in the deferred live-smoke appendix, same
// stance as mapping.ts). ClickUp webhook vocabulary is confined to this file + the clickup-webhook fn.

/** The four ClickUp task-webhook event verbs (FR-CUA-040). */
export type ClickUpWebhookEvent = 'taskCreated' | 'taskUpdated' | 'taskStatusUpdated' | 'taskDeleted';

/**
 * A ClickUp task-webhook payload. Carries the event verb, the ClickUp task id, the ClickUp
 * `date_updated` (unix-ms string — the per-row source-mod guard value + the watermark cursor), and
 * the full task body for created/updated/status-updated events (absent on `taskDeleted`).
 */
export interface ClickUpWebhookPayload {
  event: ClickUpWebhookEvent;
  /** The ClickUp task id this event concerns. */
  task_id: string;
  /** ClickUp `date_updated` (unix-ms string) — the source-modification + watermark cursor field. */
  date_updated: string;
  /** The ClickUp List id the task belongs to — used by the ingress to resolve the org + project
   *  binding for an UNMAPPED (adopt) task. Absent on some verbs (e.g. a minimal `taskDeleted`). */
  list_id?: string;
  /** The full task body for created/updated/status-updated events; absent on `taskDeleted`. */
  task?: ClickUpTask;
}
