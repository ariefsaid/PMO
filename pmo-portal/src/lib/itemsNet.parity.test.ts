/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useErpVendorTax } from '@/src/hooks/useVendorBillTax';
import { buildEnteredPurchaseTaxRows } from './adapterSeam/erpnext/erpPurchaseTaxRows';
import { itemsNetTotal } from './itemsNet';
import { previewInvoiceDraft } from './revenue/nativeInvoice';

const sql = readFileSync('../supabase/tests/line_pricing_parity.test.sql', 'utf8');
const vectors: Array<{ name: string; items: Array<{ qty: number; rate: number }>; total: number; native: boolean }> =
  JSON.parse(sql.split('$vectors$')[1]);

describe('shared line-pricing vectors', () => {
  for (const vector of vectors) {
    it(vector.name, () => {
      expect(itemsNetTotal(vector.items)).toBe(vector.total);
      if (vector.native) expect(previewInvoiceDraft(vector.items, null).subtotal).toBe(vector.total);
    });
  }
});

it('accepts a withholding equal to the rounded line total', () => {
  const { result } = renderHook(() => useErpVendorTax({ vendor: null, enabled: true, itemsNet: itemsNetTotal([{ qty: 0.29, rate: 0.5 }]) }));
  act(() => { result.current.vat.onChange('0'); result.current.withholding.pphType.onChange('pph23'); });
  act(() => { result.current.withholding.withheld.onChange('0.15'); });
  expect(result.current.amounts?.withheldAmount).toBe(0.15);
  expect(result.current.withheldAboveItems).toBe(false);
});

it('keeps native draft bounds and signed commands distinct', () => {
  expect(previewInvoiceDraft([{ qty: 1, rate: 1e12 }], null).reason).toBe('invalid-lines');
  expect(previewInvoiceDraft([{ qty: -1, rate: 1 }], null).reason).toBe('invalid-lines');
  expect(itemsNetTotal([{ qty: -1, rate: 1 }])).toBe(-1);
  expect(itemsNetTotal([{ quantity: '0.29', rate: '0.50' }])).toBe(0.15);
});

it('accepts the same withheld amount at the ERP dispatch boundary', async () => {
  const rows = await buildEnteredPurchaseTaxRows(
    { baseUrl: 'https://erp.example.test', apiKey: 'test', apiSecret: 'test',
      fetchImpl: async () => Response.json({ data: { company: 'Example', is_group: 0, root_type: 'Liability' } }) },
    'Example', { vatAmount: 0, withheldAmount: 0.15, pphType: 'pph23' },
    { inputVat: null, pph23: 'PPh', pph4_2: null }, itemsNetTotal([{ qty: 0.29, rate: 0.5 }]),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].tax_amount).toBe(0.15);
});
