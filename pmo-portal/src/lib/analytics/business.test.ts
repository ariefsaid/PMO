import { describe, it, expect, vi } from 'vitest';
vi.mock('./client', () => ({ analyticsClient: { capture: vi.fn() } }));
import { analyticsClient } from './client';
import { trackBudgetActivated, trackInvoiceIssued, trackPaymentRecorded, trackPurchaseApproved } from './business';

describe('AC-PHO-040 business events carry only module and role', () => {
  it.each([
    [trackBudgetActivated, 'budget_activated', 'budget'],
    [trackInvoiceIssued, 'invoice_issued', 'revenue'],
    [trackPaymentRecorded, 'payment_recorded', 'revenue'],
    [trackPurchaseApproved, 'purchase_approved', 'procurement'],
  ] as const)('%s', (fn, event, module) => {
    fn('Finance');
    expect(analyticsClient.capture).toHaveBeenLastCalledWith(event, { module, role: 'Finance' });
  });
});
