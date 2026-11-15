import { describe, expect, it } from 'vitest';
import { OdooError, type OdooCall } from '../client.ts';
import { recoverStockPicking } from './recovery.ts';
import { createOdooStockAdapter } from './stockAdapter.ts';
import { DOC, ISSUE_INTENT, stockBed, TRANSFER_INTENT, type StockBed } from './stockFixtures.ts';

const command = { domain: 'inventory', operation: 'create' as const, record: { id: DOC, erp_doc_kind: 'stock-document' }, idempotencyKey: `stock:${DOC}` };
const writeCalls = (bed: StockBed) => bed.seen.filter((c) => /\/(load|write|button_validate|create|unlink)$/.test(c));
const commitWith = (bed: StockBed, intent = TRANSFER_INTENT) =>
  createOdooStockAdapter({ call: bed.call, loadIntent: async () => ({ ok: true, intent }) }).commit(command);

describe('AC-OSP-004 recoverStockPicking resolves every crash window from the anchor alone', () => {
  it('AC-OSP-004 W1 a lost load answer: the anchored draft is completed once and adopted', async () => {
    const bed = stockBed();
    bed.fake.failAt('after-load');
    await expect(commitWith(bed)).rejects.toMatchObject({ code: 'external-unreachable' });
    bed.seen.length = 0;

    const hit = await recoverStockPicking(bed.call, TRANSFER_INTENT);

    expect(hit?.externalRecordId).toMatch(/^stock\.picking:\d+$/);
    expect(hit?.canonical).toMatchObject({ id: DOC, state: 'confirmed', completedQuantity: 11 });
    expect(bed.seen.filter((c) => c === 'stock.picking/load')).toHaveLength(0);
    expect(bed.seen.filter((c) => c === 'stock.picking/button_validate')).toHaveLength(1);
    expect(bed.fake.rows('stock.picking')).toHaveLength(1);
  });

  it('AC-OSP-004 W1 no anchor at all: the probe answers null and writes nothing (the dispatcher holds a quarantined row)', async () => {
    const bed = stockBed();
    expect(await recoverStockPicking(bed.call, TRANSFER_INTENT)).toBeNull();
    expect(writeCalls(bed)).toHaveLength(0);
  });

  it('AC-OSP-004 W2 an anchored draft whose quantities were never entered is completed', async () => {
    const bed = stockBed();
    const { sendStockPicking } = await import('./picking.ts');
    await sendStockPicking(bed.call, { anchorKey: `stock:${DOC}`, companyId: 1, pickingTypeId: 5, lines: TRANSFER_INTENT.lines, src: 10, dest: 20 });

    const hit = await recoverStockPicking(bed.call, TRANSFER_INTENT);

    expect(hit?.canonical).toMatchObject({ state: 'confirmed' });
    expect(bed.seen.filter((c) => c === 'stock.move/write')).toHaveLength(2);
  });

  it('AC-OSP-004 W3 a lost validate answer: the done picking is read back and adopted with no write', async () => {
    const bed = stockBed();
    bed.fake.failAt('after-validate');
    await expect(commitWith(bed)).rejects.toMatchObject({ code: 'external-unreachable' });
    bed.seen.length = 0;

    const hit = await recoverStockPicking(bed.call, TRANSFER_INTENT);

    expect(hit?.canonical).toMatchObject({ state: 'confirmed', completedQuantity: 11 });
    expect(writeCalls(bed)).toHaveLength(0);
  });

  it('AC-OSP-004 W4 a repeated probe gives the same answer and writes nothing', async () => {
    const bed = stockBed();
    await commitWith(bed);
    bed.seen.length = 0;

    const first = await recoverStockPicking(bed.call, TRANSFER_INTENT);
    const second = await recoverStockPicking(bed.call, TRANSFER_INTENT);

    expect(second).toEqual(first);
    expect(writeCalls(bed)).toHaveLength(0);
  });

  it('AC-OSP-004 W5 a look-alike picking without our anchor is ignored', async () => {
    const bed = stockBed();
    bed.fake.seed('stock.picking', [{ id: 900, name: 'WH/MOVE/00900', state: 'done', company_id: 1, location_id: 10, location_dest_id: 20, move_ids: [], origin: DOC }]);

    expect(await recoverStockPicking(bed.call, TRANSFER_INTENT)).toBeNull();
    expect(writeCalls(bed)).toHaveLength(0);
  });

  it('AC-OSP-004 W6 a corrupted anchor is refused with no write: two rows, another model, a missing target', async () => {
    const two = stockBed();
    await commitWith(two);
    const anchor = two.fake.rows('ir.model.data')[0];
    two.fake.seed('ir.model.data', [{ ...anchor, id: 999 }]);
    two.seen.length = 0;
    await expect(recoverStockPicking(two.call, TRANSFER_INTENT)).rejects.toMatchObject({ code: 'commit-rejected', message: expect.stringContaining('ambiguous'), heldCause: 'anchor-ambiguous' });
    expect(writeCalls(two)).toHaveLength(0);

    const wrongModel = stockBed();
    await commitWith(wrongModel);
    wrongModel.fake.seed('ir.model.data', [{ ...wrongModel.fake.rows('ir.model.data')[0], model: 'purchase.order' }]);
    await expect(recoverStockPicking(wrongModel.call, TRANSFER_INTENT)).rejects.toMatchObject({ code: 'commit-rejected' });

    const missing = stockBed();
    await commitWith(missing);
    missing.fake.seed('ir.model.data', [{ ...missing.fake.rows('ir.model.data')[0], res_id: 4242 }]);
    await expect(recoverStockPicking(missing.call, TRANSFER_INTENT)).rejects.toMatchObject({ code: 'commit-rejected', message: expect.stringContaining('missing'), heldCause: 'anchor-missing', heldPickingId: 4242 });
  });

  it('AC-OSP-004 an anchored picking of another company or other locations is refused with no write', async () => {
    for (const intent of [{ ...TRANSFER_INTENT, companyId: 2 }, { ...TRANSFER_INTENT, destinationLocationId: 21 }]) {
      const bed = stockBed();
      bed.fake.failAt('after-load');
      await commitWith(bed).catch(() => undefined);
      bed.seen.length = 0;
      await expect(recoverStockPicking(bed.call, intent)).rejects.toMatchObject({ code: 'commit-rejected' });
      expect(writeCalls(bed)).toHaveLength(0);
    }
  });

  it('AC-OSP-004 a draft whose moves differ is held, never completed', async () => {
    const bed = stockBed();
    bed.fake.failAt('after-load');
    await commitWith(bed).catch(() => undefined);
    bed.seen.length = 0;

    await expect(recoverStockPicking(bed.call, { ...TRANSFER_INTENT, lines: [{ productId: 101, quantity: 9 }, { productId: 102, quantity: 3 }] })).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(writeCalls(bed)).toHaveLength(0);
  });

  it('AC-OSP-004 concurrent probes complete the same anchored draft once (second sees done)', async () => {
    const bed = stockBed();
    bed.fake.failAt('after-load');
    await commitWith(bed).catch(() => undefined);
    bed.seen.length = 0;

    const first = await recoverStockPicking(bed.call, TRANSFER_INTENT);
    const second = await recoverStockPicking(bed.call, TRANSFER_INTENT);

    expect(second).toEqual(first);
    expect(bed.seen.filter((c) => c === 'stock.picking/button_validate')).toHaveLength(1);
  });

  it('AC-OSP-004 an issue is recovered against its project cost lines', async () => {
    const bed = stockBed();
    bed.fake.failAt('after-validate');
    await commitWith(bed, ISSUE_INTENT).catch(() => undefined);
    bed.seen.length = 0;

    const hit = await recoverStockPicking(bed.call, ISSUE_INTENT);

    expect(hit?.canonical).toMatchObject({ state: 'confirmed', completedValue: -110 });
    expect(writeCalls(bed)).toHaveLength(0);
  });

  it('AC-OSP-004 a done picking Odoo valued differently from the document is held, not adopted', async () => {
    const bed = stockBed();
    await commitWith(bed);
    bed.fake.rows('stock.move')[0].quantity = 7;
    await expect(recoverStockPicking(bed.call, TRANSFER_INTENT)).rejects.toMatchObject({ code: 'commit-rejected', message: expect.stringContaining('STK_EVIDENCE_QUANTITY'), heldCause: 'quantity-differs', heldPickingId: expect.any(Number) });
  });

  it('AC-OSP-004 a transport failure while probing is external-unreachable (retry later), not a hold', async () => {
    const bed = stockBed((inner) => (async <T>(model: string, method: string, body?: Record<string, unknown>) => {
      if (model === 'ir.model.data') throw new OdooError('unreachable');
      return inner<T>(model, method, body);
    }) as OdooCall);
    await expect(recoverStockPicking(bed.call, TRANSFER_INTENT)).rejects.toMatchObject({ code: 'external-unreachable' });
  });

  it('AC-OSP-004 a cancelled anchored picking is held', async () => {
    const bed = stockBed();
    await commitWith(bed);
    bed.fake.rows('stock.picking')[0].state = 'cancel';
    await expect(recoverStockPicking(bed.call, TRANSFER_INTENT)).rejects.toMatchObject({ code: 'commit-rejected', heldCause: 'cancelled', heldPickingId: expect.any(Number) });
  });
});
