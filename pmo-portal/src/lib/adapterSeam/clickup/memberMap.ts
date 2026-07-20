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

// ──────────────────────────────────────────────────────────────────────────────
// Shared per-project member-map builder (OD-INT-10 §4). Pure email join — the ONE place both
// `external-link` and `clickup-onboard` build a `ClickUpMemberMap`, so neither can drift into
// bespoke (or empty) logic again. Both sides expose email; unmatched members on EITHER side are
// simply absent from the map (routine, never an error — see toClickUpAssignee above).
// ──────────────────────────────────────────────────────────────────────────────

/** A PMO profile with the fields this join needs. */
export interface PmoProfileForMemberMap {
  id: string;
  email: string;
}

/** A ClickUp List/Team member with the fields this join needs (`GET /list/{id}/member` -> `members[]`). */
export interface ClickUpMemberForMap {
  id: number;
  email: string;
}

/**
 * Build a `ClickUpMemberMap` by joining PMO profiles to ClickUp members on email (case-insensitive,
 * trimmed). A profile or member with no counterpart on the other side is simply left out of the
 * map — never a failure (FR-CUA-013: an unmapped assignee resolves to `unassigned`, it never throws).
 */
export function buildClickUpMemberMap(
  pmoProfiles: PmoProfileForMemberMap[],
  clickUpMembers: ClickUpMemberForMap[],
): ClickUpMemberMap {
  const normalizeEmail = (email: string): string => email.trim().toLowerCase();

  const clickUpIdByEmail = new Map<string, number>();
  for (const member of clickUpMembers) {
    if (!member.email) continue;
    clickUpIdByEmail.set(normalizeEmail(member.email), member.id);
  }

  const pmoToClickUp: Record<string, number> = {};
  const clickUpToPmo: Record<number, string> = {};
  for (const profile of pmoProfiles) {
    if (!profile.email) continue;
    const clickUpId = clickUpIdByEmail.get(normalizeEmail(profile.email));
    if (clickUpId === undefined) continue; // no ClickUp counterpart — absent from the map, non-fatal
    pmoToClickUp[profile.id] = clickUpId;
    clickUpToPmo[clickUpId] = profile.id;
  }

  return { pmoToClickUp, clickUpToPmo };
}
