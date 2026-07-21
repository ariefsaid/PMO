/**
 * erpnext/budgetPushKey.ts (P3c, FR-BUD-141 / AC-BUD-021, ADR-0059 §4) — the budget push's
 * DETERMINISTIC idempotency key.
 *
 * The budget push has TWO independent originators with NO shared client state: the activation
 * consequence (a user activating a version) and the reconciling sweep backstop. A freshly-minted random
 * key per attempt would make the outbox's `unique (org_id, domain, pmo_record_id, idempotency_key)`
 * (mig 0096) useless for exactly the collision it exists to prevent — and a duplicate here is not a
 * duplicate row but a SECOND ERP `Budget` object, i.e. the client's GL controls enforcing a figure
 * nobody approved. The key is therefore DERIVED from DB truth so both originators land on the same
 * string and the second fails atomically (23505) and reconciles to the winner's result.
 *
 * Shape: `bud:<budget_version_id>:<activated_at epoch ms>` — accepted by the served boundary's
 * opaque-key guard (`adapter-dispatch/transitionTargetGuard.ts`, the P3b `<prefix>:<uuid>:<stamp>` form).
 *
 * ⚑ Why `activated_at` and not the version id alone (spec OQ-BUD-2). `activate_budget_version` (mig 0005)
 * does not check the current status, so an Archived version CAN be re-activated (rolling back v3 → v2).
 * Keyed on the version id alone, that re-activation collides with v2's ORIGINAL push and is SILENTLY
 * SUPPRESSED — leaving ERPNext enforcing v3's figures while PMO says v2. The `activated_at` witness
 * (mig 0139) makes each activation a distinct command. A content digest has the same hole: v2's content
 * is unchanged, so its digest is unchanged.
 *
 * ⚑ Why EPOCH MS and not the raw stamp. The two originators read the same column through different
 * transports, which render one instant differently: PostgREST gives the browser
 * `2026-07-16T10:00:00+00:00`, a server-side/SQL read gives `2026-07-16 10:00:00+00`, and an offset zone
 * gives `2026-07-16T17:00:00+07:00`. Keying on the text would make two spellings of ONE activation two
 * keys — the duplicate the constraint exists to stop. The epoch is transport-independent.
 * (Millisecond granularity: Postgres stores microseconds, so two activations of the SAME version inside
 * one millisecond would share a key. That is not physically reachable — each activation is a separate
 * user act behind its own RPC round-trip — and every sub-millisecond case is a legitimate retry.)
 */
import { AdapterError } from '../contract.ts';

/** The `budget` domain's key prefix (ADR-0059 §4; `ts:` is P3b's timesheet sibling). */
export const BUDGET_PUSH_KEY_PREFIX = 'bud';

/**
 * A Postgres `timestamptz` as any transport renders it: `YYYY-MM-DD`, then `T` or a space, then the
 * time (optionally fractional), then an optional `Z` / `±hh` / `±hhmm` / `±hh:mm` offset. Parsed
 * explicitly rather than handed straight to `Date.parse`, whose behaviour on the non-ISO space-separated
 * and bare-`±hh` forms is implementation-defined — the one thing this key must never be.
 */
const TIMESTAMPTZ_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

function activationEpochMs(activatedAt: string): number {
  const match = TIMESTAMPTZ_RE.exec(activatedAt.trim());
  if (!match) return Number.NaN;
  const [, date, time, zone] = match;
  // No offset ⇒ UTC. Both originators apply the identical rule, so the key stays stable either way.
  let normalizedZone = zone ?? 'Z';
  if (normalizedZone.length === 3) normalizedZone = `${normalizedZone}:00`; // '+07' → '+07:00'
  else if (normalizedZone.length === 5) normalizedZone = `${normalizedZone.slice(0, 3)}:${normalizedZone.slice(3)}`; // '+0700'
  return Date.parse(`${date}T${time}${normalizedZone}`);
}

/**
 * Derive the budget push's idempotency key from DB truth.
 *
 * ⚑ Fails closed (never returns a degenerate key). An absent stamp means the version was never
 * activated, and `bud:<id>:null` would be the SAME key for every future activation of that version, so
 * only the first would ever reach ERP — a silently-wrong budget, the exact failure the stamp exists to
 * prevent. `commit-rejected` is the non-retryable bucket: no amount of retrying supplies a stamp.
 */
export function budgetPushKey(budgetVersionId: string, activatedAt: string | null | undefined): string {
  if (!activatedAt) {
    throw new AdapterError('commit-rejected', 'budget push: the version carries no activation stamp');
  }
  const epochMs = activationEpochMs(activatedAt);
  if (!Number.isFinite(epochMs)) {
    throw new AdapterError('commit-rejected', `budget push: unparseable activation stamp "${activatedAt}"`);
  }
  return `${BUDGET_PUSH_KEY_PREFIX}:${budgetVersionId}:${epochMs}`;
}
