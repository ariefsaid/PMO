import { assertEquals } from '@std/assert';
import { checkProcurementGate } from './procurementGateGuard.ts';

Deno.test('an undeclared tier refuses continuation of a captured purchase', async () => {
  const client = {
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { record_only: true }, error: null }) }) }) }) }),
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  const result = await checkProcurementGate(client, 'org', { domain: 'procurement', operation: 'create', record: { id: 'payment', procurementId: 'purchase', erp_doc_kind: 'payment' } }, 'unregistered');
  assertEquals(result.message, 'capture_tier_unsupported');
});
