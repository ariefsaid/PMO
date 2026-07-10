/**
 * Per-project ClickUp member map (FR-CUA-013). Confined to clickup/**. Unlike the status map, an
 * unmapped assignee is a routine, non-fatal state (never throws) — a task may simply have no ClickUp
 * counterpart for its PMO assignee yet.
 */

export interface ClickUpMemberMap {
  /** PMO profile id -> ClickUp member id. */
  pmoToClickUp: Record<string, number>;
  /** ClickUp member id -> PMO profile id. */
  clickUpToPmo: Record<number, string>;
}

/** An unmapped PMO assignee (no ClickUp counterpart configured) — surfaced, never thrown. */
export interface ClickUpAssigneeUnassigned {
  unassigned: true;
  surfaced: string;
}

/** A PMO assignee successfully resolved to its ClickUp member id. */
export interface ClickUpAssigneeMapped {
  unassigned: false;
  id: number;
}

export type ClickUpAssigneeResolution = ClickUpAssigneeUnassigned | ClickUpAssigneeMapped;

/** Outbound: PMO assignee id -> ClickUp member id. Never throws — unmapped resolves to `unassigned`. */
export function toClickUpAssignee(map: ClickUpMemberMap, pmoAssigneeId: string): ClickUpAssigneeResolution {
  const id = map.pmoToClickUp[pmoAssigneeId];
  if (id === undefined) {
    return { unassigned: true, surfaced: `no ClickUp member mapped for PMO assignee "${pmoAssigneeId}"` };
  }
  return { unassigned: false, id };
}

/** Inbound: ClickUp member id -> PMO assignee id, or `null` when unmapped. */
export function fromClickUpAssignee(map: ClickUpMemberMap, clickUpMemberId: number): string | null {
  return map.clickUpToPmo[clickUpMemberId] ?? null;
}
