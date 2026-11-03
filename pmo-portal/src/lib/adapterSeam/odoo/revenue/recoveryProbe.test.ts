import { describe, expect, it } from 'vitest';
import { bindCall } from '../client.ts';
import { createFakeOdoo } from '../fakeOdoo.ts';
import { externalIdentifier } from './anchors.ts';
import { probeInvoiceByAnchor } from './recoveryProbe.ts';

const KEY = 'si:77777777-7777-4777-8777-777777777777';
const OTHER = 'si:88888888-8888-4888-8888-888888888888';
const COMPOSITE = { partnerId: 41, createdAfter: '2000-01-01 00:00:00' };

function rig() {
  const fake = createFakeOdoo({ key: 'k' });
  fake.seed('res.partner', [{ id: 41, name: 'Client' }, { id: 42, name: 'Other client' }]);
  const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: fake.fetch });
  const invoice = async (partner = 41) => (await call<number[]>('account.move', 'create', { vals_list: [{ move_type: 'out_invoice', partner_id: partner, invoice_date: '2026-11-03', invoice_line_ids: [] }] }))[0];
  const anchor = async (key: string, id: number) => call('ir.model.data', 'create', { vals_list: [{ ...externalIdentifier(key), model: 'account.move', res_id: id }] });
  return { fake, call, invoice, anchor };
}

describe('AC-OCI-011 the invoice anchor is a stock external identifier; a composite only ever raises doubt', () => {
  it('finds the invoice by its identifier, model-qualified', async () => {
    const { call, invoice, anchor } = rig();
    const id = await invoice();
    await anchor(KEY, id);
    expect(await probeInvoiceByAnchor(call, KEY)).toEqual({ externalRecordId: `account.move:${id}` });
  });

  it('finds nothing for a key that was never written, with or without a composite and no look-alike', async () => {
    const { call } = rig();
    expect(await probeInvoiceByAnchor(call, KEY)).toBeNull();
    expect(await probeInvoiceByAnchor(call, KEY, COMPOSITE)).toBeNull();
  });

  it('another invoice\'s identifier is not ours: a different key finds nothing, and an identifier on another model is ignored', async () => {
    const { call, invoice, anchor } = rig();
    await anchor(OTHER, await invoice());
    expect(await probeInvoiceByAnchor(call, KEY)).toBeNull();
    await call('ir.model.data', 'create', { vals_list: [{ ...externalIdentifier(KEY), model: 'purchase.order', res_id: 1 }] });
    expect(await probeInvoiceByAnchor(call, KEY)).toBeNull();
  });

  it('an unanchored invoice of our client in the window is DOUBT, never adopted (it may be an accountant\'s own)', async () => {
    const { call, invoice } = rig();
    await invoice();
    await expect(probeInvoiceByAnchor(call, KEY, COMPOSITE)).rejects.toThrow('ambiguous-anchor');
  });

  it('the composite is not consulted without a recovery: a first attempt looks by identifier alone', async () => {
    const { call, invoice } = rig();
    await invoice();
    expect(await probeInvoiceByAnchor(call, KEY)).toBeNull();
  });

  it('anchored invoices of the client belong to their own commands and are not doubt; another client\'s and an out-of-window invoice are not candidates', async () => {
    const { call, invoice, anchor, fake } = rig();
    await anchor(OTHER, await invoice());
    await invoice(42);
    expect(await probeInvoiceByAnchor(call, KEY, COMPOSITE)).toBeNull();
    expect(fake.calls.length).toBeGreaterThan(0);
    await invoice();
    await expect(probeInvoiceByAnchor(call, KEY, { partnerId: 41, createdAfter: '2999-01-01 00:00:00' })).resolves.toBeNull();
  });

  it('two invoices carrying our identifier are ambiguous', async () => {
    const { call, invoice, fake } = rig();
    const [a, b] = [await invoice(), await invoice()];
    fake.seed('ir.model.data', [{ id: 901, ...externalIdentifier(KEY), model: 'account.move', res_id: a }, { id: 902, ...externalIdentifier(KEY), model: 'account.move', res_id: b }]);
    await expect(probeInvoiceByAnchor(call, KEY)).rejects.toThrow('ambiguous-anchor');
  });

  it('a key that is not an invoice key never reaches Odoo (a receipt key, a bill key, free text)', async () => {
    const { call, fake } = rig();
    for (const bad of ['ip:77777777-7777-4777-8777-777777777777', 'bill:77777777-7777-4777-8777-777777777777', "si:x' or 1=1", '']) {
      await expect(probeInvoiceByAnchor(call, bad)).rejects.toThrow();
    }
    expect(fake.calls).toEqual([]);
  });
});
