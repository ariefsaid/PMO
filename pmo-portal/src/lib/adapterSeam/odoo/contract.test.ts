/**
 * AC-ODC-095 — Odoo's identity and declarations. The shared suites it declares supported are run for it by
 * `contractSuite/tiers.contract.test.ts` (one runner for every tier, so none can leave suites out).
 * Odoo-only wire-format tests stay in their own files (FR-ECA-051).
 */
import { describe, expect, it } from 'vitest';
import { SUITES } from '../contractSuite/index.ts';
import { purchaseOrderReviseSuite } from '../contractSuite/purchaseOrderRevise.suite.ts';
import { TIER_HARNESSES } from '../contractSuite/tiers.ts';
import { createOdooRevenueHarness } from './contract.harness.ts';
import { checkCostAccount, moneyHeader } from './revenue/moneyHeader.ts';
import { invoiceStatus } from './revenue/status.ts';
import { ODOO_WORKFLOWS } from './workflowDeclarations.ts';

const harness = TIER_HARNESSES.odoo;

// Pending revenue workflows only run through the tier-wide runner after their declaration is supported.
purchaseOrderReviseSuite(harness);

describe('odoo contract', () => {
  it('declares itself as the odoo tier', () => {
    expect(harness.tier).toBe('odoo');
  });

  it('AC-ODC-095 has a shared suite for every workflow it declares supported, and supports the master sends and party match', () => {
    const supported = Object.entries(ODOO_WORKFLOWS).filter(([, d]) => d.status === 'supported').map(([id]) => id);
    expect(supported).toEqual(expect.arrayContaining(['party.match', 'party.send', 'project.send', 'item.send']));
    for (const id of supported) expect(SUITES, id).toHaveProperty([id]);
  });

  it('refuses workflows it has not built yet instead of pretending', async () => {
    expect(() => harness.resolveProjectLink({}, 'x')).toThrow(/pending/);
    await expect(harness.pushBudget({ account: 'a', fiscalYear: '2026', occupant: 'none' })).rejects.toThrow(/pending/);
    await expect(harness.pushTimesheet({ employeeLink: 'confirmed', entries: [], activityType: 'configured' })).rejects.toThrow(/pending/);
    await expect(harness.pushBudgetVersion({ categories: [], mappedCategories: [], project: 'own' })).rejects.toThrow(/pending/);
    await expect(harness.readActuals({ ledger: [], projectLinks: {} })).rejects.toThrow(/pending/);
  });
  it('AC-OPP-084 declares every proven P9 workflow at its shared suite version', async () => {
    for (const id of ['purchase.link-existing', 'cutover.purchase', 'cutover.activation'] as const) {
      expect(ODOO_WORKFLOWS[id]).toEqual({ status: 'supported', version: 1 });
      expect(SUITES, id).toHaveProperty([id]);
    }
    for (const id of ['purchase.push', 'bill.push', 'vendor-payment.push', 'purchase-order.revise'] as const) {
      expect(ODOO_WORKFLOWS[id]).toEqual({ status: 'pending', version: 1, issue: 1505 });
    }
    expect(await harness.pushPurchase('activated')).toMatchObject({ outcome: 'pushed' });
    expect(await harness.pushProcurement({ doc: 'bill', caller: 'A', procurement: 'B' })).toMatchObject({ outcome: 'refused', erpCalls: 0 });
    expect(await harness.mirrorPurchases([{ kind: 'bill', reference: 'B1', supplier: 'Vendor', total: 10, modifiedAt: '2026-01-01' }])).toEqual([{ kind: 'bill', reference: 'B1', total: '10.00' }]);
  });

  it('AC-OPP-084 sends owned Odoo purchases through the shipped production adapter', async () => {
    for (const scenario of [
      { doc: 'purchase-order', caller: 'A', procurement: 'A' },
      { doc: 'bill', caller: 'B', procurement: 'B' },
      { doc: 'vendor-payment', caller: 'A', procurement: 'A', invoice: 'A' },
    ] as const) {
      const result = await harness.pushProcurement(scenario);
      expect(result.outcome, JSON.stringify(result)).toBe('accepted');
      expect(result.erpCalls).toBeGreaterThan(0);
    }
  });

  it('AC-OPP-084 exposes the production refusal contract for foreign procurement links', async () => {
    const purchase = await harness.pushProcurement({ doc: 'purchase-order', caller: 'A', procurement: 'B' });
    const bill = await harness.pushProcurement({ doc: 'bill', caller: 'A', procurement: 'B' });
    const vendor = await harness.pushProcurement({ doc: 'purchase-order', caller: 'A', procurement: 'A', vendor: 'B' });
    const payment = await harness.pushProcurement({ doc: 'vendor-payment', caller: 'A', procurement: 'A', invoice: 'B' });

    expect(purchase).toMatchObject({ outcome: 'refused', code: 'commit-rejected', erpCalls: 0 });
    expect(bill).toMatchObject({ outcome: 'refused', code: 'commit-rejected', erpCalls: 0 });
    expect(vendor).toMatchObject({ outcome: 'refused', code: 'commit-rejected', erpCalls: 1 });
    expect(payment).toMatchObject({ outcome: 'refused', code: 'commit-rejected', erpCalls: 1 });
  });

  it('AC-OCI-094 keeps declarations honest about which shared suites exercise production code', () => {
    expect(ODOO_WORKFLOWS['invoice.push'].status).toBe('supported');
    expect(ODOO_WORKFLOWS['receipt.read']).toEqual({ status: 'pending', version: 1, issue: 1506 });
    expect(ODOO_WORKFLOWS['invoice.pair-existing']).toEqual({ status: 'pending', version: 1, issue: 1506 });
    expect(ODOO_WORKFLOWS['cutover.revenue']).toEqual({ status: 'pending', version: 1, issue: 1602 });
    expect(ODOO_WORKFLOWS['cutover.activation']).toEqual({ status: 'supported', version: 1 });
    expect(ODOO_WORKFLOWS['tax-document.read']).toEqual({ status: 'pending', version: 1, issue: 1506 });
  });

  it('AC-OCI-030 parses pair candidates through the production Odoo revenue feed', async () => {
    const row = await harness.mapInboundInvoice?.({
      client: 'Client A', number: 'INV/2026/00051', poRef: 'PO-51', total: '1110.00', taxAmount: '110.00', date: '2026-11-01', currency: 'IDR',
    });
    expect(row).toMatchObject({
      external_id: '1', name: 'INV/2026/00051',
      attrs: {
        partner_name: 'Client A', reference_number: 'PO-51', amount_total: '1110.00', amount_tax: '110.00', currency: 'IDR', date: '2026-11-01',
      },
    });
    expect(row).not.toHaveProperty('customer');
  });

  it('AC-OCI-071 classifies only inbound customer payments accepted by the production feed parser', () => {
    expect(harness.classifyPayment('received')).toEqual({ kind: 'receipt', domain: 'revenue', table: 'incoming_payments' });
    expect(harness.classifyPayment('paid')).toEqual({ kind: 'skipped' });
  });

  it('SD-5 the Odoo harness exposes the claim and receipt builders over the fake: build, create, post, read back, receive', async () => {
    const bed = createOdooRevenueHarness();
    bed.fake.seed('account.tax', [{ id: 5, name: '12% (Non-Luxury Good)', amount: 11 }]);
    bed.fake.seed('product.product', [{ id: 71, taxes_id: [], income_account_id: 149 }]);
    bed.fake.seed('res.partner', [{ id: 41, name: 'Client' }]);
    const built = bed.buildInvoiceBody({
      id: 'inv-1', customerId: 'cust-1', invoiceDate: '2026-11-03', currency: 'IDR', referenceNumber: 'PO-77',
      lines: [{ itemId: 'item-km', description: 'BoQ 1', quantity: 10, unitPrice: 100, unit: 'km' }],
    }, { companyCurrency: 'IDR', partners: { 'cust-1': 41 }, items: { 'item-km': { productId: 71, incomeAccountId: 149 } }, units: { km: 11 }, costAccountId: 4, taxIds: [5] });
    if (built.outcome !== 'ready') throw new Error('refused');
    const [id] = await bed.call<number[]>('account.move', 'create', { vals_list: [built.body] });
    await bed.call('account.move', 'action_post', { ids: [id] });
    const [move] = await bed.call<Array<Record<string, unknown>>>('account.move', 'read', { ids: [id], fields: ['state', 'amount_untaxed', 'amount_tax', 'amount_total', 'amount_residual'] });
    const lines = await bed.call<Array<{ id: number; display_type: string; analytic_distribution: Record<string, number> }>>('account.move.line', 'search_read', { domain: [['move_id', '=', id]], fields: ['display_type', 'analytic_distribution'] });
    expect(moneyHeader(move)).toEqual({ untaxed: '1000.00', tax: '110.00', total: '1110.00', outstanding: '1110.00' });
    expect(checkCostAccount(lines, 4)).toEqual({ outcome: 'ok' });
    expect(invoiceStatus(String(move.state), move.amount_residual as number).status).toBe('Unpaid');

    const receipt = bed.buildReceiptBody(
      { id: '123e4567-e89b-12d3-a456-426614174000', orgId: 'A', date: '2026-11-05', currency: 'IDR', settled: '1110.00' },
      { id: 'inv-1', orgId: 'A', customerId: 'cust-1', state: 'posted', outstanding: '1110.00', currency: 'IDR' },
      { companyCurrency: 'IDR', partners: { 'cust-1': 41 }, journalId: 9, inboundMethodLineId: 31, taxPrepaidAccountId: null }, 'jwt-subject',
    );
    if (receipt.outcome !== 'ready') throw new Error('refused');
    const context = { active_model: 'account.move', active_ids: [id] };
    const wizard = await bed.call<number[]>('account.payment.register', 'create', { vals_list: [{ amount: receipt.body.amount, journal_id: receipt.body.journal_id }], context });
    await bed.call('account.payment.register', 'action_create_payments', { ids: wizard, context });
    const [paid] = await bed.call<Array<Record<string, unknown>>>('account.move', 'read', { ids: [id], fields: ['state', 'amount_residual'] });
    expect(invoiceStatus(String(paid.state), paid.amount_residual as number).status).toBe('Paid');
  });
});
