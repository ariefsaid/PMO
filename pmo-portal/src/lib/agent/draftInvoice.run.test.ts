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
  describe('native path (#1595)', () => {
    const NATIVE = { ...PREPARED, path: 'native' as const, workOrderId: '33333333-3333-4333-8333-333333333333', items: [{ ...PREPARED.items[0], item_code: '' }] };
    const NEW_ID = '66666666-6666-4666-8666-666666666666';
    type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
    // `existing` = the native Drafts already on the project/customer (the retry-duplicate check reads them).
    const nativeCtx = (rpc: ReturnType<typeof vi.fn<Rpc>>, invoke = vi.fn<Invoker>(), existing: unknown[] = []) => {
      const { client, calls } = fakeSupabase(() => ({ data: existing, error: null }));
      return { jwt: '', userId: 'u-fin', orgId: 'org-1', role: 'Finance', calls, supabase: { from: client.from, rpc, functions: { invoke } } as never };
    };
    it('AC-AIN-NAT-001 calls the native create RPC once as the caller, and nothing else', async () => {
      const rpc = vi.fn<Rpc>(async () => ({ data: NEW_ID, error: null }));
      const invoke = vi.fn<Invoker>();
      const out = await runDraftInvoice(NATIVE, nativeCtx(rpc, invoke));
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith('create_native_sales_invoice', {
        p_project_id: PREPARED.projectId, p_customer_id: PREPARED.customerId, p_work_order_id: NATIVE.workOrderId,
        p_lines: [{ description: PREPARED.items[0].description, qty: 1, rate: 1_000_000 }],
      });
      expect(invoke).not.toHaveBeenCalled();
      expect(out).toMatchObject({ ok: true, status: 'Draft', id: NEW_ID, siNumber: null, link: `/sales-invoices/${NEW_ID}` });
    });
    it('AC-AIN-NAT-001 never approves: the only RPC is the create (SoD stays with a different approver)', async () => {
      const rpc = vi.fn<Rpc>(async () => ({ data: NEW_ID, error: null }));
      await runDraftInvoice(NATIVE, nativeCtx(rpc));
      expect(rpc.mock.calls.map(([name]) => name)).toEqual(['create_native_sales_invoice']);
      expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/transition|Unpaid|approve|author/i);
    });
    it('a milestone draft sends no work order', async () => {
      const rpc = vi.fn<Rpc>(async () => ({ data: NEW_ID, error: null }));
      const { workOrderId: _w, ...milestone } = NATIVE;
      await runDraftInvoice(milestone, nativeCtx(rpc));
      expect(rpc.mock.calls[0][1]).not.toHaveProperty('p_work_order_id');
    });
    it('the RPC refusing (role, ERP owns revenue, VAT rate missing) surfaces its message, never ok', async () => {
      const rpc = vi.fn<Rpc>(async () => ({ data: null, error: { message: 'customer invoices for this organisation are raised in the connected ERP, not in PMO', code: '42501' } }));
      expect(await runDraftInvoice(NATIVE, nativeCtx(rpc))).toEqual({ error: 'customer invoices for this organisation are raised in the connected ERP, not in PMO', code: '42501' });
    });
    it('AC-AIN-016 a native 25 s timeout says the outcome is unconfirmed and points to Sales Invoices — never "could not be saved"', async () => {
      vi.useFakeTimers();
      const p = runDraftInvoice(NATIVE, nativeCtx(vi.fn<Rpc>(() => new Promise(() => {}))));
      await vi.advanceTimersByTimeAsync(DRAFT_INVOICE_DISPATCH_TIMEOUT_MS + 1);
      const out = (await p) as { error: string; code: string };
      expect(out).toEqual({ error: 'PMO did not answer in time. The draft may still appear — check Sales Invoices before asking again.', code: 'timeout' });
      expect(out.error).not.toMatch(/could not be saved/);
    });
    it('a thrown non-timeout error stays "could not be saved"', async () => {
      expect(await runDraftInvoice(NATIVE, nativeCtx(vi.fn(async () => { throw new Error('boom'); })))).toEqual({ error: 'The invoice could not be saved.' });
    });
    describe('a retry cannot create a second Draft for the same milestone', () => {
      const { workOrderId: _w, ...MILESTONE } = NATIVE;
      const draft = (description: string, rate: number) => ({ id: 'si-1', native_lines: [{ description, qty: 1, rate, amount: rate }] });
      const same = draft(PREPARED.items[0].description, PREPARED.items[0].rate);
      it('a matching Draft already exists → refused, no create', async () => {
        const rpc = vi.fn<Rpc>(async () => ({ data: NEW_ID, error: null }));
        const c = nativeCtx(rpc, undefined, [same]);
        const out = await runDraftInvoice(MILESTONE, c);
        expect(rpc).not.toHaveBeenCalled();
        expect(out).toMatchObject({ code: 'duplicate-draft', error: expect.stringMatching(/already exists.*Sales Invoices/) });
        expect(c.calls[0]).toMatchObject({ table: 'sales_invoices' });
        expect(c.calls[0].ops).toEqual(expect.arrayContaining([
          ['eq', 'project_id', PREPARED.projectId], ['eq', 'customer_id', PREPARED.customerId], ['eq', 'status', 'Draft'], ['eq', 'pmo_native', true],
        ]));
      });
      it.each([
        ['another milestone', [draft('Other — Milestone 3', PREPARED.items[0].rate)]],
        ['another amount', [draft(PREPARED.items[0].description, 5)]],
        ['no Draft', []],
      ])('%s → created', async (_n, existing) => {
        const rpc = vi.fn<Rpc>(async () => ({ data: NEW_ID, error: null }));
        expect(await runDraftInvoice(MILESTONE, nativeCtx(rpc, undefined, existing))).toMatchObject({ ok: true, id: NEW_ID });
        expect(rpc).toHaveBeenCalledTimes(1);
      });
      it('a work-order draft skips the check (the 0262 fence owns it)', async () => {
        const rpc = vi.fn<Rpc>(async () => ({ data: NEW_ID, error: null }));
        const c = nativeCtx(rpc, undefined, [same]);
        expect(await runDraftInvoice(NATIVE, c)).toMatchObject({ ok: true });
        expect(c.calls).toHaveLength(0);
      });
      it('an unreadable check fails closed: no create', async () => {
        const rpc = vi.fn<Rpc>(async () => ({ data: NEW_ID, error: null }));
        const c = { ...nativeCtx(rpc), supabase: { rpc, from: () => { throw new Error('down'); } } as never };
        expect(await runDraftInvoice(MILESTONE, c)).toEqual({ error: 'The invoice could not be saved.' });
        expect(rpc).not.toHaveBeenCalled();
      });
    });
    it('the success note never claims approvers were notified (there may be none)', async () => {
      const out = (await runDraftInvoice(NATIVE, nativeCtx(vi.fn<Rpc>(async () => ({ data: NEW_ID, error: null }))))) as { note: string };
      expect(out.note).not.toMatch(/has been notified|have been notified/);
      expect(out.note).toMatch(/NOT approved/);
      expect(out.note).toMatch(/only one.*second Finance or Admin user must approve/i);
    });
    it('an RPC that throws or returns no id is an error, never ok', async () => {
      expect(await runDraftInvoice(NATIVE, nativeCtx(vi.fn(async () => { throw new Error('boom'); })))).toEqual({ error: 'The invoice could not be saved.' });
      expect(await runDraftInvoice(NATIVE, nativeCtx(vi.fn(async () => ({ data: null, error: null }))))).toEqual({ error: 'The invoice could not be saved.' });
    });
    it('an ERP-path draft still dispatches and never calls the RPC (AC-AIN-NAT-003)', async () => {
      const rpc = vi.fn();
      const invoke = vi.fn<Invoker>(async () => ({ data: { canonical: { id: PREPARED.commandId, si_number: 'ACC-SINV-2026-00099' } }, error: null }));
      await runDraftInvoice(PREPARED, nativeCtx(rpc, invoke));
      expect(rpc).not.toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledTimes(1);
    });
  });
  it('the action always chips and carries prepare + validatePrepared', () => {
    expect(draftInvoiceAction).toMatchObject({ name: 'draft_invoice', confirm: true });
    expect(draftInvoiceAction.needsApproval?.({}, {} as never)).toBe(true);
    expect(typeof draftInvoiceAction.prepare).toBe('function');
    expect(typeof draftInvoiceAction.validatePrepared).toBe('function');
  });
});
