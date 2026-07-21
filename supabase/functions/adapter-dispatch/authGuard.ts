// Luna money audit — BLOCK 4: server-side authorization gate for erpnext-tier commands.
// Extracted as a pure/testable module so the dispatch-path enforcement is unit-provable.
// The adapter-dispatch edge function MUST invoke this BEFORE any adapter/outbox/ERP write,
// and the erpnext-sweep's RECOVERY pass MUST invoke `checkOutboxReplayAuthorization` (B6) before
// replaying a frozen outbox command — ONE rule, two entry points.
//
// Checks (in order):
// (a) caller's org owns the command's domain ON THE ERPNEXT TIER →
//     public.domain_owned_by_tier(orgId, domain, 'erpnext') (mig 0117; B9)
// (b) the actor is an ACTIVE member of that org and their CURRENT role is permitted for a money write
//     IN THAT DOMAIN → public.actor_authorization_state(orgId, userId) + moneyWriteRolesForDomain(domain)
// (c) command.domain matches KIND_DOMAIN[erp_doc_kind] → rejects cross-domain kinds (e.g. domain:'procurement' with erp_doc_kind:'incoming-payment')
import { KIND_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/feedKinds.ts';
import { ERPNEXT_TIER } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The role set permitted for a money write, PER PMO DOMAIN — the rulings differ by domain, and this
 * guard is the enforcement authority for the dispatch surface (a direct POST skips the whole FE).
 *
 * - `procurement` / `companies`: the master-data write roles (Admin·Exec·PM·Finance) — unchanged.
 * - `revenue`: Admin + Finance ONLY (owner ruling 2026-07-20; mirrors `REVENUE_WRITE` in
 *   `pmo-portal/src/auth/policy.ts`). Round-6 re-audit finding 3: one shared 4-role constant let a PM
 *   POST a sales-invoice `cancel` straight to this function — no revenue affordance in the UI, no SoD
 *   gate on `cancel` — and reverse a submitted invoice's AR. The FE may be STRICTER than the backend;
 *   the backend must never be the permissive side of a ruling.
 *
 * An unlisted domain resolves to the EMPTY set (fail closed): a newly-added erpnext domain must
 * declare its own write roles here before any role can write it.
 */
const MASTER_DATA_WRITE_ROLES = ['Admin', 'Executive', 'Project Manager', 'Finance'] as const;
const REVENUE_WRITE_ROLES = ['Admin', 'Finance'] as const;

const MONEY_WRITE_ROLES_BY_DOMAIN: Record<string, readonly string[]> = {
  companies: MASTER_DATA_WRITE_ROLES,
  procurement: MASTER_DATA_WRITE_ROLES,
  revenue: REVENUE_WRITE_ROLES,
  // P3c `budget` (ADR-0059 Posture B): OD-BUDGET-3 — the SAME role set `activate_budget_version`
  // (mig 0005) requires. The push is the CONSEQUENCE of that PMO act, so its authority must be neither
  // wider (a role that could not activate must not be able to push) nor narrower (a legitimate
  // activation would strand as a permanently failed push).
  budget: MASTER_DATA_WRITE_ROLES,
};

/** The roles permitted to issue a money write in `domain` (empty ⇒ nobody: fail closed). */
export function moneyWriteRolesForDomain(domain: string): readonly string[] {
  return MONEY_WRITE_ROLES_BY_DOMAIN[domain] ?? [];
}

/**
 * P3b (FR-TSP-011) — the domains whose ACTOR rule is enforced by a DB gate instead of by a role list.
 *
 * `timesheets` is the first: a legitimate pusher is the sheet's approver, who is very often an
 * **Engineer-role LINE MANAGER** (`profiles.manager_id`; `0007` A2/A4) — reusing the money-write set
 * would refuse the PRIMARY approval path. The real rule ("`approved_by` OR a privileged role, on an
 * **Approved** sheet, in the caller's own org") is enforced by `approved_timesheet_for_push`
 * (migration 0138) under the caller's own JWT, i.e. in the DB against DB truth, by `approvalGuard.ts`
 * — which the dispatch runs on exactly the same commands, before any outbox/ERP work.
 *
 * This is a DELEGATION, never a waiver, and never the default: check (a) domain-ownership-on-tier and
 * the ACTIVE-membership half of check (b) still run for these domains, and an unlisted domain still
 * resolves to the empty (fail-closed) role set.
 */
const ROLE_RULE_DELEGATED_TO_DB_GATE = new Set(['timesheets']);

/** Structural client for the two authorization RPCs (`domain_owned_by_tier`,
 *  `actor_authorization_state` — mig 0117). Satisfied by the deputy (caller-JWT) client on the
 *  synchronous path and by the service client on the sweep's recovery path. */
export interface AuthorizationClient {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
}

export interface AuthorizationResult {
  ok: boolean;
  status: number;
  message: string;
}

/**
 * Enforce the three authorization gates for any erpnext-tier command.
 * Returns {ok:true, status:200} when all pass; otherwise {ok:false, status, message}.
 * Does NOT throw — the caller maps the result to an HTTP response.
 */
export async function checkErpnextCommandAuthorization(
  client: AuthorizationClient,
  orgId: string,
  userId: string,
  command: { domain: string; operation: string; record: { erp_doc_kind?: unknown; id: string } },
): Promise<AuthorizationResult> {
  // (a) Domain ownership: the org must have this domain assigned to the ERPNEXT tier SPECIFICALLY.
  // Round-7 B9: `domain_externally_owned(org, domain)` (0087) ignores `external_tier`, so an org that
  // had moved `revenue` to another external system while keeping an ERPNext binding still passed here
  // — this surface would accept + post money for a domain ERPNext no longer owns. The sweep already
  // scopes its ownership read by tier; this is the one place the tier was dropped.
  const domainOwned = await client.rpc('domain_owned_by_tier', {
    p_org_id: orgId,
    p_domain: command.domain,
    p_tier: ERPNEXT_TIER,
  });
  if (domainOwned.error || domainOwned.data !== true) {
    return { ok: false, status: 403, message: `org ${orgId} does not own domain "${command.domain}" on the "${ERPNEXT_TIER}" tier` };
  }

  // (b) Actor authorization: the actor must be an ACTIVE member of this org, and their CURRENT role
  // must be one of THIS DOMAIN's money-write roles. `actor_authorization_state` (0117) is SECURITY
  // DEFINER — profiles.role + profiles.status + auth.users.banned_until (the `is_active_member()`
  // predicate, which a service-role client cannot evaluate through RLS) in one round trip, so the
  // recovery path can re-assert the identical rule for the outbox row's recorded actor.
  const { data: actorState, error: actorError } = await client.rpc('actor_authorization_state', {
    p_org_id: orgId,
    p_user_id: userId,
  });

  if (actorError || !actorState) {
    return { ok: false, status: 403, message: 'caller role not resolvable' };
  }

  const { role, active } = actorState as { role: string | null; active: boolean };
  if (!active) {
    return { ok: false, status: 403, message: `actor ${userId} is not an active member of org ${orgId}` };
  }
  // P3b: a DB-gated domain skips the ROLE half only (the active-member check above still applied) —
  // its actor rule is re-asserted from DB truth by that domain's own gate before any ERP work.
  if (!ROLE_RULE_DELEGATED_TO_DB_GATE.has(command.domain) && (!role || !moneyWriteRolesForDomain(command.domain).includes(role))) {
    return { ok: false, status: 403, message: `role "${role ?? 'null'}" not authorized for a "${command.domain}" money write` };
  }

  // (c) Domain-kind consistency: the command's domain must match the kind's canonical domain.
  const kind = command.record.erp_doc_kind;
  if (typeof kind !== 'string' || !(kind in KIND_DOMAIN)) {
    return { ok: false, status: 422, message: `missing or unknown erp_doc_kind on record: ${String(kind)}` };
  }
  const expectedDomain = KIND_DOMAIN[kind as keyof typeof KIND_DOMAIN];
  if (command.domain !== expectedDomain) {
    return {
      ok: false,
      status: 422,
      message: `command domain "${command.domain}" does not match erp_doc_kind "${kind}" domain "${expectedDomain}"`,
    };
  }

  return { ok: true, status: 200, message: '' };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Round-7 cross-family audit, B6 — RE-ASSERT authorization at recovery time.
//
// The sweep's recovery pass reconstructs the command from the FROZEN outbox payload and calls
// `dispatchMoneyWrite` directly, so a replay re-runs NONE of the dispatch gates. 0112 bounded WHICH
// rows may replay (attempt budget + max age + terminal transition rejections) and the sweep gained a
// domain-ownership snapshot check, but the ORIGINAL ACTOR's current standing was never re-evaluated:
// a user could issue a money command, be demoted / deactivated / have their org's domain ownership
// revoked, and still have the cron post it up to 24 hours later.
//
// This entry point re-runs `checkErpnextCommandAuthorization` — the SAME implementation the
// synchronous path runs — against the outbox row's recorded `actor_user_id` (0108 §C) and the
// CURRENT ownership/role/active state. The rule is not forked; only the actor's source differs
// (verified request JWT vs the persisted verified actor).
//
// ⚑ A refusal never DROPS a money row. The caller (`reconcileOrgOutbox`) records it as a per-candidate
// error and leaves the row byte-for-byte as it is — org-member-SELECT-able with its `last_error`, and
// surfaced in the sweep response as `reconcile:<id>:<message>` — exactly like the existing
// `domain-not-owned` hold. Re-granting the role/domain resumes it on the next tick.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The outbox row a recovery pass wants to replay (the sweep's camelCase projection + the columns it
 *  re-reads for the command reconstruction: `operation`, `payload`, `actor_user_id`). */
export interface OutboxReplayCandidate {
  id: string;
  state: string;
  domain: string;
  operation: string;
  pmoRecordId: string;
  /** The verified dispatching user persisted at insert (0108 §C). `null` for pre-0108 / machine rows. */
  actorUserId: string | null;
  /** The frozen command payload (carries `erp_doc_kind`). */
  payload: Record<string, unknown> | null;
}

/**
 * Does replaying a row in this state possibly issue a NEW ERP write?
 *
 * `pending` (never claimed ⇒ no ERP document) and `failed` (a rejected attempt) are the two states
 * whose replay can MINT money — they are the ones that must satisfy CURRENT authorization.
 *
 * `committed` (finalize-only: ref → mirror → confirm) and the F1 safety transitions
 * (`committing`-past-lease → quarantine, `quarantined`-past-window → adopt-or-hold) issue no new ERP
 * write: the ERP document already exists or is being made visible. Gating those on the actor's current
 * standing would strand a REAL posted money document unmirrored forever — strictly worse than the risk
 * being closed. Same taxonomy as `outbox_reconcile_candidates` (0112).
 */
export function replayMayIssueErpWrite(state: string): boolean {
  return state === 'pending' || state === 'failed';
}

/**
 * Re-assert authorization for an automatic (sweep) replay of a frozen outbox command.
 * `{ok:true}` ⇒ the replay may proceed; `{ok:false}` ⇒ HOLD the row for an operator (never drop it).
 */
export async function checkOutboxReplayAuthorization(
  client: AuthorizationClient,
  orgId: string,
  candidate: OutboxReplayCandidate,
): Promise<AuthorizationResult> {
  if (!replayMayIssueErpWrite(candidate.state)) return { ok: true, status: 200, message: '' };

  if (!candidate.actorUserId) {
    return {
      ok: false,
      status: 403,
      message: `outbox row ${candidate.id} has no recorded actor — an unattributable money command is held for an operator, not replayed`,
    };
  }

  const payload = candidate.payload ?? {};
  const result = await checkErpnextCommandAuthorization(client, orgId, candidate.actorUserId, {
    domain: candidate.domain,
    operation: candidate.operation,
    record: { id: candidate.pmoRecordId, erp_doc_kind: payload.erp_doc_kind },
  });
  if (result.ok) return result;
  return {
    ...result,
    message: `outbox row ${candidate.id} not replayed — recovery re-authorization failed: ${result.message}`,
  };
}