/**
 * imprest.transfer (v1) — head office bank → a site float's cash account, once per key (#1515 §9, AC-IMP-072):
 * a retry after a lost answer never makes a second transfer, and a document under another key is never adopted.
 */
import { describe, expect, it } from 'vitest';
import type { ImprestTransfer } from '../imprestTransfer.ts';
import type { ErpHarness, Suite, TransferHarness } from './harness.ts';

const REP = '15150000-0000-0000-0000-0000000000e3';
const TRANSFER: ImprestTransfer = {
  key: `impt:${REP}:1791367200123`, fromAccount: 'Head Office Bank', toAccount: 'Site Cash F', amount: '800000.00',
  date: '2026-11-01', reference: 'REP-2611010003',
};

function transferOf(h: ErpHarness): TransferHarness {
  if (!h.transfer) throw new Error(`${h.tier} declares imprest.transfer supported but its harness has no transfer()`);
  return h.transfer();
}

export const imprestTransferSuite: Suite = (h) => describe(`imprest.transfer (${h.tier})`, () => {
  it('AC-IMP-072 a transfer posts one document moving the amount from the bank to the float\'s cash account', async () => {
    const t = transferOf(h);
    const { externalId } = await t.post(TRANSFER);
    expect(t.documents()).toEqual([{ externalId, key: TRANSFER.key }]);
    expect(t.lines(TRANSFER.key)).toEqual([
      { account: 'Site Cash F', debit: '800000.00', credit: '0.00' },
      { account: 'Head Office Bank', debit: '0.00', credit: '800000.00' },
    ]);
  });

  it('AC-IMP-072 posting the same key again adopts the first document: no second transfer', async () => {
    const t = transferOf(h);
    const first = await t.post(TRANSFER);
    expect(await t.post(TRANSFER)).toEqual(first);
    expect(t.documents()).toHaveLength(1);
  });

  it('AC-IMP-072 a lost answer then a retry leaves exactly one document', async () => {
    const t = transferOf(h);
    t.failNextWrite('lost-response');
    await expect(t.post(TRANSFER)).rejects.toMatchObject({ code: 'external-unreachable' });
    const retry = await t.post(TRANSFER);
    const docs = t.documents();
    expect(docs).toHaveLength(1);
    expect(docs[0].externalId).toBe(retry.externalId);
  });

  it('AC-IMP-072 a transport failure writes nothing; the retry posts once', async () => {
    const t = transferOf(h);
    t.failNextWrite('transport');
    await expect(t.post(TRANSFER)).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(t.documents()).toEqual([]);
    await t.post(TRANSFER);
    expect(t.documents()).toHaveLength(1);
  });

  it('AC-IMP-072 a document with another key is never adopted', async () => {
    const t = transferOf(h);
    t.seed({ key: 'impt:15150000-0000-0000-0000-0000000000e9:1791367200000', fromAccount: 'Head Office Bank', toAccount: 'Site Cash F', amount: '5.00', date: '2026-11-01', reference: 'other' });
    const { externalId } = await t.post(TRANSFER);
    const docs = t.documents();
    expect(docs).toHaveLength(2);
    expect(docs.find((d) => d.key === TRANSFER.key)?.externalId).toBe(externalId);
  });
});
