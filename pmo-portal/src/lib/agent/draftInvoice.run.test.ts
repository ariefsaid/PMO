import { afterEach, describe, expect, it, vi } from 'vitest';
import { DRAFT_INVOICE_DISPATCH_TIMEOUT_MS, draftInvoiceAction, runDraftInvoice } from '../../../../supabase/functions/agent-chat/draftInvoice';
import { PREPARED } from './testing/draftInvoiceFixtures';
import { fakeSupabase, type Invoker } from './testing/fakeSupabase';

const ctx = (invoke: Invoker) => ({ jwt: '', userId: 'u-fin', orgId: 'org-1', role: 'Finance', supabase: fakeSupabase(() => ({ data: null, error: null }), invoke).client as never });
afterEach(() => vi.useRealTimers());

describe('runDraftInvoice (#787)', () => {
  it('NFR-AIN-SEC-003 sends exactly one revenue CREATE with the proposal identity — never a transition', async () => {
    const invoke = vi.fn<Invoker>(async () => ({ data: { canonical: { id: PREPARED.commandId, si_number: 'ACC-SINV-2026-00099' } }, error: null }));
    const out = await runDraftInvoice(PREPARED, ctx(invoke));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('adapter-dispatch', { body: {
      domain: 'revenue', operation: 'create', idempotencyKey: PREPARED.idempotencyKey,
      record: { customerId: PREPARED.customerId, projectId: PREPARED.projectId, items: PREPARED.items, reference_number: 'PO-778', erp_doc_kind: 'sales-invoice', id: PREPARED.commandId },
    } });
    expect(JSON.stringify(invoke.mock.calls[0][1])).not.toMatch(/submit|transition|verb/);
    expect(out).toMatchObject({ ok: true, status: 'Draft', siNumber: 'ACC-SINV-2026-00099', link: '/sales-invoices?q=ACC-SINV-2026-00099' });
  });
  it('AC-BWO-005 the approved draft dispatches the work order with the create', async () => {
    const invoke = vi.fn<Invoker>(async () => ({ data: { canonical: { id: PREPARED.commandId, si_number: 'ACC-SINV-2026-00100' } }, error: null }));
    await runDraftInvoice({ ...PREPARED, workOrderId: '33333333-3333-4333-8333-333333333333' }, ctx(invoke));
    expect((invoke.mock.calls[0][1] as { body: { record: Record<string, unknown> } }).body.record.workOrderId)
      .toBe('33333333-3333-4333-8333-333333333333');
  });
  it('AC-AIN-016 a dispatch rejection surfaces its message, never ok', async () => {
    const invoke: Invoker = async () => ({ data: null, error: { context: new Response(JSON.stringify({ error: 'commit-rejected', message: 'project is not mapped in ERPNext' }), { status: 422 }) } });
    expect(await runDraftInvoice(PREPARED, ctx(invoke))).toEqual({ error: 'project is not mapped in ERPNext', code: 'commit-rejected' });
  });
  it('AC-AIN-016 a 25 s timeout tells the user to check before asking again', async () => {
    vi.useFakeTimers();
    const p = runDraftInvoice(PREPARED, ctx(() => new Promise(() => {})));
    await vi.advanceTimersByTimeAsync(DRAFT_INVOICE_DISPATCH_TIMEOUT_MS + 1);
    expect(await p).toEqual({ error: 'ERPNext did not answer in time. The draft may still appear — check Sales Invoices before asking again.', code: 'external-unreachable' });
  });
  it('an invalid replayed draft is refused without dispatching', async () => {
    const invoke = vi.fn<Invoker>();
    expect(await runDraftInvoice({ ...PREPARED, kind: 'x' }, ctx(invoke))).toEqual({ error: 'not a prepared draft invoice' });
    expect(invoke).not.toHaveBeenCalled();
  });
  it('the action always chips and carries prepare + validatePrepared', () => {
    expect(draftInvoiceAction).toMatchObject({ name: 'draft_invoice', confirm: true });
    expect(draftInvoiceAction.needsApproval?.({}, {} as never)).toBe(true);
    expect(typeof draftInvoiceAction.prepare).toBe('function');
    expect(typeof draftInvoiceAction.validatePrepared).toBe('function');
  });
});
