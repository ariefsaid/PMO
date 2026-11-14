/**
 * authorizeInvite — pure, Deno+vitest-importable logic for the admin-invite-user edge fn
 * (S3, FR-INV-004/005). No @supabase/supabase-js import (mirrors the agent-dispatch precedent:
 * edge fns import pure logic from pmo-portal/src/... and that logic is vitest-tested with an
 * injected SupabaseLike). Issuance-only — the invite-ACCEPT flow (email body/SMTP/redirect) is
 * the separate `auth-production-floor` spec.
 *
 * Authority: an org-Admin (own org, pinned — a client-supplied p_org_id is ignored for a
 * non-Operator caller) OR a platform Operator (`is_operator()`, may target any existing org via
 * p_org_id). The service-role key is NEVER exercised for an unauthorized caller — this function
 * rejects before any service-role call is made by the caller (the edge-fn wrapper, S3-B).
 */

export const INVITE_ROLES = ['Engineer', 'Project Manager', 'Finance', 'Executive', 'Admin'] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

export interface InviteSupabaseLike {
  rpc<T = unknown>(
    fn: string,
    args?: Record<string, unknown>,
  ): Promise<{ data: T | null; error: { code?: string; message: string } | null }>;
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: unknown,
      ): {
        single(): Promise<{ data: unknown | null; error: { code?: string; message: string } | null }>;
      };
    };
  };
}

export interface InviteInput {
  email: string;
  role: string;
  p_org_id?: string | null;
}

export type InviteErrorCode =
  | 'INVITE_UNAUTHORIZED'
  | 'DUPLICATE_EMAIL'
  | 'INVALID_ROLE'
  | 'UNKNOWN_ORG'
  | 'BAD_EMAIL'
  | 'SEAT_LIMIT_REACHED';

export class InviteError extends Error {
  constructor(
    public code: InviteErrorCode,
    public status: number,
  ) {
    super(code);
  }
}

interface CallerProfile {
  org_id: string;
  role: string;
  email: string;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Resolve + authorize an invite request. Returns `{ targetOrgId, role }` on success; throws an
 * `InviteError` (with an HTTP status the edge-fn wrapper maps directly) otherwise. org_id is
 * NEVER client-decided for an org-Admin caller (pinned to their own org); an Operator's
 * `p_org_id` is server-validated to exist (`operator_org_exists`) before being trusted.
 */
export async function authorizeInvite(
  db: InviteSupabaseLike,
  callerUid: string,
  input: InviteInput,
): Promise<{ targetOrgId: string; role: InviteRole }> {
  const email = (input.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.includes('*')) throw new InviteError('BAD_EMAIL', 400);
  if (!INVITE_ROLES.includes(input.role as InviteRole)) throw new InviteError('INVALID_ROLE', 400);

  // Operator? (platform grant — checked before the caller's own profile role.)
  const { data: isOp } = await db.rpc<boolean>('is_operator');
  const operator = isOp === true;

  // Caller profile (RLS-scoped to the caller under their own JWT in the real client).
  const { data: profileData, error: profileError } = await db
    .from('profiles')
    .select('org_id,role,email')
    .eq('id', callerUid)
    .single();
  const profile = (profileData ?? null) as CallerProfile | null;
  if (profileError || !profile) throw new InviteError('INVITE_UNAUTHORIZED', 401);

  const adminInOwnOrg = profile.role === 'Admin';
  if (!operator && !adminInOwnOrg) throw new InviteError('INVITE_UNAUTHORIZED', 403);

  // Target org: an Operator may pick p_org_id (server-validated to exist); an org-Admin is
  // ALWAYS pinned to their own org — a client-supplied p_org_id is ignored for a non-Operator
  // caller (never client-decided).
  let targetOrgId: string;
  if (operator && input.p_org_id) {
    const { data: exists } = await db.rpc<boolean>('operator_org_exists', { p_org_id: input.p_org_id });
    if (exists !== true) throw new InviteError('UNKNOWN_ORG', 400);
    targetOrgId = input.p_org_id;
  } else {
    targetOrgId = profile.org_id;
  }

  // Duplicate-in-target-org check (FR-INV-005): scoped to the target org only (no cross-org
  // leak to an org-Admin; an Operator's cross-org probe is a conscious, accepted tradeoff).
  const { data: dup } = await db.rpc<boolean>('org_has_member_email', {
    p_org_id: targetOrgId,
    p_email: email,
  });
  if (dup === true) throw new InviteError('DUPLICATE_EMAIL', 409);

  // Seat limit (FR-PLN-010, AC-PLN-009): `assert_seat_available` (migration 0535) counts the org's
  // active profiles — a pending invite IS one of those rows — under the organisation row lock, and
  // refuses with the typed `PL001` / `seat_limit_reached`. It runs LAST so a duplicate email or an
  // invalid role still gets its own, more actionable message.
  //
  // ⚑ FAIL OPEN on any OTHER rpc failure (network, a transient 5xx). This call is the
  // refuse-before-email courtesy; the ENFORCEMENT is the profiles seat trigger in 0535, which refuses
  // the profile write at issuance. The pending account is kept and adopted by the next successful
  // invite. Making this pre-check fail closed would turn a transient plan-registry hiccup into "nobody can invite".
  const seat = await db.rpc<void>('assert_seat_available', { p_org_id: targetOrgId });
  if (seat.error && isSeatLimitReached(seat.error)) {
    throw new InviteError('SEAT_LIMIT_REACHED', 409);
  }

  return { targetOrgId, role: input.role as InviteRole };
}

/**
 * The typed seat refusal. `PL001` is the SQLSTATE (0535); the message marker is accepted too because
 * the client library surfaces `raise exception` text on `.message`, and a PostgREST error can arrive
 * with the code nested/hidden depending on the transport.
 */
export function isSeatLimitReached(error: { code?: string; message?: string }): boolean {
  return error.code === 'PL001' || /seat_limit_reached/.test(error.message ?? '');
}
