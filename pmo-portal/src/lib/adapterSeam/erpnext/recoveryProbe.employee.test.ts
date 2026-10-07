import { describe, expect, it, vi } from 'vitest';
import { probeErpByPaymentComposite } from './recoveryProbe';
import type { ErpClientDeps } from './client';

function client(docs: Record<string, Record<string, unknown>>, compositeNames: string[]): ErpClientDeps {
  const fetchImpl = async (url: string) => {
    if (url.includes('filters=')) {
      const filters = decodeURIComponent(url);
      const names = filters.includes('"reference_no","like"') ? [] : compositeNames;
      return new Response(JSON.stringify({ data: names.map((name) => ({ name })) }));
    }
    const name = decodeURIComponent(url.split('/').pop()!.split('?')[0]);
    return new Response(JSON.stringify(docs[name]));
  };
  return { fetchImpl: vi.fn(fetchImpl) as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test' };
}
const deps = (c: ErpClientDeps) => ({ client: c, doctype: 'Payment Entry', anchorField: 'reference_no', pmoRecordId: 'claim-1:claim-payment',
  fromDoc: (doc: unknown) => ({ id: String((doc as { name: string }).name) }) });
const input = (over: Record<string, unknown> = {}) => ({ partyType: 'Employee', party: 'HR-EMP-00002', paidAmount: '100.00', piNames: [], siNames: [],
  createdAfter: '2026-10-07 09:59:00', paymentType: 'Pay' as const, journalNames: ['ACC-JV-2026-00002'], ...over });

describe('Employee composite probe (AC-EXP-116)', () => {
  it('AC-EXP-116 adopts the unique candidate citing the approval journal', async () => {
    const c = client({
      'PE-1': { name: 'PE-1', references: [{ reference_name: 'ACC-JV-2026-00002' }] },
      'PE-2': { name: 'PE-2', references: [{ reference_name: 'ACC-JV-2026-00009' }] },
    }, ['PE-1', 'PE-2']);
    expect(await probeErpByPaymentComposite(deps(c), 'expp:x', input())).toEqual({ externalRecordId: 'PE-1', canonical: { id: 'claim-1:claim-payment' } });
  });

  it('AC-EXP-116 with no journal to cite, adopts only a unique no-reference candidate', async () => {
    const c = client({ 'PE-3': { name: 'PE-3', references: [] }, 'PE-4': { name: 'PE-4', references: [{ reference_name: 'X' }] } }, ['PE-3', 'PE-4']);
    expect(await probeErpByPaymentComposite(deps(c), 'expa:x', input({ journalNames: [] }))).toEqual({ externalRecordId: 'PE-3', canonical: { id: 'claim-1:claim-payment' } });
  });

  it('AC-EXP-116 two matching candidates are inconclusive (held, never adopted)', async () => {
    const c = client({ 'PE-5': { name: 'PE-5', references: [] }, 'PE-6': { name: 'PE-6', references: [] } }, ['PE-5', 'PE-6']);
    expect(await probeErpByPaymentComposite(deps(c), 'expa:x', input({ journalNames: [] }))).toBeNull();
  });

  it('AC-EXP-116 a Supplier probe with no cited invoice still matches nothing (unchanged)', async () => {
    const c = client({ 'PE-7': { name: 'PE-7', references: [] } }, ['PE-7']);
    expect(await probeErpByPaymentComposite(deps(c), 'k', input({ partyType: 'Supplier', journalNames: undefined }))).toBeNull();
  });
});
