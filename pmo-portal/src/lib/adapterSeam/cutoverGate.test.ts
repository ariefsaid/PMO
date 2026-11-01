import { describe, expect, it, vi } from 'vitest';
import { assertNotPreCutover } from './cutoverGate.ts';

const CASE = '04810000-0000-4000-8000-0000000000c1';
const clientAnswering = (data: unknown, error: { message: string } | null = null) => {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { client: { rpc }, rpc };
};
const step = (erp_doc_kind: string, procurementId: unknown = CASE) => ({ domain: 'procurement', record: { erp_doc_kind, procurementId } });

describe('assertNotPreCutover (FR-ECA-030, OQ-ECA-1)', () => {
  it.each(['goods-receipt', 'purchase-invoice', 'payment'])('AC-ECA-020 a %s on a purchase ordered before the connection is refused as pre-cutover', async (kind) => {
    const { client, rpc } = clientAnswering(true);
    await expect(assertNotPreCutover(client, step(kind))).rejects.toMatchObject({ code: 'pre-cutover' });
    expect(rpc).toHaveBeenCalledWith('pre_cutover_procurement', { p_procurement_id: CASE });
  });

  it('a later step on a purchase ordered after the connection passes', async () => {
    const { client } = clientAnswering(false);
    await expect(assertNotPreCutover(client, step('goods-receipt'))).resolves.toBeUndefined();
  });

  it.each(['purchase-order', 'purchase-request', 'rfq', 'quotation'])('the %s is the first ERP-bound step, never held back, and costs no check', async (kind) => {
    const { client, rpc } = clientAnswering(true);
    await expect(assertNotPreCutover(client, step(kind))).resolves.toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('another domain is not checked', async () => {
    const { client, rpc } = clientAnswering(true);
    await expect(assertNotPreCutover(client, { domain: 'revenue', record: { erp_doc_kind: 'payment', procurementId: CASE } })).resolves.toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['the answer is null (case outside the caller\'s org or unknown)', clientAnswering(null)],
    ['the check errors', clientAnswering(null, { message: 'boom' })],
    ['the answer is not a boolean', clientAnswering('true')],
  ])('fails closed when %s', async (_name, { client }) => {
    await expect(assertNotPreCutover(client, step('goods-receipt'))).rejects.toMatchObject({ code: 'commit-rejected' });
  });

  it('fails closed, without asking, when the step names no purchase', async () => {
    const { client, rpc } = clientAnswering(false);
    await expect(assertNotPreCutover(client, step('payment', null))).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
