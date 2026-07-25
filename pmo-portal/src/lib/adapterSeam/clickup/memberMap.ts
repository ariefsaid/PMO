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
  /**
   * Normalised emails deliberately EXCLUDED from the join because they were ambiguous — shared by
   * 2+ PMO profiles and/or 2+ ClickUp members (security audit MEDIUM, round 2). Present only when
   * non-empty; surfaced so an operator can see + fix the duplicate rather than the join silently
   * resolving to "whichever record was processed last".
   */
  skippedEmails?: string[];
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
 * trimmed, Unicode-normalised). A profile or member with no counterpart on the other side is simply
 * left out of the map — never a failure (FR-CUA-013: an unmapped assignee resolves to `unassigned`,
 * it never throws).
 *
 * TRUST BOUNDARY (security audit MEDIUM, round 2): a ClickUp workspace is a DIFFERENT trust domain
 * from the PMO org — whoever administers the ClickUp workspace chooses the emails ClickUp reports for
 * its members, and ClickUp does not attest that those emails are verified. This join therefore treats
 * ClickUp-reported emails as an UNVERIFIED claim of identity, matched only against the org-scoped set
 * of PMO profiles the caller already passed in (callers MUST scope `pmoProfiles` to the caller's
 * `org_id` — see `external-link/index.ts` and `clickup-onboard/index.ts`, both confirmed org-scoped).
 * The join can therefore assign a task to the WRONG PMO user only if that user is already a member of
 * the same org, never across orgs — this is a same-org member-resolution join, not an authentication
 * or authorization decision.
 *
 * Two hardenings (both audit findings, round 2):
 *  - Unicode normalisation (`NFC`) before case-folding, so visually-identical emails using different
 *    Unicode decompositions (e.g. a precomposed accented letter vs. the same letter + a combining
 *    mark) are recognised as the same identity rather than silently failing to match.
 *  - Duplicate-email determinism: if 2+ PMO profiles or 2+ ClickUp members share a normalised email,
 *    that email is AMBIGUOUS — there is no correct answer to "which one did the caller mean?" — so it
 *    is EXCLUDED from the map entirely (never resolved by insertion order, which would silently
 *    assign the wrong user) and reported via `skippedEmails` for an operator to fix the duplicate.
 */
export function buildClickUpMemberMap(
  pmoProfiles: PmoProfileForMemberMap[],
  clickUpMembers: ClickUpMemberForMap[],
): ClickUpMemberMap {
  const normalizeEmail = (email: string): string => email.trim().normalize('NFC').toLowerCase();

  const clickUpIdsByEmail = new Map<string, number[]>();
  for (const member of clickUpMembers) {
    if (!member.email) continue;
    const key = normalizeEmail(member.email);
    const ids = clickUpIdsByEmail.get(key) ?? [];
    ids.push(member.id);
    clickUpIdsByEmail.set(key, ids);
  }

  const pmoIdsByEmail = new Map<string, string[]>();
  for (const profile of pmoProfiles) {
    if (!profile.email) continue;
    const key = normalizeEmail(profile.email);
    const ids = pmoIdsByEmail.get(key) ?? [];
    ids.push(profile.id);
    pmoIdsByEmail.set(key, ids);
  }

  const pmoToClickUp: Record<string, number> = {};
  const clickUpToPmo: Record<number, string> = {};
  const skippedEmails: string[] = [];

  for (const [email, pmoIds] of pmoIdsByEmail) {
    const clickUpIds = clickUpIdsByEmail.get(email);
    if (!clickUpIds) continue; // no ClickUp counterpart — absent from the map, non-fatal

    if (pmoIds.length > 1 || clickUpIds.length > 1) {
      skippedEmails.push(email);
      console.warn(
        `ClickUp member-map: ambiguous email "${email}" ` +
          `(${pmoIds.length} PMO profile(s), ${clickUpIds.length} ClickUp member(s)) — ` +
          'excluded from the join, never resolved by insertion order',
      );
      continue;
    }

    pmoToClickUp[pmoIds[0]] = clickUpIds[0];
    clickUpToPmo[clickUpIds[0]] = pmoIds[0];
  }

  return skippedEmails.length > 0
    ? { pmoToClickUp, clickUpToPmo, skippedEmails }
    : { pmoToClickUp, clickUpToPmo };
}
