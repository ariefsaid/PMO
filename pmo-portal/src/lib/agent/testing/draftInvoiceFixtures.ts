/** Shared #787 draft-invoice fixtures. Test files import THIS, never each other (importing a test file re-runs its suites). */
import type { DraftInvoicePrepared } from '../../../../../supabase/functions/agent-chat/draftInvoice';

export const P1 = '11111111-1111-4111-8111-111111111111';
export const C1 = '22222222-2222-4222-8222-222222222222';

export const PREPARED: DraftInvoicePrepared = {
  kind: 'prepared-draft-invoice',
  commandId: '00000000-0000-4000-8000-000000000001',
  idempotencyKey: '00000000-0000-4000-8000-000000000002',
  customerId: C1,
  projectId: P1,
  items: [{ item_code: 'SVC', qty: 1, rate: 1_000_000, description: 'WO-20261001-001 — Phase 2 survey' }],
  reference_number: 'PO-778',
  display: { customerName: 'PT Client', projectName: 'Harbor Tower', sourceLabel: 'WO-20261001-001', amountText: 'IDR 1,000,000.00' },
};
