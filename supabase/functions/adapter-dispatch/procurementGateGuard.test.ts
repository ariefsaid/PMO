import { assertEquals } from '@std/assert';
import { checkProcurementGate, checkQueuedProcurementCreate } from './procurementGateGuard.ts';

function fakeClient(opts: { orgRow?: unknown; rowError?: boolean; violation?: string | null; rpcError?: boolean }) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const reads: Array<{ table: string; filters: Array<[string, string]> }> = [];
  const client = {
    calls,
    reads,
    from: (table: string) => ({
      select: () => {
        const read = { table, filters: [] as Array<[string, string]> };
        reads.push(read);
        return { eq: (c1: string, v1: string) => { read.filters.push([c1, v1]); return { eq: (c2: string, v2: string) => { read.filters.push([c2, v2]); return { maybeSingle: () => Promise.resolve(
          opts.rowError ? { data: null, error: { message: 'boom' } } : { data: opts.orgRow ?? null, error: null }) }; } }; } };
      },
    }),
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve(opts.rpcError ? { data: null, error: { message: 'boom' } } : { data: opts.violation ?? null, error: null });
    },
  };
  return client;
}
const cmd = (kind: string, operation = 'create') =>
  ({ domain: 'procurement', operation, record: { id: 'r1', procurementId: 'p1', erp_doc_kind: kind } });

Deno.test('AC-PFE-003: a gate violation refuses the procurement create before any ERP write', async () => {
  const c = fakeClient({ orgRow: { org_id: 'o1' }, violation: 'gate_approval_before_order' });
  assertEquals(await checkProcurementGate(c as never, 'o1', cmd('purchase-order')), { ok: false, status: 422, message: 'gate_approval_before_order' });
  assertEquals(c.calls[0], { fn: 'procurement_gate_violation', args: { p_procurement_id: 'p1', p_step: 'Ordered' } });
});
Deno.test('the purchase is read scoped to the caller org before the gate RPC (service role skips the RPC org check)', async () => {
  const c = fakeClient({ orgRow: { org_id: 'o1' } });
  await checkProcurementGate(c as never, 'o1', cmd('purchase-order'));
  assertEquals(c.reads, [{ table: 'procurements', filters: [['id', 'p1'], ['org_id', 'o1']] }]);
});
Deno.test('AC-PFE-010: a create the gates allow passes unchanged', async () => {
  const c = fakeClient({ orgRow: { org_id: 'o1' }, violation: null });
  assertEquals((await checkProcurementGate(c as never, 'o1', cmd('purchase-invoice'))).ok, true);
  assertEquals(c.calls[0].args.p_step, 'Vendor Invoiced');
});
Deno.test('payment maps to Paid, goods-receipt to Received', async () => {
  const c = fakeClient({ orgRow: { org_id: 'o1' } });
  await checkProcurementGate(c as never, 'o1', cmd('payment'));
  await checkProcurementGate(c as never, 'o1', cmd('goods-receipt'));
  assertEquals(c.calls.map((x) => x.args.p_step), ['Paid', 'Received']);
});
Deno.test('other domains, kinds and operations are not this gate', async () => {
  const c = fakeClient({});
  assertEquals((await checkProcurementGate(c as never, 'o1', { ...cmd('quotation') })).ok, true);
  assertEquals((await checkProcurementGate(c as never, 'o1', cmd('purchase-order', 'transition'))).ok, true);
  assertEquals((await checkProcurementGate(c as never, 'o1', { ...cmd('purchase-order'), domain: 'revenue' })).ok, true);
  assertEquals(c.calls.length, 0);
});
Deno.test('fails closed: purchase of another org, unreadable row, RPC failure, missing id', async () => {
  assertEquals((await checkProcurementGate(fakeClient({ orgRow: null }) as never, 'o1', cmd('purchase-order'))).message, 'purchase_not_found');
  assertEquals((await checkProcurementGate(fakeClient({ rowError: true }) as never, 'o1', cmd('purchase-order'))).message, 'gate-check-failed');
  assertEquals((await checkProcurementGate(fakeClient({ orgRow: { org_id: 'o1' }, rpcError: true }) as never, 'o1', cmd('purchase-order'))).message, 'gate-check-failed');
  const noId = { domain: 'procurement', operation: 'create', record: { id: 'r1', erp_doc_kind: 'purchase-order' } };
  assertEquals((await checkProcurementGate(fakeClient({}) as never, 'o1', noId as never)).message, 'gate-check-failed');
});

// 0373: the queued-create re-check asked before a quarantined procurement create is reissued.
Deno.test('a queued create the purchase rules now refuse is refused with the named reason', async () => {
  const c = fakeClient({ violation: 'gate_receipt_before_invoice' });
  assertEquals(await checkQueuedProcurementCreate(c as never, 'o1', cmd('purchase-invoice'), 'u1'),
    { ok: false, message: 'purchase rule refused: gate_receipt_before_invoice' });
  assertEquals(c.calls[0], { fn: 'procurement_create_refusal',
    args: { p_org_id: 'o1', p_procurement_id: 'p1', p_erp_doc_kind: 'purchase-invoice', p_actor_user_id: 'u1' } });
});
Deno.test('a queued create the rules allow passes; other domains, kinds and operations are not asked', async () => {
  const c = fakeClient({ violation: null });
  assertEquals((await checkQueuedProcurementCreate(c as never, 'o1', cmd('goods-receipt'), 'u1')).ok, true);
  assertEquals((await checkQueuedProcurementCreate(c as never, 'o1', cmd('quotation'), 'u1')).ok, true);
  assertEquals((await checkQueuedProcurementCreate(c as never, 'o1', cmd('purchase-order', 'transition'), 'u1')).ok, true);
  assertEquals((await checkQueuedProcurementCreate(c as never, 'o1', { ...cmd('purchase-order'), domain: 'revenue' }, 'u1')).ok, true);
  assertEquals(c.calls.length, 1);
});
Deno.test('the queued-create check fails closed when the rules cannot be read, and sends no id it does not have', async () => {
  assertEquals(await checkQueuedProcurementCreate(fakeClient({ rpcError: true }) as never, 'o1', cmd('purchase-order'), 'u1'),
    { ok: false, message: 'purchase rule check failed' });
  const c = fakeClient({ violation: 'purchase_not_found' });
  const noId = { domain: 'procurement', operation: 'create', record: { erp_doc_kind: 'purchase-order' } };
  assertEquals((await checkQueuedProcurementCreate(c as never, 'o1', noId, null)).ok, false);
  assertEquals(c.calls[0].args.p_procurement_id, null);
  assertEquals(c.calls[0].args.p_actor_user_id, null);
});
