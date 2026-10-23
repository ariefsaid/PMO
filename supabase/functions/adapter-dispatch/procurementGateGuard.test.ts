import { assertEquals } from '@std/assert';
import { checkProcurementGate } from './procurementGateGuard.ts';

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
