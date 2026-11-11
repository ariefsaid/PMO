import type { TrackedEvent } from './events';

// Business events (#1532 S5): module + role only. No amounts, ids or names (FR-PHO-040).
export const buildBudgetActivatedEvent = (role: string): TrackedEvent => ({
  event: 'budget_activated',
  properties: { module: 'budget', role },
});
export const buildInvoiceIssuedEvent = (role: string): TrackedEvent => ({
  event: 'invoice_issued',
  properties: { module: 'revenue', role },
});
export const buildPaymentRecordedEvent = (role: string): TrackedEvent => ({
  event: 'payment_recorded',
  properties: { module: 'revenue', role },
});
export const buildPurchaseApprovedEvent = (role: string): TrackedEvent => ({
  event: 'purchase_approved',
  properties: { module: 'procurement', role },
});
