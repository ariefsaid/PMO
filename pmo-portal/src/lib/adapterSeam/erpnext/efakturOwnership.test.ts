import { describe, expect, it } from 'vitest';
import type { PmoRecord } from '../contract.ts';
import type { ErpCtx } from './doctypeRegistry.ts';
import { ERP_CUSTOM_FIELDS } from './erpCustomFields.ts';
import { piToBody } from './bodies/purchaseInvoice.ts';
import { siToBody } from './bodies/salesInvoice.ts';

const CTX: ErpCtx = { refs: { customer: 'CUSTOMER-TEST', supplier: 'SUPPLIER-TEST' }, config: {} };
const opaqueEfakturFacts = {
  id: 'invoice-test',
  items: [{ item_code: 'ITEM-TEST', qty: 1, rate: 10 }],
  efaktur_number: '010.001-26.12345678',
  efaktur_date: '2026-10-01',
} as unknown as PmoRecord;

describe('DD-EFK-1 ERP ownership boundary', () => {
  it('AC-EFK-006 keeps PMO e-Faktur facts out of both ERP bodies and onboarding fields', () => {
    for (const body of [siToBody(opaqueEfakturFacts, CTX), piToBody(opaqueEfakturFacts, CTX)]) {
      expect(body).not.toHaveProperty('efaktur_number');
      expect(body).not.toHaveProperty('efaktur_date');
    }
    expect(ERP_CUSTOM_FIELDS.some((field) => /efaktur/i.test(field.fieldname))).toBe(false);
  });
});
