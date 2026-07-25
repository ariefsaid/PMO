/**
 * ClickUp <-> PMO task field mapping (FR-CUA-010). The ONLY mapping set moved: name, status,
 * assignee, start_date, due_date->end_date. Unix-ms <-> ISO boundary conversion happens HERE — no
 * ClickUp date shape ever crosses above this module. `org_id` never appears in a mapped record
 * (FR-EAS-024, inherited from the P0 contract).
 */
import type { PmoRecord } from '../contract.ts';
import type { ClickUpCreateTaskBody, ClickUpTask, ClickUpUpdateTaskBody } from './types.ts';
import { fromClickUpStatus, toClickUpStatus, type ClickUpStatusMap } from './statusMap.ts';
import { fromClickUpAssignee, toClickUpAssignee, type ClickUpMemberMap } from './memberMap.ts';

export interface ClickUpMaps {
  statusMap: ClickUpStatusMap;
  memberMap: ClickUpMemberMap;
}

function msToIso(ms: string): string {
  return new Date(Number(ms)).toISOString();
}

function isoToMs(iso: string): number {
  return new Date(iso).getTime();
}

/**
 * OD-INT-9 — the FIXED PMO↔ClickUp priority map. Deliberately NOT per-List config (unlike the status
 * map, which rotted): `Urgent=1, High=2, Normal=3, Low=4` is ClickUp's documented REST v2 priority
 * ordering, and PMO's `task_priority` enum mirrors it 1:1. A null/absent priority on either side maps
 * to null/omitted on the other — NEVER invent a default.
 */
const PMO_PRIORITY_TO_CLICKUP: Readonly<Record<string, number>> = {
  Urgent: 1,
  High: 2,
  Normal: 3,
  Low: 4,
};

/**
 * The reverse map (ClickUp label → PMO enum). Keys are LOWERCASE because ClickUp's GET priority
 * object carries the label lowercase on the wire; lookup lowercases first so a casing drift can
 * never silently drop a priority to null.
 */
const CLICKUP_PRIORITY_TO_PMO: Readonly<Record<string, string>> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

/** Outbound: a PMO priority label (or null/absent) → the ClickUp integer, or `undefined` to omit. */
function pmoPriorityToClickUp(pmoPriority: unknown): number | undefined {
  if (typeof pmoPriority !== 'string') return undefined;
  const n = PMO_PRIORITY_TO_CLICKUP[pmoPriority];
  return n !== undefined ? n : undefined; // unknown label → omit (never invent)
}

/**
 * Inbound: a ClickUp GET priority object (or null/absent) → the PMO enum label, or null. The label is
 * lowercased before lookup so a casing drift on ClickUp's side never silently drops it to null.
 */
function clickUpPriorityToPmo(rawPriority: unknown): string | null {
  if (!rawPriority || typeof rawPriority !== 'object') return null;
  const label = (rawPriority as { priority?: unknown }).priority;
  if (typeof label !== 'string') return null;
  return CLICKUP_PRIORITY_TO_PMO[label.toLowerCase()] ?? null; // unknown label → null (never invent)
}

/**
 * ClickUp task JSON -> canonical PMO record. `id` is the ClickUp task id here (this pure mapper has
 * no access to a PMO id) — callers that already know the PMO id (commands.ts, on a create/update
 * response) overwrite it; callers that don't (reads.ts) leave it for the caller's own
 * external_refs/adopt resolution (Slice D).
 *
 * `currentPmoStatus` (optional — the mirrored row's PMO status BEFORE this inbound change, when a
 * caller can cheaply resolve it) is threaded straight through to `fromClickUpStatus`'s stickiness
 * (OD-INT-10, round 3): a `pmo-only` status is never moved out of by an inbound sync, and an
 * explicitly recorded collapse never downgrades the more specific PMO status. Absent (the default),
 * behavior is byte-for-byte identical to before this parameter existed.
 *
 * `resolvedParentPmoId` (optional — OD-INT-9 parent sync): when the ClickUp task has a `parent`
 * field and the caller can resolve it via `external_refs` to a PMO task id, that id is passed here.
 * The pure mapper has no DB access, so the lookup happens in the apply path and the resolved PMO
 * id is threaded in — exactly like `currentPmoStatus`. When the parent is unresolvable (not yet
 * mirrored), the caller passes `null` and the child flows through as a flat task; the next sweep
 * re-applies and resolves it once the parent exists.
 */
export function clickUpTaskToPmoRecord(
  raw: ClickUpTask,
  maps: ClickUpMaps,
  currentPmoStatus?: string,
  resolvedParentPmoId?: string | null,
): PmoRecord {
  const assigneeClickUpId = raw.assignees[0]?.id;
  return {
    id: raw.id,
    name: raw.name,
    status: fromClickUpStatus(maps.statusMap, raw.status.status, currentPmoStatus),
    assignee_id: assigneeClickUpId !== undefined ? fromClickUpAssignee(maps.memberMap, assigneeClickUpId) : null,
    start_date: raw.start_date ? msToIso(raw.start_date) : null,
    end_date: raw.due_date ? msToIso(raw.due_date) : null,
    completed_at: raw.date_done ? msToIso(raw.date_done) : null,
    // OD-INT-9: description + priority round-trip inbound. A null/absent value on ClickUp's side
    // maps to null on the PMO side — never invent a default. ClickUp's GET priority is an OBJECT
    // (asymmetric vs. the write integer); clickUpPriorityToPmo handles the object → PMO-enum label.
    description: raw.description ?? null,
    priority: clickUpPriorityToPmo(raw.priority),
    // Parent sync (OD-INT-9): when the ClickUp task has a `parent` and the caller resolved it to a
    // PMO task id, include it. `null` means explicitly top-level (or unresolvable — caller decided).
    // Absent `resolvedParentPmoId` (undefined) means the caller didn't attempt resolution;
    // the field is omitted from the canonical record (updateMirror only patches present fields).
    ...(resolvedParentPmoId !== undefined ? { parent_task_id: resolvedParentPmoId } : {}),
  };
}

export interface PmoTaskToClickUpBodyOptions {
  mode: 'create' | 'update';
  /** The ClickUp member ids currently assigned (before this write) — required to compute the
   * update-mode add/rem delta. Absent/empty on create (there is nothing to remove). */
  previousAssigneeIds?: number[];
  /** Resolved ClickUp parent task id (from `external_refs`), or `null` for explicit top-level
   * promotion. When provided on create, sets `parent` to make the task a subtask in the same List.
   * When provided on update, re-parents (or promotes if `null`). Absent = no parent change. */
  parentClickUpId?: string | null;
}

function resolveAssigneeId(memberMap: ClickUpMemberMap, pmoAssigneeId: unknown): number | null {
  if (typeof pmoAssigneeId !== 'string') return null;
  // `.id` is read directly (never narrowed off `.unassigned`) — see the note on
  // ClickUpAssigneeResolution: this repo's tsconfig runs with strictNullChecks off, under which
  // discriminated-union narrowing is unreliable. The resolution shape is flat (`id: number | null`)
  // precisely so no narrowing is needed here.
  return toClickUpAssignee(memberMap, pmoAssigneeId).id;
}

/** The scalar (non-assignee) fields shared by both request-body shapes. */
interface ClickUpScalarFields {
  name?: string;
  status?: string;
  start_date?: number;
  due_date?: number;
  description?: string;
  priority?: number;
}

/**
 * Canonical PMO record (full record on create; a partial patch on update/transition) -> the ClickUp
 * v2 request body. Branches on `opts.mode` because ClickUp v2's assignee shape differs by verb
 * (FR-CUA-010, the B2 warning): **create** takes `assignees:[ids]`; **update** takes
 * `assignees:{add:[],rem:[]}`. Only fields PRESENT in `record` are emitted — never the full field set
 * on a partial update.
 *
 * Parent sync (OD-INT-9): the caller threads a resolved `parentClickUpId` (or `null` for explicit
 * top-level promotion) via `opts.parentClickUpId`. The pure mapper has no DB access, so the
 * `external_refs` lookup happens in the dispatch factory / apply path and the resolved ClickUp id
 * is passed in — exactly like `resolvePreviousAssigneeIds` and `currentPmoStatus`.
 */
export function pmoTaskToClickUpBody(
  record: PmoRecord,
  maps: ClickUpMaps,
  opts: PmoTaskToClickUpBodyOptions,
): ClickUpCreateTaskBody | ClickUpUpdateTaskBody {
  const scalarFields: ClickUpScalarFields = {};
  if ('name' in record) scalarFields.name = record.name as string;
  if ('status' in record) {
    // A `pmo-only` PMO status (OD-INT-10, round 3) resolves to `undefined` here — a legitimate
    // configured outcome, not a config error: the other patched fields still sync, the status key is
    // simply omitted from the ClickUp write (there is nothing to write it as).
    const clickUpStatus = toClickUpStatus(maps.statusMap, record.status as string);
    if (clickUpStatus !== undefined) scalarFields.status = clickUpStatus;
  }
  if ('start_date' in record) {
    scalarFields.start_date = record.start_date ? isoToMs(record.start_date as string) : undefined;
  }
  if ('end_date' in record) {
    scalarFields.due_date = record.end_date ? isoToMs(record.end_date as string) : undefined;
  }
  // OD-INT-9: description + priority round-trip outbound. Only a NON-EMPTY description string is
  // emitted (null/empty/absent → omit, never write an empty string). A priority is emitted ONLY when
  // it is a known PMO enum label (mapped to the fixed ClickUp integer); null/absent/unknown → omit
  // (never invent a default). This matches the start_date/due_date precedent in this same block.
  if ('description' in record) {
    const desc = record.description;
    if (typeof desc === 'string' && desc.length > 0) {
      scalarFields.description = desc;
    }
  }
  if ('priority' in record) {
    const clickUpPriority = pmoPriorityToClickUp(record.priority);
    if (clickUpPriority !== undefined) scalarFields.priority = clickUpPriority;
  }

  if (opts.mode === 'create') {
    const body: ClickUpCreateTaskBody = {
      ...scalarFields,
      assignees: (() => {
        const id = resolveAssigneeId(maps.memberMap, record.assignee_id);
        return id !== null ? [id] : [];
      })(),
    };
    // Parent sync (OD-INT-9): when a RESOLVED ClickUp parent id is provided (string),
    // set `parent` on create to make the task a subtask in the same List.
    // `null` means unresolved — omit entirely (flat task); reconciliation happens later.
    // `undefined` means no parent change requested.
    if (typeof opts.parentClickUpId === 'string') {
      body.parent = opts.parentClickUpId;
    }
    return body;
  }

  const body: ClickUpUpdateTaskBody = { ...scalarFields };
  if ('assignee_id' in record) {
    const nextId = resolveAssigneeId(maps.memberMap, record.assignee_id);
    const prev = opts.previousAssigneeIds ?? [];
    const next = nextId !== null ? [nextId] : [];
    body.assignees = {
      add: next.filter((id) => !prev.includes(id)),
      rem: prev.filter((id) => !next.includes(id)),
    };
  }
  // Parent sync (OD-INT-9): on update, when a resolved parentClickUpId is provided,
  // set `parent` to re-parent (or `null` to promote to top-level).
  // `undefined` = no parent change requested.
  if (opts.parentClickUpId !== undefined) {
    body.parent = opts.parentClickUpId; // string | null
  }
  return body;
}
