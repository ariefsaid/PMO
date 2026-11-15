import { describe, expect, it, vi } from 'vitest';
import { probeCapturedPayment } from './recoveryProbe.ts';

const payload = { party: 'SUP-1', pi_names: ['BILL-1'], paid_amount: 25 };
const doc = { name: 'PAY-1', docstatus: 1, reference_no: 'intent', payment_type: 'Pay', party_type: 'Supplier', party: 'SUP-1', paid_amount: 25, references: [{ reference_doctype: 'Purchase Invoice', reference_name: 'BILL-1', allocated_amount: 25 }] };
function run(candidate: unknown, listed = true, input: Record<string, unknown> = payload) {
  const fetchImpl = vi.fn(async (url: string) => url.includes('filters=')
    ? Response.json({ data: listed ? [{ name: 'PAY-1' }] : [] })
    : Response.json(candidate));
  const deps = { client: { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: 'key', apiSecret: 'secret', baseUrl: 'https://example.test' }, doctype: 'Payment Entry', anchorField: 'reference_no', fromDoc: () => ({ id: 'payment' }), pmoRecordId: 'payment' };
  return { fetchImpl, result: probeCapturedPayment(deps, 'intent', input) };
}
describe('captured payment anchored recovery', () => {
  it('adopts a submitted entry only when its anchor and allocation match', async () => {
    const s = run(doc);
    expect(await s.result).toEqual({ externalRecordId: 'PAY-1', canonical: { id: 'payment' } });
    expect(s.fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('does not adopt an unanchored look-alike', async () => {
    const s = run(doc, false);
    expect(await s.result).toBeNull();
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['anchor', { reference_no: 'other' }], ['party', { party: 'OTHER' }], ['amount', { paid_amount: 26 }],
    ['invoice', { references: [{ ...doc.references[0], reference_name: 'OTHER' }] }],
    ['allocation', { references: [{ ...doc.references[0], allocated_amount: 24 }] }],
    ['draft', { docstatus: 0 }], ['payment type', { payment_type: 'Receive' }], ['party type', { party_type: 'Customer' }],
  ])('holds when the candidate has a different %s', async (_label, patch) => {
    expect(await run({ ...doc, ...patch }).result).toBeNull();
  });
  it('does not probe without a complete frozen allocation', async () => {
    const s = run(doc, true, { party: 'SUP-1', pi_names: [], paid_amount: 25 });
    expect(await s.result).toBeNull();
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });
});
