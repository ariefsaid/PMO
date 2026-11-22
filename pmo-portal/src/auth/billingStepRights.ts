/**
 * Billing-step affordance for a person with NO built-in role key (migration 1771's gate fallback): today's claim-step writers.
 * Co-located with the role rules (ADR-0016) so no screen compares a role to a literal. UX only; the database decides.
 */
export function legacyMayRunBillingSteps(role: string | null): boolean {
  return role === 'Admin' || role === 'Finance' || role === 'Project Manager';
}
