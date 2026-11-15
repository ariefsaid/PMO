import { describe, expect, it } from 'vitest';
import { HOLD_CAUSES, isHoldCause, plainHoldReason, type HoldCause } from './holdReason';
import { transferReferenceOf } from './verdict';

const FINISHED: Array<[HoldCause, string]> = [
  ['wizard-partial', 'it asked to confirm a partial quantity'],
  ['wizard-immediate', 'it asked to confirm an immediate transfer'],
  ['wizard-other', 'it asked for a confirmation'],
  ['moves-differ', 'its lines differ from this document'],
  ['lines-differ', 'its lines differ from this document'],
  ['quantity-differs', 'the quantity moved differs from this document'],
  ['locations-differ', 'it moved between other locations than this document names'],
  ['cancelled', 'it was cancelled in Odoo'],
  ['other-company', 'it belongs to another Odoo company'],
  ['no-value', 'Odoo did not report a value for it'],
  ['no-project-cost', 'Odoo did not book the project cost'],
  ['odoo-refused', 'Odoo refused one of its steps'],
  ['anchor-ambiguous', 'Odoo holds more than one transfer for this document'],
  ['anchor-missing', 'the transfer Odoo points to cannot be found'],
];

describe('AC-OSP-007 a hold is told in plain words, from its typed cause', () => {
  it.each(FINISHED)('%s names the transfer and says why', (cause, why) => {
    expect(plainHoldReason(cause, 'WH/INT/00012')).toBe(`Odoo did not finish transfer WH/INT/00012: ${why}. Check it in Odoo.`);
  });

  it('without a reference it says "this transfer"', () => {
    expect(plainHoldReason('cancelled')).toBe('Odoo did not finish this transfer: it was cancelled in Odoo. Check it in Odoo.');
    expect(plainHoldReason('not-checked', 'WH/INT/00012')).toBe('Odoo needs a manual check of transfer WH/INT/00012.');
    expect(plainHoldReason('not-checked')).toBe('Odoo needs a manual check of this transfer.');
  });

  it('no transfer found says it cannot be told whether one was sent', () => {
    expect(plainHoldReason('no-transfer-found')).toMatch(/Odoo shows no transfer for this document, so it cannot be told whether one was sent/);
  });

  it('every cause has a sentence, and none shows a model name or a database id', () => {
    for (const cause of HOLD_CAUSES) {
      const text = plainHoldReason(cause, 'WH/INT/1');
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toMatch(/stock\.|picking \d|\b\d{2,}\b/);
    }
    expect(HOLD_CAUSES.every(isHoldCause)).toBe(true);
    expect(isHoldCause('a made-up cause')).toBe(false);
  });

  it('the reference is the picking name; a failed read leaves it out', async () => {
    expect(await transferReferenceOf((async () => [{ name: 'WH/INT/00012' }]) as never, 7)).toBe('WH/INT/00012');
    expect(await transferReferenceOf((async () => { throw new Error('down'); }) as never, 7)).toBeNull();
  });
});
