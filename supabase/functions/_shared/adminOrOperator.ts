/**
 * Shared activation-gate predicate for admin-connect surfaces.
 *
 * This answers only "is this actor an Admin or platform Operator?" It deliberately does not
 * authorize member data access; M365 token custody keeps that decision in authorizeMemberEntitled
 * (NFR-M365SEP-001).
 */
export interface AdminOrOperatorClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
}

export interface AuthorizationStateClient {
  rpc(fn: string, params: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

/**
 * Current-standing gate for caller-JWT integration surfaces: the actor must be an ACTIVE member of
 * the org right now, not merely hold a role in a profile row while carrying an unexpired JWT.
 *
 * `actor_authorization_state.active` is the same predicate as `is_active_member()` (0095):
 * profiles.status='active' AND auth.users.banned_until null-or-past, conjoined with membership of
 * the org being asked about. The freshly loaded `profile.status` is asserted alongside it. The two
 * answers come from the same request lifetime, so a deactivated or banned caller stops before any
 * Vault read or external request.
 *
 * FAILS CLOSED: an RPC error or a missing payload denies.
 */
export async function hasActiveStanding(params: {
  stateClient: AuthorizationStateClient;
  orgId: string;
  userId: string;
  profileStatus: unknown;
}): Promise<boolean> {
  const { data, error } = await params.stateClient.rpc('actor_authorization_state', {
    p_org_id: params.orgId,
    p_user_id: params.userId,
  });
  if (error || !data) return false;
  return (data as { active?: unknown }).active === true && params.profileStatus === 'active';
}

export async function isAdminOrOperator(params: {
  profile: unknown;
  operatorClient: AdminOrOperatorClient;
  userId: string;
}): Promise<boolean> {
  const profile = params.profile as { role?: unknown } | null;
  if (profile?.role === 'Admin') return true;

  const { data: operator, error } = await params.operatorClient
    .from('platform_operators')
    .select('user_id')
    .eq('user_id', params.userId)
    .maybeSingle();

  return !error && !!operator;
}
