import { describe, expect, it } from 'vitest';
import type { AdapterCommand } from '../contract.ts';
import { bindCall } from './client.ts';
import { createFakeOdoo } from './fakeOdoo.ts';
import { createOdooRevenueAdapter, recoverReceipt } from './revenueAdapter.ts';
import type { ReceiptDefaults, ReceiptInput, ReceiptInvoice } from './revenue/receiptBody.ts';
import type { ReceiptComposite } from './revenue/receiptRecoveryProbe.ts';

const INVOICE_ID = '77777777-7777-4777-8777-777777777777';
const RECEIPT_ID = '88888888-8888-4888-8888-888888888888';
const SECOND_RECEIPT_ID = '99999999-9999-4999-8999-999999999999';
const RECEIPT_DATE = '2026-11-03';
const INVOICE_ODOO_ID = 123;
const INVOICE_MOVE_ID = 456;
const COMPOSITE: ReceiptComposite = {
  partnerId: 41,
  amount: 111000,
  date: RECEIPT_DATE,
  invoiceId: INVOICE_ODOO_ID,
  createdAfter: '2000-01-01 00:00:00',
};
const input: ReceiptInput = {
  id: RECEIPT_ID, orgId: 'org-a', date: RECEIPT_DATE, currency: 'IDR', settled: 111000, cash: 111000,
};
const invoice: ReceiptInvoice = {
  id: INVOICE_ID, orgId: 'org-a', customerId: 'cust-a', state: 'posted', outstanding: '111000.00', currency: 'IDR',
};
const defaults: ReceiptDefaults = {
  companyCurrency: 'IDR', partners: { 'cust-a': 41 }, journalId: 9, inboundMethodLineId: 31, taxPrepaidAccountId: 88,
  accountCurrencies: { receivable: 'IDR', cash: 'IDR', taxPrepaid: 'IDR' },
};
const receiptCommand = (over: Record<string, unknown> = {}): AdapterCommand => ({
  domain: 'revenue', operation: 'create', idempotencyKey: 'receipt-intent-1',
  record: {
    id: RECEIPT_ID, erp_doc_kind: 'incoming-payment', salesInvoiceId: INVOICE_ID,
    date: input.date, paid_amount: input.settled, received_amount: input.cash ?? input.settled,
    withheld_amount: input.withheld ?? 0, withholding_slip_number: input.slipNumber ?? null,
    ...over,
  },
});

function rig({ receipt = input, inv = invoice, config = defaults, failAfter }: {
  receipt?: ReceiptInput; inv?: ReceiptInvoice | null; config?: ReceiptDefaults;
  failAfter?: 'create' | 'anchor' | 'post' | 'reconcile';
} = {}) {
  const fake = createFakeOdoo({ key: 'k' });
  fake.seed('account.move', [{
    id: INVOICE_ODOO_ID, name: 'INV/2026/00001', move_type: 'out_invoice', state: 'posted', partner_id: 41,
    currency_id: [12, 'IDR'], amount_total: 111000, amount_residual: 111000, write_date: '2026-11-03 10:00:00',
  }]);
  fake.seed('account.move.line', [{
    id: INVOICE_MOVE_ID, move_id: INVOICE_ODOO_ID, account_type: 'asset_receivable', partner_id: 41,
    balance: 111000, amount_residual: 111000, reconciled: false,
  }]);

  let trigger = failAfter;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const [, model, method] = /\/json\/2\/([^/]+)\/([^/]+)$/.exec(String(url)) ?? [];
    const response = await fake.fetch(url, init);
    const afterCreate = trigger === 'create' && model === 'account.payment' && method === 'create';
    const afterAnchor = trigger === 'anchor' && model === 'ir.model.data' && method === 'create';
    const afterPost = trigger === 'post' && model === 'account.payment' && method === 'action_post';
    const afterReconcile = trigger === 'reconcile' && model === 'account.move.line' && method === 'reconcile';
    if (afterCreate || afterAnchor || afterPost || afterReconcile) {
      trigger = undefined;
      throw new TypeError('error sending request: connection reset');
    }
    return response;
  }) as typeof fetch;
  const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl });
  const adapter = createOdooRevenueAdapter({
    call,
    resolveInvoice: async () => { throw new Error('invoice path unused'); },
    resolveReceipt: async () => ({ input: receipt, invoice: inv, defaults: config, recordedBy: 'jwt-user', invoiceRef: `account.move:${INVOICE_ODOO_ID}` }),
  });
  const command = (over: Record<string, unknown> = {}) => receiptCommand({
    date: receipt.date, paid_amount: receipt.settled, received_amount: receipt.cash ?? receipt.settled,
    withheld_amount: receipt.withheld ?? 0, withholding_slip_number: receipt.slipNumber ?? null,
    ...over,
  });
  const attempt = async (cmd = command(), recovery = false) =>
    (await recoverReceipt(call, cmd.record, recovery ? COMPOSITE : undefined)) ?? adapter.commit(cmd);
  const count = (model: string, method: string) => fake.calls.filter((c) => c.model === model && c.method === method).length;
  const writes = () => fake.calls.filter((c) => !['read', 'search_read', 'search_count'].includes(c.method)).length;
  return { fake, call, adapter, command, attempt, count, writes };
}

describe('AC-OCI-042 a customer receipt resumes after each committed step and never creates a duplicate', () => {
  it.each(['create', 'anchor', 'post', 'reconcile'] as const)('%s interruption recovers one posted receipt reconciled to the invoice', async (failAfter) => {
    const { fake, attempt, command, count } = rig({ failAfter });
    await expect(attempt()).rejects.toThrow();
    const result = await attempt(command(), true);
    expect(result.externalRecordId).toMatch(/^account\.payment:\d+$/);
    expect(fake.rows('account.payment')).toHaveLength(1);
    expect(fake.rows('account.payment')[0]).toMatchObject({ state: 'reconciled', payment_type: 'inbound', partner_type: 'customer', is_reconciled: true });
    expect(fake.rows('account.move')[0].amount_residual).toBe(0);
    expect([count('account.payment', 'create'), count('account.payment', 'action_post'), count('account.move.line', 'reconcile')]).toEqual([1, 1, 1]);
  });

  it('a retry of the same command key replays the settled receipt even though the invoice residual is now zero', async () => {
    const { fake, attempt, command, count } = rig();
    const first = await attempt();
    const replay = await attempt(command(), true);
    expect(replay.externalRecordId).toBe(first.externalRecordId);
    expect([fake.rows('account.payment').length, count('account.payment', 'create')]).toEqual([1, 1]);
  });
});

describe('AC-OCI-043 a receipt probe holds on doubt and adopts only its unique conjunction', () => {
  it.each(['signed memo', 'stock external identifier'] as const)('does not adopt a sibling receipt anchored by its %s', async (anchor) => {
    const sibling = rig({ receipt: { ...input, id: RECEIPT_ID } });
    sibling.fake.seed('account.payment', [{
      id: 508, payment_type: 'inbound', partner_type: 'customer', partner_id: 41, amount: 111000, date: RECEIPT_DATE,
      state: 'reconciled', is_reconciled: true, memo: anchor === 'signed memo' ? `pmo:ip:${RECEIPT_ID}` : 'memo edited after creation',
      create_date: '2026-11-03 10:03:00', reconciled_invoice_ids: [INVOICE_ODOO_ID], move_id: [708, 'PAY-8'],
    }]);
    if (anchor === 'stock external identifier') {
      await sibling.call('ir.model.data', 'create', { vals_list: [{
        module: 'pmo', name: `ip_${RECEIPT_ID.replaceAll('-', '_')}`, model: 'account.payment', res_id: 508,
      }] });
    }

    const nextReceipt = { ...input, id: SECOND_RECEIPT_ID };
    const nextCommand = receiptCommand({ id: SECOND_RECEIPT_ID });
    const recovery = await recoverReceipt(sibling.call, nextCommand.record, {
      ...COMPOSITE, createdAfter: '2026-11-03 10:00:00', createdBefore: '2026-11-03 10:10:00',
    }, nextReceipt);
    expect(recovery).toBeNull();
  });

  it('zero and two matches stay unadopted; one matching inbound customer payment on the invoice is recovered', async () => {
    const none = rig();
    expect(await recoverReceipt(none.call, receiptCommand().record, COMPOSITE)).toBeNull();
    expect(none.count('account.payment', 'create')).toBe(0);

    const several = rig();
    several.fake.seed('account.payment', [
      { id: 501, payment_type: 'inbound', partner_type: 'customer', partner_id: 41, amount: 111000, date: RECEIPT_DATE, state: 'paid', memo: 'edited-1', create_date: '2026-11-03 10:01:00', reconciled_invoice_ids: [INVOICE_ODOO_ID], move_id: [701, 'PAY-1'] },
      { id: 502, payment_type: 'inbound', partner_type: 'customer', partner_id: 41, amount: 111000, date: RECEIPT_DATE, state: 'paid', memo: 'edited-2', create_date: '2026-11-03 10:02:00', reconciled_invoice_ids: [INVOICE_ODOO_ID], move_id: [702, 'PAY-2'] },
    ]);
    await expect(recoverReceipt(several.call, receiptCommand().record, COMPOSITE)).rejects.toThrow('ambiguous-anchor');
    expect(several.count('account.payment', 'create')).toBe(0);

    const unique = rig();
    unique.fake.seed('account.payment', [
      { id: 503, payment_type: 'inbound', partner_type: 'customer', partner_id: 41, amount: 111000, date: RECEIPT_DATE, state: 'paid', memo: 'edited-by-accountant', create_date: '2026-11-03 10:03:00', move_id: [703, 'PAY-3'], is_reconciled: true, reconciled_invoice_ids: [INVOICE_ODOO_ID] },
      { id: 506, payment_type: 'inbound', partner_type: 'customer', partner_id: 41, amount: 111000, date: RECEIPT_DATE, state: 'paid', memo: 'another invoice receipt', create_date: '2026-11-03 10:03:30', move_id: [705, 'PAY-5'], is_reconciled: true, reconciled_invoice_ids: [999] },
    ]);
    unique.fake.seed('account.move.line', [
      { id: INVOICE_MOVE_ID, move_id: INVOICE_ODOO_ID, account_type: 'asset_receivable', partner_id: 41, balance: 111000, amount_residual: 0, reconciled: true },
      { id: 704, move_id: 703, account_type: 'asset_receivable', partner_id: 41, balance: -111000, amount_residual: 0, reconciled: true },
    ]);
    const adopted = await recoverReceipt(unique.call, receiptCommand().record, COMPOSITE);
    expect(adopted?.externalRecordId).toBe('account.payment:503');
    expect(unique.count('account.payment', 'create')).toBe(0);
  });

  it('can adopt a uniquely linked payment whose external identifier and memo were edited', async () => {
    const edited = rig();
    edited.fake.seed('account.payment', [{
      id: 509, payment_type: 'inbound', partner_type: 'customer', partner_id: 41, amount: 111000, date: RECEIPT_DATE,
      state: 'paid', is_reconciled: true, memo: 'memo edited by accountant', create_date: '2026-11-03 10:03:00',
      reconciled_invoice_ids: [INVOICE_ODOO_ID], move_id: [709, 'PAY-9'],
    }]);
    await edited.call('ir.model.data', 'create', { vals_list: [{
      module: 'pmo', name: 'renamed-external-id', model: 'account.payment', res_id: 509,
    }] });

    const adopted = await recoverReceipt(edited.call, receiptCommand().record, COMPOSITE);

    expect(adopted?.externalRecordId).toBe('account.payment:509');
    expect(edited.count('account.payment', 'create')).toBe(0);
  });

  it('holds a memo-edited draft when its invoice link cannot be proven by the immutable conjunction', async () => {
    const edited = rig();
    edited.fake.seed('account.payment', [{
      id: 505, payment_type: 'inbound', partner_type: 'customer', partner_id: 41, amount: 111000, date: RECEIPT_DATE,
      state: 'draft', memo: 'memo changed by accountant', create_date: '2026-11-03 10:03:00',
    }]);

    await expect(recoverReceipt(edited.call, receiptCommand().record, COMPOSITE)).rejects.toThrow('ambiguous-anchor');

    expect(edited.count('account.payment', 'create')).toBe(0);
    expect(edited.fake.rows('account.payment')).toHaveLength(1);
    expect(edited.fake.rows('account.payment')[0]).toMatchObject({ state: 'draft', memo: 'memo changed by accountant' });
    expect(edited.writes()).toBe(0);
  });

  it('does not adopt a primary anchor already reconciled against another invoice', async () => {
    const wrongInvoice = rig();
    wrongInvoice.fake.seed('account.payment', [{
      id: 504, payment_type: 'inbound', partner_type: 'customer', partner_id: 41, amount: 111000, date: RECEIPT_DATE,
      state: 'paid', is_reconciled: true, memo: `pmo:ip:${RECEIPT_ID}`, reconciled_invoice_ids: [999], move_id: [704, 'PAY-4'],
    }]);
    await wrongInvoice.call('ir.model.data', 'create', { vals_list: [{ module: 'pmo', name: `ip_${RECEIPT_ID.replaceAll('-', '_')}`, model: 'account.payment', res_id: 504 }] });

    await expect(recoverReceipt(wrongInvoice.call, receiptCommand().record, COMPOSITE)).rejects.toThrow('receipt-does-not-match-command');
    expect(wrongInvoice.count('account.payment', 'create')).toBe(0);
  });

  it('holds an unanchored signed payment reconciled against another invoice', async () => {
    const wrongInvoice = rig();
    wrongInvoice.fake.seed('account.payment', [{
      id: 507, payment_type: 'inbound', partner_type: 'customer', partner_id: 41, amount: 111000, date: RECEIPT_DATE, create_date: '2026-11-03 10:04:00',
      state: 'reconciled', is_reconciled: true, memo: `pmo:ip:${RECEIPT_ID}`, reconciled_invoice_ids: [999], move_id: [707, 'PAY-7'],
    }]);

    await expect(recoverReceipt(wrongInvoice.call, receiptCommand().record, COMPOSITE)).rejects.toThrow('ambiguous-anchor');
    expect(wrongInvoice.count('account.payment', 'create')).toBe(0);
  });
});

describe('AC-OCI-040 a receipt cannot overpay the invoice', () => {
  it('refuses 112,000 against 111,000 before any Odoo write', async () => {
    const overpay = { ...input, settled: 112000, cash: 112000 };
    const { fake, adapter } = rig({ receipt: overpay });
    await expect(adapter.commit(receiptCommand())).rejects.toThrow('over-receipt');
    expect(fake.calls.filter((c) => !['read', 'search_read', 'search_count'].includes(c.method))).toEqual([]);
  });
});

describe('AC-OCI-044 a withheld receipt reconciles the gross using the tax-prepaid account', () => {
  it('records 109,000 cash and a 2,000 write-off against the configured account', async () => {
    const receipt: ReceiptInput = { ...input, settled: 111000, cash: 109000, withheld: 2000, slipNumber: 'BP-2026-001' };
    const { fake, adapter } = rig({ receipt });
    const result = await adapter.commit(receiptCommand());
    expect(result.externalRecordId).toMatch(/^account\.payment:\d+$/);
    expect(fake.rows('account.move')[0].amount_residual).toBe(0);
    expect(fake.rows('account.move.line')).toContainEqual(expect.objectContaining({ account_id: 88, balance: 2000 }));
    expect(fake.rows('account.payment')[0]).toMatchObject({ amount: 109000, payment_type: 'inbound', partner_type: 'customer' });
    expect(fake.rows('account.payment')[0]).toMatchObject({ state: 'reconciled', is_reconciled: false, reconciled_invoice_ids: [INVOICE_ODOO_ID] });
    expect(result.canonical).toMatchObject({ amount: 111000, received_amount: 109000, withheld_amount: 2000, withholding_slip_number: 'BP-2026-001' });
  });
});

describe('AC-OCI-040 partial receipts reduce the invoice residual before the next receipt', () => {
  it('records 40,000 then 71,000 as two receipts and settles the 111,000 invoice', async () => {
    const firstReceipt: ReceiptInput = { ...input, settled: 40000, cash: 40000 };
    const { fake, adapter, call, command } = rig({ receipt: firstReceipt });
    await adapter.commit(command());
    expect(fake.rows('account.move').find((row) => row.id === INVOICE_ODOO_ID)?.amount_residual).toBe(71000);

    const secondReceipt: ReceiptInput = { ...input, id: SECOND_RECEIPT_ID, settled: 71000, cash: 71000 };
    const secondAdapter = createOdooRevenueAdapter({
      call,
      resolveInvoice: async () => { throw new Error('invoice path unused'); },
      resolveReceipt: async () => ({ input: secondReceipt, invoice, defaults, recordedBy: 'jwt-user', invoiceRef: `account.move:${INVOICE_ODOO_ID}` }),
    });
    await secondAdapter.commit(command({ id: SECOND_RECEIPT_ID }));
    expect(fake.rows('account.payment')).toHaveLength(2);
    expect(fake.rows('account.move').find((row) => row.id === INVOICE_ODOO_ID)?.amount_residual).toBe(0);
  });
});

describe('AC-OCI-046 the receipt recorder comes from the verified JWT subject', () => {
  it('does not send a payload recorder to Odoo or trust it in the canonical', async () => {
    const { fake, adapter } = rig();
    const result = await adapter.commit(receiptCommand({ recorded_by: 'forged-user' }));
    expect(result.canonical).toMatchObject({ recorded_by_id: 'jwt-user' });
    expect(JSON.stringify(fake.calls)).not.toContain('forged-user');
  });
});
