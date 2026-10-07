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

import type { FakeCall, Invoker } from './fakeSupabase';

export const WO = { id: '33333333-3333-4333-8333-333333333333', wo_number: 'WO-20261001-001', title: 'Phase 2 survey', project_id: P1, status: 'Issued', order_value: 1_110_000, tax_amount: 110_000, tax_treatment: 'inclusive', currency: 'IDR', client_po_number: 'PO-778' };
export const PROJECT = { id: P1, name: 'Harbor Tower', client_id: C1, currency: 'IDR' };

type Over = Partial<Record<string, (c: FakeCall) => unknown>>;
/** A Finance-ready org: Revenue on, ERPNext-owned revenue, one Issued WO, a project with a linked client. */
export function world(o: Over = {}) {
  return (c: FakeCall) => {
    const hit = o[c.table];
    if (hit) return { data: hit(c), error: null };
    switch (c.table) {
      case 'org_features': return { data: { enabled: true }, error: null };
      case 'external_domain_ownership': return { data: [{ external_tier: 'erpnext' }], error: null };
      case 'work_orders': return { data: [WO], error: null };
      // The work_order_billing view's row for WO: nothing billed yet, so all of its 1,000,000 net is still to invoice.
      case 'work_order_billing': return { data: { remaining: 1_000_000, figures_complete: true }, error: null };
      case 'project_milestones': return { data: [{ id: 'm-1', name: 'Design', project_id: P1, sort_order: 1 }, { id: 'm-2', name: 'Foundation', project_id: P1, sort_order: 2 }], error: null };
      case 'projects': return { data: c.terminal === 'maybeSingle' ? PROJECT : [PROJECT], error: null };
      case 'companies': return { data: { name: 'PT Client' }, error: null };
      case 'external_refs': return { data: [{ external_record_id: 'Customer:PT Client' }], error: null };
      case 'organizations': return { data: { default_locale: 'en-US', default_number_locale: 'en-US', default_currency: 'IDR' }, error: null };
      default: return { data: null, error: null };
    }
  };
}
export const oneItem: Invoker = async (name) =>
  name === 'external-items' ? { data: { items: [{ code: 'SVC', name: 'Services' }] }, error: null } : { data: null, error: { message: 'unexpected' } };
export const ctx = (role: string, client: unknown) => ({ jwt: '', userId: 'u-fin', orgId: 'org-1', role, supabase: client as never });
let seq = 0;
export const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
