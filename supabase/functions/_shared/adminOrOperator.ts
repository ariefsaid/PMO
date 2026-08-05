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
