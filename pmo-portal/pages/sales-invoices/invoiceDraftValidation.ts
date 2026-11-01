import type { InvoiceProjectOption } from '@/src/hooks/useFkOptions';
import type { BillingKind } from '@/src/lib/billingKind';
import { parseMoneyInputAtScale } from '@/src/lib/format';
import { decimalUnits } from '@/src/lib/taxNormalize';

/** Line item as submitted: numeric, ready for the create command. */
export interface LineItem {
  item_code: string;
  description?: string;
  qty: number;
  rate: number;
}

/**
 * Line item as edited. The rate is money, so it stays the user's locale-formatted DRAFT until
 * submit (#684) — converting on every keystroke would drop an unfinished decimal separator.
 */
export interface LineItemDraft {
  item_code: string;
  description?: string;
  qty: string;
  rate: string;
}

export interface FormValues {
  customerId: string;
  projectId: string | null;
  /** #1471: chosen beside the project; the control only offers valid values, so there is no validation rule. */
  billingKind: BillingKind;
  lineItems: LineItemDraft[];
}

export const EMPTY_LINE: LineItemDraft = { item_code: '', qty: '1', rate: '0' };

/**
 * #684 (AC-PLC-009): the ONE parse of a rate draft, used by `validate` and by the submit. Rates are
 * scale-2 money, so a value that would need rounding is refused rather than silently changed.
 */
export const parseRate = (raw: string): number | null => parseMoneyInputAtScale(raw, 2);
export const parseQuantity = (raw: string): number | null => parseMoneyInputAtScale(raw, 3);
export const isValidQuantity = (raw: string): boolean => {
  const qty = parseQuantity(raw);
  return qty !== null && Number.isFinite(qty) && qty > 0 && decimalUnits(qty, 3) !== null;
};

export const validate = (
  v: FormValues,
  t: (key: string, fallback: string, options?: Record<string, unknown>) => string,
  native = false,
  project?: InvoiceProjectOption,
  connected = false,
): Partial<Record<keyof FormValues, string>> => {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!v.customerId.trim()) errors.customerId = t('financeCopy.customerRequired', 'Customer is required.');
  // #784 (DD-NAR-7): the project decides a PMO invoice's VAT (OD-TAX-4), so a PMO invoice names one.
  if (native && !v.projectId) errors.projectId = t('financeCopy.nativeProjectRequired', "Project is required: it decides the invoice's VAT.");
  // I-2 (DD-TAX-4a): the server refuses a VAT project with no recorded rate — say so before the round trip.
  else if (native && needsVatRate(project)) errors.projectId = t('financeCopy.vatRateMissing', 'This project has no VAT rate recorded');
  if (v.lineItems.length === 0) {
    errors.lineItems = t('financeCopy.invoiceLineRequired', 'At least one line item is required.');
  } else {
    for (let i = 0; i < v.lineItems.length; i++) {
      const item = v.lineItems[i];
      const rate = parseRate(item.rate);
      const quantity = parseQuantity(item.qty);
      let lineError: string | undefined;
      // FR-NAR-002 (I-3): a PMO line needs an item code OR a description; an ERP line needs its item code.
      if (native && !connected) {
        if (!item.item_code.trim() && !item.description?.trim()) {
          lineError = t('financeCopy.invoiceLineCodeOrDescription', 'Line {{line}}: Enter an item code or a description.', { line: i + 1 });
        }
      } else if (!item.item_code.trim()) lineError = t('financeCopy.invoiceLineItemCodeRequired', 'Line {{line}}: Item code is required.', { line: i + 1 });
      if (quantity === null) {
        lineError = t('uxs16.invoiceLineQuantityValid', 'Line {{line}}: Quantity must be positive with no more than 3 decimal places.', { line: i + 1 });
      } else if (quantity <= 0) {
        lineError = t('financeCopy.invoiceLineQuantityPositive', 'Line {{line}}: Quantity must be positive.', { line: i + 1 });
      }
      if (rate === null) {
        lineError = t('financeCopy.invoiceLineRateValid', 'Line {{line}}: Enter a valid rate with no more than 2 decimal places.', { line: i + 1 });
      } else if (rate < 0) lineError = t('financeCopy.invoiceLineRateNonNegative', 'Line {{line}}: Rate cannot be negative.', { line: i + 1 });
      // The summary links to the first invalid line, so its message must identify that same line.
      if (!errors.lineItems && lineError) errors.lineItems = lineError;
    }
  }
  return errors;
};

/** DD-TAX-4a: a project subject to VAT with no recorded rate cannot be invoiced in PMO until its rate is recorded. */
export const needsVatRate = (project?: InvoiceProjectOption): boolean => Boolean(project?.subjectToVat && project.taxRate == null);
