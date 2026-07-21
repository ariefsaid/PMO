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
 */
export function clickUpTaskToPmoRecord(raw: ClickUpTask, maps: ClickUpMaps, currentPmoStatus?: string): PmoRecord {
  const assigneeClickUpId = raw.assignees[0]?.id;
  return {
    id: raw.id,
    name: raw.name,
    status: fromClickUpStatus(maps.statusMap, raw.status.status, currentPmoStatus),
    assignee_id: assigneeClickUpId !== undefined ? fromClickUpAssignee(maps.memberMap, assigneeClickUpId) : null,
    start_date: raw.start_date ? msToIso(raw.start_date) : null,
    end_date: raw.due_date ? msToIso(raw.due_date) : null,
    completed_at: raw.date_done ? msToIso(raw.date_done) : null,
  };
}

export interface PmoTaskToClickUpBodyOptions {
  mode: 'create' | 'update';
  /** The ClickUp member ids currently assigned (before this write) — required to compute the
   * update-mode add/rem delta. Absent/empty on create (there is nothing to remove). */
  previousAssigneeIds?: number[];
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
}

/**
 * Canonical PMO record (full record on create; a partial patch on update/transition) -> the ClickUp
 * v2 request body. Branches on `opts.mode` because ClickUp v2's assignee shape differs by verb
 * (FR-CUA-010, the B2 warning): **create** takes `assignees:[ids]`; **update** takes
 * `assignees:{add:[],rem:[]}`. Only fields PRESENT in `record` are emitted — never the full field set
 * on a partial update.
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

  if (opts.mode === 'create') {
    return {
      ...scalarFields,
      assignees: (() => {
        const id = resolveAssigneeId(maps.memberMap, record.assignee_id);
        return id !== null ? [id] : [];
      })(),
    };
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
  return body;
}
