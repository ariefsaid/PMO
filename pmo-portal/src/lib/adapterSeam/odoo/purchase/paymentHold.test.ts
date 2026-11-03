/**
 * AC-OPP-053 / OQ-OPP-10 / ADR-0058 C-1, through the shipped `dispatchMoneyWrite` with the real Odoo adapter on the fake Odoo: a
 * post-window recovery of a payment finds zero look-alikes, several, or one unique conjunction. Zero and several HOLD the row and the
 * adapter is never asked to create; the unique conjunction is adopted. A payment is never reissued on doubt.
 */
import { describe, expect, it, vi } from 'vitest';
import { dispatchMoneyWrite, type DispatchMoneyOutboxDeps } from '../../dispatch.ts';
import type { AdapterCommand } from '../../contract.ts';
import { bindCall } from '../client.ts';
import { createFakeOdoo } from '../fakeOdoo.ts';
import { createOdooProcurementAdapter, recoverPayment } from '../procurementAdapter.ts';
import { createFakeOutbox } from './fakeOutbox.ts';
import { odooReissueOnInconclusiveAbsence } from './reissuePolicy.ts';

const PAY_ID = 'dddddddd-dddd-4ddd-8ddd-000000001505';
const COMMAND: AdapterCommand = {
  domain: 'procurement', operation: 'create', idempotencyKey: 'k-pay',
  record: { id: PAY_ID, erp_doc_kind: 'payment', procurementId: 'case-1', invoiceId: 'inv-1', paid_amount: '98.00', date: '2026-12-10' },
};

const outbox = (reissue: boolean, probe: DispatchMoneyOutboxDeps['probeByRemarksKey']) => {
  const o = createFakeOutbox(reissue, probe);
  return { ...o, strand: () => o.strand(() => run(o.deps, vi.fn()), COMMAND.domain, PAY_ID, COMMAND.idempotencyKey!) };
};

const run = (money: DispatchMoneyOutboxDeps, commit: ReturnType<typeof vi.fn>) =>
  dispatchMoneyWrite({ adapter: { tier: 'odoo', capabilityMap: new Set(['procurement']), commit } as never, command: COMMAND, writeReadModel: vi.fn(), recordExternalRef: vi.fn(), money });

async function world() {
  const fake = createFakeOdoo({ key: 'k' });
  fake.seed('product.product', [{ id: 55, name: 'Cable tray', supplier_taxes_id: [] }]);
  fake.seed('account.journal', [{ id: 7, type: 'bank', outbound_payment_method_line_ids: [31] }]);
  const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: fake.fetch });
  const [billId] = await call<number[]>('account.move', 'create', { vals_list: [{ move_type: 'in_invoice', partner_id: 9, currency_id: 12, invoice_date: '2026-12-05', invoice_line_ids: [[0, 0, { product_id: 55, quantity: 1, price_unit: 98, tax_ids: [[6, 0, []]] }]] }] });
  await call('account.move', 'action_post', { ids: [billId] });
  const composite = { partnerId: 9, amount: '98.00', billId, createdAfter: '2026-01-01 00:00:00', createdBefore: '2099-01-01 00:00:00' };
  /** The recovery probe exactly as the Odoo outbox deps wire it: the composite only in a recovery. */
  const probe: DispatchMoneyOutboxDeps['probeByRemarksKey'] = async (_d, _k, p) => recoverPayment(call, COMMAND.record, p?.recovery === false ? undefined : composite, `account.move:${billId}`);
  const lookAlike = (id: number, over: Record<string, unknown> = {}) =>
    fake.seed('account.payment', [{ id, payment_type: 'outbound', partner_type: 'supplier', state: 'paid', partner_id: 9, amount: 98, memo: 'edited by a clerk', move_id: [900 + id, 'x'], reconciled_bill_ids: [billId], create_date: '2026-06-01 00:00:00', ...over }]);
  return { fake, probe, lookAlike, billId };
}

describe('AC-OPP-053 a payment is held, never reissued, when a post-window recovery cannot tell', () => {
  it('the policy: a payment is not reissued on inconclusive absence (OQ-OPP-10)', () => {
    expect(odooReissueOnInconclusiveAbsence('payment')).toBe(false);
  });

  it('zero matches: the row is HELD and the adapter is never asked to create', async () => {
    const w = await world();
    const o = outbox(odooReissueOnInconclusiveAbsence('payment'), w.probe);
    await o.strand();
    const commit = vi.fn(async () => { throw new Error('a payment must never be created by a recovery'); });
    await expect(run(o.deps, commit)).rejects.toMatchObject({ code: 'command-held' });
    expect(commit).not.toHaveBeenCalled();
    expect(o.state()).toBe('held');
    expect(w.fake.rows('account.payment')).toHaveLength(0);
  });

  it('two matches: the row is HELD (the probe throws on doubt), nothing is adopted or created', async () => {
    const w = await world();
    w.lookAlike(70);
    w.lookAlike(71);
    const o = outbox(odooReissueOnInconclusiveAbsence('payment'), w.probe);
    await o.strand();
    const commit = vi.fn();
    await expect(run(o.deps, commit)).rejects.toMatchObject({ code: 'command-held' });
    expect(commit).not.toHaveBeenCalled();
    expect(o.state()).toBe('held');
    expect(w.fake.rows('account.payment')).toHaveLength(2);
  });

  it('one unique conjunction (vendor, amount, window, reconciled to this bill): ADOPTED, read back and confirmed; still nothing created', async () => {
    const w = await world();
    w.lookAlike(70);
    const o = outbox(odooReissueOnInconclusiveAbsence('payment'), w.probe);
    await o.strand();
    const commit = vi.fn();
    const result = await run(o.deps, commit);
    expect(commit).not.toHaveBeenCalled();
    expect(result.externalRecordId).toBe('account.payment:70');
    expect(o.state()).toBe('confirmed');
    expect(w.fake.rows('account.payment')).toHaveLength(1);
  });

  it('a first attempt that finds nothing DOES create (there is no doubt yet): the hold is for a recovery only', async () => {
    const w = await world();
    const o = outbox(odooReissueOnInconclusiveAbsence('payment'), w.probe);
    await o.deps.insertOutboxPending(COMMAND.domain, PAY_ID, COMMAND.idempotencyKey!);
    const adapter = createOdooProcurementAdapter({
      call: bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: w.fake.fetch }),
      resolveOrder: async () => { throw new Error('unused'); }, resolveRevise: async () => { throw new Error('unused'); }, resolveBill: async () => { throw new Error('unused'); },
      resolvePayment: async () => ({ billRef: `account.move:${w.billId}`, amount: '98.00', date: '2026-12-10', vendorPartnerId: 9, journalId: 7, companyCurrencyId: 12 }),
    });
    await dispatchMoneyWrite({ adapter, command: COMMAND, writeReadModel: vi.fn(), recordExternalRef: vi.fn(), money: o.deps });
    expect(w.fake.rows('account.payment')).toHaveLength(1);
    expect(o.state()).toBe('confirmed');
  });
});
