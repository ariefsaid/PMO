/**
 * AC-EXT-002 scope fence (#769): the external reference is PMO-only — it is NOT pushed to the ERP.
 * Every PR / PO / vendor-invoice push body is built from an explicit field list, so a record that
 * carries `external_ref` / `externalRef` must produce a body with no trace of it.
 */
import { describe, expect, it } from 'vitest';
import type { PmoRecord } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { mrToBody } from './materialRequest.ts';
import { poToBody } from './purchaseOrder.ts';
import { piToBody } from './purchaseInvoice.ts';

const CTX: ErpCtx = {
  refs: { supplier: 'Supplier' },
  config: {
    company: 'Co', default_cash_account: null, default_bank_account: null,
    default_payable_account: null, default_warehouse: null, default_uom: 'Nos',
  },
} as unknown as ErpCtx;

const SENTINEL = 'GROUP-REF-SENTINEL-0026100001';
const record: PmoRecord = {
  id: 'pmo-1',
  external_ref: SENTINEL,
  externalRef: SENTINEL,
  items: [{ item_code: 'ITEM', qty: 1, rate: 10, schedule_date: '2026-01-01' }],
};

describe('AC-EXT-002: the external reference is never in an ERP push body', () => {
  it.each([
    ['purchase request (Material Request)', mrToBody],
    ['purchase order', poToBody],
    ['vendor invoice (Purchase Invoice)', piToBody],
  ])('%s body has no external_ref field and no trace of its value', (_name, toBody) => {
    const body = toBody(record, CTX);
    const json = JSON.stringify(body);
    expect(json).not.toContain(SENTINEL);
    expect(json).not.toMatch(/external_?ref/i);
  });
});
