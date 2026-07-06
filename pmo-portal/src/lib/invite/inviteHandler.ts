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
  | 'BAD_EMAIL';

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
  if (!EMAIL_RE.test(email)) throw new InviteError('BAD_EMAIL', 400);
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

  return { targetOrgId, role: input.role as InviteRole };
}
