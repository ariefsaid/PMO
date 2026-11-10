import React from 'react';
import { useTranslation } from 'react-i18next';
import { SelectField } from '@/src/components/ui';
import { TaxRateFields } from '@/src/components/ui/TaxRateFields';
import { OdooTaxPicker } from '@/src/components/procurement/OdooDirectoryPickers';
import { VI_FIELD_TEST_IDS } from './vendorInvoiceTestIds';
import { TAX_TREATMENT_OPTIONS, VI_TAX_REQUIRED_HINT } from './vendorInvoiceTax';
import { ErpTaxAmountFields, NativeWithholdingField, TaxSuggestedFrom } from './VendorBillTaxFields';
import type { VendorInvoiceCapture } from './useVendorInvoiceCapture';

/** The vendor-invoice tax controls of the capture form; which of them render is `capture`'s verdict. */
export const VendorInvoiceCaptureFields: React.FC<{ formId: string; capture: VendorInvoiceCapture; isVendorInvoice: boolean }> = ({ formId, capture, isVendorInvoice }) => {
  const { t } = useTranslation();
  const {
    taxTreatmentStr, setTaxTreatmentStr, taxAmountStr, taxFields, taxAmountMask, pmoAuthorsTax, parsedTax,
    odooBill, odooTaxIds, setOdooTaxIds, choosesErpTaxTemplate, taxTemplate, setTaxTemplate, erpTaxTemplates,
    nativeTax, entersErpAmounts, erpTax,
  } = capture;
  return (
    <>
    {/* #505: vendor-invoice tax facts — BOTH required, and the treatment has no pre-selected
        option. `amount` above is ambiguous without a treatment marker and no later inference
        recovers it (migration 0196). Hidden entirely on a flipped org, where the ERP owns the
        answer (`taxIsPmoAuthored`). The copy + testids are single-sourced in vendorInvoiceTax.ts /
        vendorInvoiceTestIds.ts, so the two entry points cannot drift. */}
    {/* #520: flipped org — which ERPNext purchase tax template applies (validated and expanded server-side). */}
    {choosesErpTaxTemplate && (
      <SelectField
        id={`${formId}-tax-template`}
        label={t('procurementDetail.erpTaxTemplate.label', 'ERPNext tax template')}
        value={taxTemplate}
        onChange={setTaxTemplate}
        disabled={!erpTaxTemplates.data}
        helper={erpTaxTemplates.isError
          ? t('procurementDetail.erpTaxTemplate.loadError', 'Could not load the ERPNext tax templates. Enter the tax amounts instead.')
          : undefined}
        options={[
          { value: '', label: t('procurementDetail.erpTaxTemplate.enterAmounts', 'Enter the tax amounts') },
          ...(erpTaxTemplates.data ?? []).map((tpl) => ({ value: tpl.name, label: tpl.name })),
        ]}
        data-testid="vi-tax-template-select"
      />
    )}
    {odooBill && <OdooTaxPicker value={odooTaxIds} onChange={setOdooTaxIds} />}
    {entersErpAmounts && <ErpTaxAmountFields formId={formId} tax={erpTax} />}
    {pmoAuthorsTax && <TaxRateFields fields={taxFields} />}
    {pmoAuthorsTax && (
      <div className="flex flex-wrap gap-3">
        <div className="min-w-[180px] flex-1">
          <SelectField
            id={`${formId}-tax-treatment`}
            label={t('procurementDetail.vendorInvoice.taxTreatment', 'Tax treatment')}
            value={taxTreatmentStr}
            onChange={setTaxTreatmentStr}
            placeholder={t('procurementDetail.vendorInvoice.taxTreatmentPlaceholder', 'Select tax treatment')}
            helper={t('procurementDetail.vendorInvoice.taxTreatmentHelper', 'Inclusive: VAT is already in the bill amount. Exclusive: VAT is added to it.')}
            options={TAX_TREATMENT_OPTIONS.map((option) => ({
              ...option,
              label: option.value === 'inclusive'
                ? t('procurementDetail.vendorInvoice.taxInclusive', 'Inclusive: VAT included')
                : t('procurementDetail.vendorInvoice.taxExclusive', 'Exclusive: VAT added'),
            }))}
            data-testid={VI_FIELD_TEST_IDS.taxTreatment}
          />
        </div>
        <div className="flex min-w-[140px] flex-1 flex-col gap-1">
          <label
            htmlFor={`${formId}-tax-amount`}
            className="text-sm font-semibold text-muted-foreground"
          >
            {t('procurementDetail.vendorInvoice.taxAmount', 'Tax amount')}
          </label>
          <input
            id={`${formId}-tax-amount`}
            type="text"
            inputMode="decimal"
            ref={taxAmountMask.ref}
            value={taxAmountStr}
            readOnly={taxFields.hasRate}
            onChange={taxAmountMask.onChange}
            placeholder="0.00"
            data-testid={VI_FIELD_TEST_IDS.taxAmount}
            aria-describedby={nativeTax.vatSuggestion ? `${formId}-tax-amount-basis` : undefined}
            className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm tabular-nums outline-none placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          <TaxSuggestedFrom id={`${formId}-tax-amount-basis`} suggestion={nativeTax.vatSuggestion} />
        </div>
      </div>
    )}
    {pmoAuthorsTax && <NativeWithholdingField formId={formId} tax={nativeTax} />}

    {isVendorInvoice && parsedTax === null && (
      <p data-testid={VI_FIELD_TEST_IDS.taxRequiredHint} className="text-sm text-muted-foreground">
        {VI_TAX_REQUIRED_HINT}
      </p>
    )}
    </>
  );
};
