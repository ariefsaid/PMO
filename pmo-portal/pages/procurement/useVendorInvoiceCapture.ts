import { useState } from 'react';
import { useMoneyInputMask } from '@/src/components/ui';
import { useStandaloneTaxFields } from '@/src/hooks/useStandaloneTaxFields';
import { useOrgTaxDefault, useTaxTreatmentPreselect } from '@/src/hooks/useOrgTaxDefault';
import { usePurchaseTaxTemplates } from '@/src/hooks/usePurchaseTaxTemplates';
import { useVendorTaxDefault } from '@/src/hooks/useVendorTaxDefault';
import { useErpVendorTax, useNativeVendorTax } from '@/src/hooks/useVendorBillTax';
import { ERP_AUTHORED_TAX, taxIsPmoAuthored } from './vendorInvoiceTax';

/**
 * The vendor-invoice tax half of the capture form: which tax entry mode applies (PMO-authored,
 * ERPNext template/amounts, Odoo directory), the drafts for it, the one "can this bill be saved"
 * verdict, and the tax facts staged for the confirm. Inert for every other kind.
 *
 * `amountStr` is the shared bill-amount draft; `odooProcurement` is the org-level ownership fact the
 * shell also needs for receipts and payments.
 */
export function useVendorInvoiceCapture({ isVendorInvoice, odooProcurement, vendorId, itemsNet, amountStr }: {
  isVendorInvoice: boolean;
  odooProcurement: boolean;
  vendorId: string | null;
  itemsNet: number | null;
  amountStr: string;
}) {
  // #505: vendor-invoice tax facts. '' is "not answered yet", never a value (see vendorInvoiceTax.ts).
  // OD-TAX-1 (#548) then gave the org a PRE-SELECTION for this control — see the hook call below.
  // Unused by every other kind.
  const [taxTreatmentStr, setTaxTreatmentStr] = useState('');
  const [taxAmountStr, setTaxAmountStr] = useState('');
  const taxFields = useStandaloneTaxFields(amountStr, taxTreatmentStr, taxAmountStr, setTaxAmountStr);
  // #505: the ONE predicate — null ⇒ incomplete tax facts ⇒ Save VI disabled AND submit refuses.
  // Non-VI kinds have no tax fields, so they are never gated by it.
  // ⛔ On a FLIPPED org the ERP computes the tax and owns the answer, so PMO does not ask — see
  // `taxIsPmoAuthored`. Asking and discarding is worse than not asking, and that is what an earlier
  // round of #505 did on this exact path.
  const pmoAuthorsTax = isVendorInvoice && taxIsPmoAuthored();
  const parsedTax = !isVendorInvoice
    ? null
    : pmoAuthorsTax
      ? taxFields.facts
      : ERP_AUTHORED_TAX;
  // #520: on a flipped org the user chooses WHICH ERPNext template applies — or (#876 slice 2, DD-VWH-15) enters the
  // tax AMOUNTS, which is '' in the template select and the default. "ERPNext default" is no longer offered.
  // #1505 P8: on an Odoo-owned org the user picks taxes from Odoo's directory instead of an ERPNext template or amounts.
  const odooBill = isVendorInvoice && !pmoAuthorsTax && odooProcurement;
  const [odooTaxIds, setOdooTaxIds] = useState<string[]>([]);
  const choosesErpTaxTemplate = isVendorInvoice && !pmoAuthorsTax && !odooProcurement;
  const [taxTemplate, setTaxTemplate] = useState('');
  const erpTaxTemplates = usePurchaseTaxTemplates(choosesErpTaxTemplate);
  // #876 slice 2 (OD-VWH-1, DD-VWH-17): the vendor's default pre-fills the AMOUNTS; every amount stays editable and
  // the bill records exactly what is submitted (DD-VWH-13/19).
  const vendorTax = useVendorTaxDefault(isVendorInvoice ? vendorId : null);
  const nativeTax = useNativeVendorTax({
    vendor: vendorTax, enabled: pmoAuthorsTax, amountRaw: amountStr, treatmentRaw: taxTreatmentStr,
    vatRaw: taxAmountStr, setVatRaw: setTaxAmountStr, vatIsCalculated: taxFields.hasRate,
  });
  const taxAmountMask = useMoneyInputMask(taxAmountStr, (next) => {
    nativeTax.markVatTouched();
    setTaxAmountStr(next);
  });
  const entersErpAmounts = choosesErpTaxTemplate && taxTemplate === '';
  const erpTax = useErpVendorTax({ vendor: vendorTax, enabled: entersErpAmounts, itemsNet });
  const taxIncomplete = isVendorInvoice && (
    parsedTax === null
    || (pmoAuthorsTax && nativeTax.value === null)
    // The server refuses a withheld above the items total (DD-VWH-22); the form says so before the send.
    || (entersErpAmounts && (erpTax.amounts === null || erpTax.withheldAboveItems)));

  // OD-TAX-1 (#548): pre-select the org's `default_tax_treatment` — this form composes a NEW
  // invoice row, which is the only thing that setting is for. Enabled ONLY where PMO authors the
  // tax: on a flipped org the ERP computes it and these controls are not rendered at all, so
  // seeding a value there would stage an answer the outbound command drops on the floor.
  const orgTaxDefault = useOrgTaxDefault();
  useTaxTreatmentPreselect(orgTaxDefault, taxTreatmentStr, setTaxTreatmentStr, pmoAuthorsTax);

  /** The tax facts for the staged confirm; null while they are incomplete (submit must refuse). */
  const stagedTaxFacts = () => {
    if (!parsedTax || taxIncomplete) return null;
    return {
      taxTreatment: parsedTax.taxTreatment,
      taxAmount: parsedTax.taxAmount,
      ...(pmoAuthorsTax && taxFields.facts ? { taxRate: taxFields.facts.taxRate, taxBaseNumerator: taxFields.facts.taxBaseNumerator, taxBaseDenominator: taxFields.facts.taxBaseDenominator } : {}),
      ...(choosesErpTaxTemplate && taxTemplate ? { taxTemplate } : {}),
      ...(pmoAuthorsTax && nativeTax.value?.pphType
        ? { withheldAmount: nativeTax.value.withheldAmount, withheldPphType: nativeTax.value.pphType } : {}),
      ...(entersErpAmounts && erpTax.amounts ? { erpTaxAmounts: erpTax.amounts } : {}),
      ...(odooBill && odooTaxIds.length ? { taxIds: odooTaxIds } : {}),
    };
  };

  return {
    taxTreatmentStr, setTaxTreatmentStr, taxAmountStr, taxFields, taxAmountMask,
    pmoAuthorsTax, parsedTax, odooBill, odooTaxIds, setOdooTaxIds,
    choosesErpTaxTemplate, taxTemplate, setTaxTemplate, erpTaxTemplates,
    vendorTax, nativeTax, entersErpAmounts, erpTax, taxIncomplete, stagedTaxFacts,
  };
}

export type VendorInvoiceCapture = ReturnType<typeof useVendorInvoiceCapture>;
