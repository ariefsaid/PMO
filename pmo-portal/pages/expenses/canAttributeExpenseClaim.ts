import { can, type Role } from '@/src/auth/policy';

/** Who may correct a claim's work order (set_cost_attribution, 1261): finance-capable roles any time, the claimant while it is theirs to edit. */
export function canAttributeExpenseClaim(role: string | null | undefined, userId: string | null | undefined, claim: { claimant_id: string; status: string }): boolean {
  return can('attribute', 'expenseClaim', {
    realRole: (role as Role) ?? null,
    currentUserId: userId,
    record: claim,
  });
}

