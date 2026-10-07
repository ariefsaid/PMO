import { describe, expect, it } from 'vitest';
import {
  itemsNetTotal, netOf, parseErpTaxAmounts, parseNativeWithholding, parseVendorTaxDefaultsDraft,
  suggestVat, suggestWithheld, vendorTaxDefaultOf, withholdingFigures,
} from './vendorWithholding';

describe('withholdingFigures (#876, DD-VWH-6, DD-VWH-20)', () => {
  it('AC-VWH-010 net payable is the gross bill minus the tax withheld, in exact cents', () => {
    expect(withholdingFigures(1110000, 110000, 20000, 'inclusive')).toEqual({ vat: 110000, withheld: 20000, netPayable: 1090000 });
    expect(withholdingFigures(1234567.89, 135802.47, 24691.36, 'inclusive')).toEqual({ vat: 135802.47, withheld: 24691.36, netPayable: 1209876.53 });
  });

  it('AC-VWH-010 no figures when nothing was withheld, a figure is unknown, or the basis is unknown', () => {
    expect(withholdingFigures(1110000, 110000, 0, 'inclusive')).toBeNull();
    expect(withholdingFigures(1110000, 110000, null, 'inclusive')).toBeNull();
    expect(withholdingFigures(1110000, 110000, undefined, 'inclusive')).toBeNull();
    expect(withholdingFigures(null, 110000, 20000, 'inclusive')).toBeNull();
    expect(withholdingFigures(1110000, null, 20000, 'inclusive')).toBeNull();
    expect(withholdingFigures(1110000, 110000, Number.NaN, 'inclusive')).toBeNull();
    expect(withholdingFigures(1110000, 110000, 20000, null)).toBeNull();
  });

  it('AC-VWH-010 a return (negative bill) keeps its sign', () => {
    expect(withholdingFigures(-1110000, -110000, -20000, 'inclusive')).toEqual({ vat: -110000, withheld: -20000, netPayable: -1090000 });
  });

  it('AC-VWH-026 a standalone bill recorded tax-exclusive: net payable = amount + VAT − withheld', () => {
    expect(withholdingFigures(1000000, 110000, 20000, 'exclusive')).toEqual({ vat: 110000, withheld: 20000, netPayable: 1090000 });
    expect(withholdingFigures(333333.33, 36666.67, 6666.67, 'exclusive')).toEqual({ vat: 36666.67, withheld: 6666.67, netPayable: 363333.33 });
  });
});

describe('vendor tax defaults and suggestions (#876 slice 2, DD-VWH-17)', () => {
  it('AC-VWH-025 the VAT suggested on a tax-exclusive amount is rate × amount, half-up to the cent', () => {
    expect(suggestVat(1000000, 'exclusive', 11)).toBe(110000);
    expect(suggestVat(333333.33, 'exclusive', 11)).toBe(36666.67);
  });

  it('AC-VWH-025 the VAT inside a tax-inclusive amount is amount × rate / (100 + rate)', () => {
    expect(suggestVat(1110000, 'inclusive', 11)).toBe(110000);
    expect(suggestVat(1000, 'inclusive', 12)).toBe(107.14);
  });

  it('AC-VWH-025 the PPh suggested is rate × the net (DPP), half-up to the cent', () => {
    expect(suggestWithheld(1000000, 2)).toBe(20000);
    expect(suggestWithheld(999999.99, 2)).toBe(20000);
    expect(suggestWithheld(333333.33, 1.75)).toBe(5833.33);
    // The exact half-cent rounds UP (0.25 × 2% = 0.005): never banker's rounding, never truncation.
    expect(suggestWithheld(0.25, 2)).toBe(0.01);
  });

  it('AC-VWH-025 the net is the amount when tax-exclusive and amount − VAT when tax-inclusive', () => {
    expect(netOf(1000000, 'exclusive', 110000)).toBe(1000000);
    expect(netOf(1110000, 'inclusive', 110000)).toBe(1000000);
  });

  it('AC-VWH-025 the items total before tax sums quantity × rate per line in cents; no lines is unknown', () => {
    expect(itemsNetTotal([{ quantity: 3, rate: 333333.33 }, { quantity: 1, rate: 0.01 }])).toBe(1000000);
    expect(itemsNetTotal([])).toBeNull();
  });

  it('AC-VWH-033 ONE formula serves both line spellings: the FE case rows (quantity) and the command items (qty)', () => {
    expect(itemsNetTotal([{ qty: 2, rate: 100 }])).toBe(200);
    expect(itemsNetTotal([{ quantity: 2, rate: 100 }])).toBe(200);
    expect(itemsNetTotal([{ quantity: 1, rate: 333333.33 }, { qty: 3, rate: 222222.22 }])).toBe(999999.99);
  });

  it('AC-VWH-033 an unpriced line or a missing quantity leaves the total unknown — never counted as 0', () => {
    expect(itemsNetTotal([{ qty: 2, rate: null }])).toBeNull();
    expect(itemsNetTotal([{ qty: 2 }])).toBeNull();
    expect(itemsNetTotal([{ quantity: null, rate: 100 }])).toBeNull();
    expect(itemsNetTotal([{ quantity: 'two', rate: 100 }])).toBeNull();
    expect(itemsNetTotal([{ quantity: 1, rate: 100 }, { quantity: 2 }])).toBeNull();
  });

  it('AC-VWH-025 a company row is a default only when it states a VAT rate or a complete withholding', () => {
    expect(vendorTaxDefaultOf({ default_vat_rate: 11, default_pph_type: 'pph23', default_pph_rate: 2 })).toEqual({ vatRate: 11, pphType: 'pph23', pphRate: 2 });
    expect(vendorTaxDefaultOf({ default_vat_rate: 0, default_pph_type: null, default_pph_rate: null })).toEqual({ vatRate: 0, pphType: null, pphRate: null });
    expect(vendorTaxDefaultOf({ default_vat_rate: null, default_pph_type: null, default_pph_rate: null })).toBeNull();
    expect(vendorTaxDefaultOf({ default_vat_rate: null, default_pph_type: 'pph21', default_pph_rate: 2 })).toBeNull();
    expect(vendorTaxDefaultOf(null)).toBeNull();
  });

  it('AC-VWH-025 entered ERP amounts: VAT is required (0 allowed); a withholding needs its amount', () => {
    expect(parseErpTaxAmounts('110000', 'pph23', '20000')).toEqual({ vatAmount: 110000, withheldAmount: 20000, pphType: 'pph23' });
    expect(parseErpTaxAmounts('0', '', 'ignored')).toEqual({ vatAmount: 0, withheldAmount: 0, pphType: null });
    expect(parseErpTaxAmounts('0', 'pph23', '0')).toEqual({ vatAmount: 0, withheldAmount: 0, pphType: null });
    expect(parseErpTaxAmounts('', '', '')).toBeNull();
    expect(parseErpTaxAmounts('110000', 'pph23', '')).toBeNull();
    expect(parseErpTaxAmounts('-1', '', '')).toBeNull();
    expect(parseErpTaxAmounts('110000', 'pph21', '1')).toBeNull();
  });

  it('AC-VWH-025 a standalone PPh: no type is none; a type needs its amount and a bill amount, and cannot exceed it (OQ-VWH-6)', () => {
    expect(parseNativeWithholding('', '', null)).toEqual({ withheldAmount: 0, pphType: null });
    expect(parseNativeWithholding('', 'ignored', null)).toEqual({ withheldAmount: 0, pphType: null });
    expect(parseNativeWithholding('pph23', '20000', 1000000)).toEqual({ withheldAmount: 20000, pphType: 'pph23' });
    expect(parseNativeWithholding('pph4_2', '0', 1000000)).toEqual({ withheldAmount: 0, pphType: null });
    expect(parseNativeWithholding('pph23', '', 1000000)).toBeNull();
    expect(parseNativeWithholding('pph23', '20000', null)).toBeNull();
    expect(parseNativeWithholding('pph23', '1000000.01', 1000000)).toBeNull();
    expect(parseNativeWithholding('pph23', '-5', 1000000)).toBeNull();
    expect(parseNativeWithholding('pph21', '5', 1000000)).toBeNull();
  });

  it('AC-VWH-025 the default editor accepts 0–100% VAT and a PPh rate above 0 and below 100', () => {
    expect(parseVendorTaxDefaultsDraft('11', 'pph23', '2')).toEqual({ ok: true, value: { vatRate: 11, pphType: 'pph23', pphRate: 2 } });
    expect(parseVendorTaxDefaultsDraft('', '', '')).toEqual({ ok: true, value: { vatRate: null, pphType: null, pphRate: null } });
    expect(parseVendorTaxDefaultsDraft('101', '', '')).toEqual({ ok: false, field: 'vat' });
    expect(parseVendorTaxDefaultsDraft('11', 'pph23', '')).toEqual({ ok: false, field: 'pph' });
    expect(parseVendorTaxDefaultsDraft('11', 'pph4_2', '100')).toEqual({ ok: false, field: 'pph' });
  });
});
