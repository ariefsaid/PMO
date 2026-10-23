import { assert } from '@std/assert';
Deno.test('AC-PFE-010: adapter-dispatch runs the procurement gate before the ERP path', async () => {
  const src = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
  const gate = src.indexOf('checkProcurementGate(serviceClient');
  const erpPath = src.indexOf('checkRevenueErpPathTarget(serviceClient');
  assert(gate > 0 && erpPath > gate, 'the gate is called, and before any adapter/outbox work');
  const between = src.slice(gate, erpPath);
  assert(
    /if \(!procurementGate\.ok\) \{\s*return new Response\([^)]*procurementGate\.message[\s\S]*?status: procurementGate\.status/.test(between),
    'a refusal returns the gate status + reason code instead of continuing to the ERP path',
  );
});
