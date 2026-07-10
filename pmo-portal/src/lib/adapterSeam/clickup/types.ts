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
