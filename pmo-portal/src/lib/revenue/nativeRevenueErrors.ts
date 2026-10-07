import type { NativeRevenueRefusal } from '@/src/lib/db/revenueNative';

type T = (key: string, fallback: string) => string;

/**
 * #784: the headline for each machine-readable refusal migration 0270's RPCs return (mapped to the error code by
 * `src/lib/db/revenueNative.ts`). Pass to `classifyMutationError` as its overrides: the headline says what to fix in
 * plain words and the server's own sentence stays the detail. Keyed on the code, never on the message text.
 */
export function nativeRevenueHeadlines(t: T): Record<NativeRevenueRefusal, string> {
  return {
    'payment-date-missing': t('financeCopy.receiptDateMissing', 'Enter the payment date.'),
    'payment-date-future': t('financeCopy.paymentDateNotFuture', 'The payment date cannot be in the future.'),
    'payment-date-before-invoice': t('financeCopy.paymentDateBeforeInvoice', 'The payment date cannot be before the invoice date.'),
    'receipt-amount-invalid': t('financeCopy.receiptRefused', 'Check the receipt amounts.'),
    'vat-rate-missing': t('financeCopy.vatRateMissing', 'This project has no VAT rate recorded'),
    'not-pmo-native': t('financeCopy.notPmoNative', 'This invoice belongs to the ERP'),
    'erp-owns-revenue': t('financeCopy.erpOwnsRevenue', 'The connected ERP now raises and settles invoices'),
    'pmo-native': t('financeCopy.pmoNative', "This invoice was raised in PMO \u2014 approve it from Approvals"),
    'withheld-amount-invalid': t('financeCopy.withheldAmountRefused', "Check the withheld tax amount."),
    'receipt-split-mismatch': t('financeCopy.receiptSplitMismatch', "Cash received plus withheld tax must equal the amount paid."),
    'withholding-slip-missing': t('financeCopy.withholdingSlipMissing', "Enter the withholding-slip number."),
    'receipt-on-pmo-invoice': t('financeCopy.receiptOnPmoInvoice', "Receipts for an invoice raised in PMO are recorded in PMO"),
    'invoice-lines-count': t('financeCopy.invoiceLinesCount', "An invoice needs 1 to 100 lines."),
    'invoice-line-invalid': t('financeCopy.invoiceLineInvalid', "Check the invoice lines."),
    'invoice-total-invalid': t('financeCopy.invoiceTotalInvalid', "The invoice total must be above zero."),
    'invoice-not-receivable': t('financeCopy.invoiceNotReceivable', "This invoice cannot receive a payment"),
    'invoice-has-receipts': t('financeCopy.invoiceHasReceipts', "Cancel this invoice's receipts first"),
    'receipt-already-cancelled': t('financeCopy.receiptAlreadyCancelled', "This receipt is already cancelled"),
    'illegal-transition': t('financeCopy.invoiceIllegalTransition', "That change isn't allowed from the invoice's current status."),
    'sod-self-approval': t('financeCopy.sodSelfApproval', "You raised this invoice \u2014 a different person must approve it"),
    'sod-author-missing': t('financeCopy.sodAuthorMissing', "This invoice has no recorded author, so it cannot be approved"),
    'native-drafts-open': t('financeCopy.nativeDraftsOpen', "Invoices raised in PMO are still in draft"),
  };
}
