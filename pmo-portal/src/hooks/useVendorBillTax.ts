import { useEffect, useRef, useState } from 'react';
import { parseMoneyInputAtScale } from '@/src/lib/format';
import {
  netOf, parseErpTaxAmounts, parseNativeWithholding, suggestVat, suggestWithheld,
  type TaxBasis, type VendorTaxDefault,
} from '@/src/lib/vendorWithholding';
import { useSuggestedMoney } from './useSuggestedMoney';

/** The tax-basis label of a pre-filled amount: which rate, applied to which base (DD-VWH-17). */
export interface TaxSuggestion {
  rate: number;
  base: number;
}

/**
 * The withholding drafts both bill kinds share (OQ-VWH-6: the type is asked wherever a withholding is): the type is
 * seeded ONCE from the vendor default and never over the user's choice; the amount is pre-filled at the vendor's rate
 * on `base` while the chosen type is the vendor's own, until the user edits it.
 */
function useWithholdingDraft(vendor: VendorTaxDefault | null, enabled: boolean, base: number | null) {
  const [pphTypeRaw, setPphTypeRaw] = useState('');
  const [withheldRaw, setWithheldRaw] = useState('');
  const typeChosen = useRef(false);
  useEffect(() => {
    const seed = vendor?.pphType;
    if (!enabled || typeChosen.current || !seed) return;
    typeChosen.current = true;
    setPphTypeRaw((current) => (current === '' ? seed : current));
  }, [enabled, vendor]);
  const pphRate = vendor?.pphType && pphTypeRaw === vendor.pphType ? vendor.pphRate : null;
  const suggestion = enabled && pphRate !== null && base !== null ? { rate: pphRate, base } : null;
  const withheld = useSuggestedMoney(
    suggestion ? suggestWithheld(suggestion.base, suggestion.rate) : null,
    withheldRaw, setWithheldRaw, enabled && pphTypeRaw !== '');
  return {
    pphType: { raw: pphTypeRaw, onChange: (next: string) => { typeChosen.current = true; setPphTypeRaw(next); } },
    withheld: {
      raw: withheldRaw,
      onChange: (next: string) => { withheld.markTouched(); setWithheldRaw(next); },
      suggestion,
    },
  };
}
export type WithholdingDraft = ReturnType<typeof useWithholdingDraft>;

/**
 * #876 slice 2 — a STANDALONE bill (PMO authors the tax). The VAT amount is the form's existing tax-amount draft: it is
 * pre-filled only while no nominal rate is typed (a typed rate makes it a calculated field, #513) and until the user
 * edits it. The withholding (type + amount) is pre-filled on the net. Shared by both vendor-bill entry points.
 */
export function useNativeVendorTax(args: {
  vendor: VendorTaxDefault | null;
  enabled: boolean;
  amountRaw: string;
  treatmentRaw: string;
  vatRaw: string;
  setVatRaw: (raw: string) => void;
  vatIsCalculated: boolean;
}) {
  const { vendor, enabled } = args;
  const amount = args.amountRaw.trim() ? parseMoneyInputAtScale(args.amountRaw, 2) : null;
  const trimmed = args.treatmentRaw.trim();
  const treatment: TaxBasis | null = trimmed === 'inclusive' || trimmed === 'exclusive' ? trimmed : null;
  const vatRate = vendor?.vatRate ?? null;
  const vatSuggested = enabled && vatRate !== null && amount !== null && treatment ? suggestVat(amount, treatment, vatRate) : null;
  const vat = useSuggestedMoney(vatSuggested, args.vatRaw, args.setVatRaw, enabled && !args.vatIsCalculated);
  const currentVat = args.vatRaw.trim() ? parseMoneyInputAtScale(args.vatRaw, 2) : null;
  const net = amount !== null && treatment && currentVat !== null ? netOf(amount, treatment, currentVat) : null;
  const withholding = useWithholdingDraft(vendor, enabled, net);
  return {
    markVatTouched: vat.markTouched,
    vatSuggestion: vatSuggested !== null && vatRate !== null && amount !== null && treatment && !args.vatIsCalculated
      ? { rate: vatRate, base: netOf(amount, treatment, vatSuggested) } : null,
    withholding,
    /** The recorded withholding, or null while the drafts are not submittable. */
    value: parseNativeWithholding(withholding.pphType.raw, withholding.withheld.raw, amount),
  };
}
export type NativeVendorTax = ReturnType<typeof useNativeVendorTax>;

/**
 * #876 slice 2 — an ERP-BOUND bill in "Enter the tax amounts" mode (DD-VWH-14/15). VAT, the withholding type and the
 * PPh amount are pre-filled from the vendor default on the items total (what the dispatch sends as lines).
 */
export function useErpVendorTax(args: { vendor: VendorTaxDefault | null; enabled: boolean; itemsNet: number | null }) {
  const { vendor, enabled, itemsNet } = args;
  const [vatRaw, setVatRaw] = useState('');
  const vatRate = vendor?.vatRate ?? null;
  const vatSuggestion = enabled && vatRate !== null && itemsNet !== null ? { rate: vatRate, base: itemsNet } : null;
  const vat = useSuggestedMoney(
    vatSuggestion ? suggestVat(vatSuggestion.base, 'exclusive', vatSuggestion.rate) : null, vatRaw, setVatRaw, enabled);
  const withholding = useWithholdingDraft(vendor, enabled, itemsNet);
  return {
    itemsNet,
    vat: {
      raw: vatRaw,
      onChange: (next: string) => { vat.markTouched(); setVatRaw(next); },
      suggestion: vatSuggestion,
    },
    withholding,
    amounts: parseErpTaxAmounts(vatRaw, withholding.pphType.raw, withholding.withheld.raw),
  };
}
export type ErpVendorTax = ReturnType<typeof useErpVendorTax>;
