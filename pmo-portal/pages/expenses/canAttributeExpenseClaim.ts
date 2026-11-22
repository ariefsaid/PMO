/** Who may correct a claim's work order (set_cost_attribution, 1261): finance-capable roles any time, the claimant while it is theirs to edit. */
export function canAttributeExpenseClaim(role: string | null | undefined, userId: string | null | undefined, claim: { claimant_id: string; status: string }): boolean {
  if (role && ['Admin', 'Executive', 'Finance', 'Project Manager'].includes(role)) return true;
  return Boolean(userId) && claim.claimant_id === userId && ['Draft', 'Rejected'].includes(claim.status);
}

