export interface RevenuePreflightInput { caller: string; customer?: string; project?: string; salesInvoice?: string }
export type RevenuePreflightResult = { outcome: 'accepted'; erpCalls: 0 } | { outcome: 'refused'; code: 'cross-org-link-rejected'; erpCalls: 0 };

/** FR-OCI-004: a revenue command may only point at records its own tenant owns; an absent record is not owned by anyone. */
export function revenuePreflight(input: RevenuePreflightInput): RevenuePreflightResult {
  if ([input.customer, input.project, input.salesInvoice].some((owner) => owner !== undefined && owner !== input.caller)) return { outcome: 'refused', code: 'cross-org-link-rejected', erpCalls: 0 };
  return { outcome: 'accepted', erpCalls: 0 };
}
