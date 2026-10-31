/** #1471: how an invoice's project attribution counts. `contract` draws down the contract value; `other` counts toward revenue and margin only. */
export const BILLING_KINDS = ['contract', 'other'] as const;
export type BillingKind = (typeof BILLING_KINDS)[number];
export const DEFAULT_BILLING_KIND: BillingKind = 'contract';
export function isBillingKind(value: unknown): value is BillingKind {
  return value === 'contract' || value === 'other';
}
