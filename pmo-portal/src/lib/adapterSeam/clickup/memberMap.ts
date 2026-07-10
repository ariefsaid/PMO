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

/**
 * A resolved (or unresolvable) ClickUp assignee. A single flat shape (not a discriminated union) —
 * this repo's `tsconfig.json` runs with `strictNullChecks` off, under which TypeScript's control-flow
 * narrowing of boolean-discriminated unions is unreliable; callers read `.unassigned`/`.id` directly
 * instead of narrowing.
 */
export interface ClickUpAssigneeResolution {
  unassigned: boolean;
  /** The ClickUp member id when resolved; `null` when unmapped. */
  id: number | null;
  /** Present only when unmapped — a human-readable reason (never thrown). */
  surfaced?: string;
}

/** Outbound: PMO assignee id -> ClickUp member id. Never throws — unmapped resolves to `unassigned`. */
export function toClickUpAssignee(map: ClickUpMemberMap, pmoAssigneeId: string): ClickUpAssigneeResolution {
  const id = map.pmoToClickUp[pmoAssigneeId];
  if (id === undefined) {
    return {
      unassigned: true,
      id: null,
      surfaced: `no ClickUp member mapped for PMO assignee "${pmoAssigneeId}"`,
    };
  }
  return { unassigned: false, id };
}

/** Inbound: ClickUp member id -> PMO assignee id, or `null` when unmapped. */
export function fromClickUpAssignee(map: ClickUpMemberMap, clickUpMemberId: number): string | null {
  return map.clickUpToPmo[clickUpMemberId] ?? null;
}
