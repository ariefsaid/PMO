import { describe, expect, it } from 'vitest';
import { plainHoldReason } from './holdReason';
import { transferReferenceOf } from './recovery';

describe('AC-OSP-007 a hold is told in plain words', () => {
  it.each([
    ['Validation of stock picking 4 needs the wizard "stock.backorder.confirmation". Manual intervention required in Odoo.', 'it asked to confirm a partial quantity'],
    ['Validation of stock picking 4 needs the wizard "stock.immediate.transfer".', 'it asked to confirm an immediate transfer'],
    ['Validation of stock picking 4 needs the wizard "other.wizard".', 'it asked for a confirmation'],
    ['STK_EVIDENCE_QUANTITY: completed quantity 3 does not match intent 4 for product 9', 'the quantity moved differs from this document'],
    ['STK_EVIDENCE_CANCELLED: picking was cancelled in ERP', 'it was cancelled in Odoo'],
    ['STK_EVIDENCE_VALUATION: unreadable valuation on transfer moves', 'Odoo did not report a value for it'],
  ])('%s', (raw, cause) => {
    expect(plainHoldReason(raw, 'WH/INT/00012')).toBe(`Odoo did not finish transfer WH/INT/00012: ${cause}. Check it in Odoo.`);
  });

  it('without a reference it says "this transfer"; an unknown cause says a manual check is needed', () => {
    expect(plainHoldReason('STK_EVIDENCE_CANCELLED: x')).toBe('Odoo did not finish this transfer: it was cancelled in Odoo. Check it in Odoo.');
    expect(plainHoldReason('anything else')).toBe('Odoo needs a manual check of this transfer.');
  });

  it('never shows a model name or a database id', () => {
    const text = plainHoldReason('Validation of stock picking 4 needs the wizard "stock.backorder.confirmation".', 'WH/INT/1');
    expect(text).not.toMatch(/stock\.|picking 4|\b4\b/);
  });

  it('the reference is the picking name; a failed read leaves it out', async () => {
    expect(await transferReferenceOf((async () => [{ name: 'WH/INT/00012' }]) as never, 7)).toBe('WH/INT/00012');
    expect(await transferReferenceOf((async () => { throw new Error('down'); }) as never, 7)).toBeNull();
  });
});
