import { describe, expect, it } from 'vitest';
import { buildReceiptBody, type ReceiptDefaults, type ReceiptInput, type ReceiptInvoice } from './receiptBody.ts';

const RECEIPT_ID = '123e4567-e89b-12d3-a456-426614174000';
const invoice: ReceiptInvoice = { id: 'inv-1', orgId: 'A', customerId: 'cust-1', state: 'posted', outstanding: '111000.00', currency: 'IDR' };
const defaults: ReceiptDefaults = { companyCurrency: 'IDR', partners: { 'cust-1': 41 }, journalId: 9, inboundMethodLineId: 31, taxPrepaidAccountId: 88, accountCurrencies: { receivable: 'IDR', cash: 'IDR', taxPrepaid: 'IDR' } };
const receipt: ReceiptInput = { id: RECEIPT_ID, orgId: 'A', date: '2026-11-05', currency: 'IDR', settled: 111000, cash: 111000 };
const build = (r: Partial<ReceiptInput> = {}, i: ReceiptInvoice | null = invoice, d: ReceiptDefaults = defaults, recorder = 'user-jwt') =>
  buildReceiptBody({ ...receipt, ...r }, i, d, recorder);
const refusal = (thing: string, code = 'config-rejected') => ({ outcome: 'refused', code, thing });

describe('AC-OCI-041 one receipt settles one posted invoice of the caller\'s tenant, in company currency', () => {
  it('builds the inbound customer payment, memo carrying the anchor, in the chosen journal', () => {
    expect(build()).toEqual({
      outcome: 'ready', recordedBy: 'user-jwt', writeOff: null,
      body: { payment_type: 'inbound', partner_type: 'customer', partner_id: 41, amount: 111000, date: '2026-11-05', journal_id: 9, payment_method_line_id: 31, memo: `pmo:ip:${RECEIPT_ID}` },
    });
  });
  it('a per-receipt journal overrides the org default; with neither the receipt refuses', () => {
    expect((build({ journalId: 12 }) as { body: Record<string, unknown> }).body.journal_id).toBe(12);
    expect(build({}, invoice, { ...defaults, journalId: null })).toMatchObject(refusal('journal'));
  });
  it('refuses a journal with no inbound payment method before any ERP write', () => {
    expect(build({}, invoice, { ...defaults, inboundMethodLineId: null })).toMatchObject(refusal('journal-method'));
  });
  it.each([
    ['no invoice reference', null, refusal('invoice')],
    ['an unposted invoice', { ...invoice, state: 'draft' }, refusal('invoice-not-posted')],
    ['another tenant\'s invoice', { ...invoice, orgId: 'B' }, refusal('invoice', 'cross-org-link-rejected')],
    ['a currency other than the company\'s', { ...invoice, currency: 'USD' }, refusal('currency')],
    ['an invoice whose customer is unmapped', { ...invoice, customerId: 'cust-x' }, refusal('client')],
  ])('refuses %s before any write', (_l, inv, expected) => {
    expect(build({}, inv as ReceiptInvoice | null)).toMatchObject(expected);
  });
  it('refuses a receipt in another currency than the company\'s', () => {
    expect(build({ currency: 'USD' })).toMatchObject(refusal('currency'));
  });
  it.each(['', '2026-02-30', '03/11/2026'])('refuses an invalid receipt date %s before any write', (date) => {
    expect(build({ date })).toMatchObject(refusal('date'));
  });
});

describe('AC-OCI-040 0 < amount <= outstanding (Odoo accepts an over-receipt, so this is the only guard)', () => {
  it.each([[111000, true], [40000, true], [71000, true], [0.01, true], [111000.01, false], [112000, false], [0, false], [-5, false], ['x', false]] as const)('settled %s → ready: %s', (settled, ok) => {
    expect(build({ settled, cash: settled as never }).outcome === 'ready').toBe(ok);
  });
  it('the outstanding drops as receipts land: 40,000 then 71,000 settle 111,000 in two, a third is refused', () => {
    expect(build({ settled: 40000, cash: 40000 }).outcome).toBe('ready');
    expect(build({ settled: 71000, cash: 71000 }, { ...invoice, outstanding: '71000.00' }).outcome).toBe('ready');
    expect(build({ settled: 1, cash: 1 }, { ...invoice, outstanding: '0.00' })).toMatchObject(refusal('over-receipt'));
  });
  it('names over-receipt distinctly from a non-positive amount', () => {
    expect(build({ settled: 112000, cash: 112000 })).toMatchObject(refusal('over-receipt'));
    expect(build({ settled: 0, cash: 0 })).toMatchObject(refusal('amount'));
  });
});

describe('AC-OCI-045 tax withheld by the client: cash + withheld = settled, each rule refuses before any write', () => {
  const withheld: Partial<ReceiptInput> = { settled: 111000, cash: 109000, withheld: 2000, slipNumber: 'BP-2026-001' };
  it('books the withheld part as the payment difference on the tax-prepaid account; cash is the payment amount', () => {
    expect(build(withheld)).toEqual({
      outcome: 'ready', recordedBy: 'user-jwt',
      writeOff: { accountId: 88, amount: 2000, label: 'BP-2026-001' },
      body: { payment_type: 'inbound', partner_type: 'customer', partner_id: 41, amount: 109000, date: '2026-11-05', journal_id: 9, payment_method_line_id: 31, memo: `pmo:ip:${RECEIPT_ID}` },
    });
  });
  it.each([
    ['no tax-prepaid account', withheld, { ...defaults, taxPrepaidAccountId: null }, 'tax-prepaid-account'],
    ['no bukti-potong number', { ...withheld, slipNumber: '  ' }, defaults, 'withholding-slip'],
    ['an over-long bukti-potong number', { ...withheld, slipNumber: 'x'.repeat(141) }, defaults, 'withholding-slip'],
    ['accounts in different currencies', withheld, { ...defaults, accountCurrencies: { receivable: 'IDR', cash: 'USD', taxPrepaid: 'IDR' } }, 'account-currency'],
    ['the tax-prepaid account in a different currency', withheld, { ...defaults, accountCurrencies: { receivable: 'IDR', cash: 'IDR', taxPrepaid: 'USD' } }, 'account-currency'],
    ['all settlement accounts outside company currency', withheld, { ...defaults, accountCurrencies: { receivable: 'USD', cash: 'USD', taxPrepaid: 'USD' } }, 'account-currency'],
    ['cash + withheld above settled', { ...withheld, cash: 110000 }, defaults, 'amounts'],
    ['cash + withheld below settled', { ...withheld, cash: 108000 }, defaults, 'amounts'],
    ['a negative withheld amount', { ...withheld, withheld: -2000, cash: 113000 }, defaults, 'amounts'],
    ['cash short of settled with nothing withheld', { settled: 111000, cash: 109000 }, defaults, 'amounts'],
  ] as const)('refuses %s', (_l, patch, d, thing) => {
    expect(build(patch as Partial<ReceiptInput>, invoice, d as ReceiptDefaults)).toMatchObject(refusal(thing));
  });
  it('a withheld receipt must settle the whole outstanding: partial + withheld is refused, full + withheld is ready', () => {
    expect(build({ settled: 70000, cash: 68000, withheld: 2000, slipNumber: 'BP-1' })).toMatchObject(refusal('withheld-partial'));
    expect(build({ settled: 111000, cash: 109000, withheld: 2000, slipNumber: 'BP-1' }).outcome).toBe('ready');
    expect(build({ settled: 70000, cash: 70000 }).outcome).toBe('ready');
  });
  it('withheld still cannot take the settled amount above the outstanding', () => {
    expect(build({ settled: 112000, cash: 110000, withheld: 2000, slipNumber: 'BP-1' })).toMatchObject(refusal('over-receipt'));
  });
});

describe('AC-OCI-046 the recorder is the verified subject, never the payload', () => {
  it('ignores a payload recorder and returns the subject passed in', () => {
    const forged = { ...receipt, recorded_by: 'attacker', recordedBy: 'attacker' } as unknown as ReceiptInput;
    const result = buildReceiptBody(forged, invoice, defaults, 'jwt-subject');
    expect(result).toMatchObject({ outcome: 'ready', recordedBy: 'jwt-subject' });
    expect(JSON.stringify(result)).not.toContain('attacker');
  });
});

describe('invalid receipt keys never build', () => {
  it('refuses an id that is not a uuid (the anchor key would be invalid), never throws', () => {
    expect(build({ id: 'not-a-uuid' })).toMatchObject(refusal('receipt'));
  });
});
