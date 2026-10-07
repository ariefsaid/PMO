import { describe, expect, it } from 'vitest';
import en from '../../public/locales/en/common.json';
import id from '../../public/locales/id/common.json';

describe('work-order billing copy (OD-BILL-1)', () => {
  it.each([['en', en], ['id', id]] as const)('AC-BWO-004 %s: the "not invoiced" pill and the still-to-invoice amount read differently', (_l, catalogue) => {
    const b = catalogue.projectDetail.workOrders.billing;
    expect(b.status.notInvoiced).not.toBe(b.stillToInvoice);
    expect(b.lineRemaining.replace(' {{amount}}', '')).not.toBe(b.status.notInvoiced);
  });
});
