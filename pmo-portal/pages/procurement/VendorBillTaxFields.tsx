/**
 * #876 slice 2 (OD-VWH-1, DD-VWH-13..17, OQ-VWH-6) — the vendor-bill tax inputs shared by BOTH vendor-invoice entry
 * points (RecordCaptureForm, VIInlineCapture in ProcurementDecisionZone). Presentational only: state, pre-fill and
 * parsing live in `useVendorBillTax`; every money computation lives in `vendorWithholding.ts`.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { FieldError, SelectField, useMoneyInputMask } from '@/src/components/ui';
import { formatMoneyInputValue } from '@/src/lib/format';
import type { ErpVendorTax, NativeVendorTax, TaxSuggestion, WithholdingDraft } from '@/src/hooks/useVendorBillTax';
import { VI_VENDOR_TAX_TEST_IDS } from './vendorInvoiceTestIds';

const LABEL = 'text-[12px] font-semibold text-muted-foreground';
const INPUT = 'h-8 w-full rounded-md border border-input bg-background px-2.5 text-[13.5px] tabular-nums outline-none placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/** The tax-basis label under a pre-filled amount: which rate, applied to which base. */
export const TaxSuggestedFrom: React.FC<{ suggestion: TaxSuggestion | null; id?: string }> = ({ suggestion, id }) => {
  const { t } = useTranslation();
  if (!suggestion) return null;
  return (
    <p id={id} data-testid={VI_VENDOR_TAX_TEST_IDS.suggestedFrom} className="text-[12px] text-muted-foreground">
      {t('procurementDetail.vendorTax.suggestedFrom', 'Vendor default {{rate}}% of {{base}}', {
        rate: formatMoneyInputValue(suggestion.rate),
        base: formatMoneyInputValue(suggestion.base),
      })}
    </p>
  );
};

interface MoneyFieldProps {
  id: string;
  label: React.ReactNode;
  raw: string;
  onChange: (next: string) => void;
  testId: string;
  suggestion: TaxSuggestion | null;
  error?: string;
}

const MoneyField: React.FC<MoneyFieldProps> = ({ id, label, raw, onChange, testId, suggestion, error }) => {
  const mask = useMoneyInputMask(raw, onChange);
  const describedBy = [suggestion ? `${id}-basis` : null, error ? `${id}-error` : null].filter(Boolean).join(' ');
  return (
    <div className="flex min-w-[140px] flex-1 flex-col gap-1">
      <label htmlFor={id} className={LABEL}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        ref={mask.ref}
        value={raw}
        onChange={mask.onChange}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        placeholder="0.00"
        data-testid={testId}
        className={INPUT}
      />
      <TaxSuggestedFrom id={`${id}-basis`} suggestion={suggestion} />
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </div>
  );
};

/** The withholding type (None / PPh 23 / PPh 4(2)) and, once a type is chosen, its amount. */
const WithholdingFields: React.FC<{ formId: string; draft: WithholdingDraft; amountTestId: string; error?: string }> = ({
  formId, draft, amountTestId, error,
}) => {
  const { t } = useTranslation();
  return (
    <>
      <div className="min-w-[160px] flex-1">
        <SelectField
          id={`${formId}-pph-type`}
          label={t('procurementDetail.vendorTax.withholding', 'Tax withheld')}
          value={draft.pphType.raw}
          onChange={draft.pphType.onChange}
          options={[
            { value: '', label: t('procurementDetail.vendorTax.none', 'None') },
            { value: 'pph23', label: t('procurementDetail.vendorTax.pph23', 'PPh 23') },
            { value: 'pph4_2', label: t('procurementDetail.vendorTax.pph4_2', 'PPh 4(2)') },
          ]}
          data-testid={VI_VENDOR_TAX_TEST_IDS.pphType}
        />
      </div>
      {draft.pphType.raw !== '' && (
        <MoneyField
          id={`${formId}-withheld`}
          label={t('procurementDetail.vendorTax.withheldAmount', 'PPh amount')}
          raw={draft.withheld.raw}
          onChange={draft.withheld.onChange}
          testId={amountTestId}
          suggestion={draft.withheld.suggestion}
          error={error}
        />
      )}
    </>
  );
};

/** A standalone bill's tax withheld (PPh): the type and its amount. Optional — None records none. */
export const NativeWithholdingField: React.FC<{ formId: string; tax: NativeVendorTax }> = ({ formId, tax }) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-3">
      <WithholdingFields
        formId={formId}
        draft={tax.withholding}
        amountTestId={VI_VENDOR_TAX_TEST_IDS.nativeWithheld}
        error={tax.value === null
          ? t('procurementDetail.vendorTax.withheldError', 'Enter the tax withheld as an amount no larger than the invoice amount (enter the amount first).')
          : undefined}
      />
    </div>
  );
};

/** An ERP-bound bill in "Enter the tax amounts" mode: VAT, the withholding type and the PPh amount. */
export const ErpTaxAmountFields: React.FC<{ formId: string; tax: ErpVendorTax }> = ({ formId, tax }) => {
  const { t } = useTranslation();
  return (
    <div data-testid={VI_VENDOR_TAX_TEST_IDS.erpFields} className="flex flex-col gap-3">
      {tax.itemsNet !== null && (
        <p data-testid={VI_VENDOR_TAX_TEST_IDS.itemsNet} className="text-[12px] text-muted-foreground">
          {t('procurementDetail.vendorTax.itemsNet', 'Items total, before tax: {{amount}}', { amount: formatMoneyInputValue(tax.itemsNet) })}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <MoneyField
          id={`${formId}-erp-vat`}
          label={t('procurementDetail.vendorTax.vatAmount', 'VAT amount')}
          raw={tax.vat.raw}
          onChange={tax.vat.onChange}
          testId={VI_VENDOR_TAX_TEST_IDS.erpVat}
          suggestion={tax.vat.suggestion}
        />
        <WithholdingFields formId={formId} draft={tax.withholding} amountTestId={VI_VENDOR_TAX_TEST_IDS.erpWithheld} />
      </div>
      {tax.amounts === null && (
        <p data-testid={VI_VENDOR_TAX_TEST_IDS.erpRequiredHint} className="text-[12px] text-muted-foreground">
          {t('procurementDetail.vendorTax.erpRequiredHint', "Enter the VAT amount from the vendor's invoice (0 if none) and, if tax is withheld, its type and amount.")}
        </p>
      )}
    </div>
  );
};
