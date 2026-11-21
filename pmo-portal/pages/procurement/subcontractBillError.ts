import type { TFunction } from 'i18next';

/** SC001 / SC002 refusals as product copy; null for any other error (the caller classifies it as usual). */
export function classifySubcontractBillError(err: unknown, t: TFunction): { headline: string; detail: string } | null {
  const code = (err as { code?: unknown } | null)?.code;
  const message = err instanceof Error ? err.message : '';
  if (code === 'SC001') {
    return { headline: t('subcontract.cap.capRefused', 'This bill is more than the accepted work allows'), detail: message };
  }
  if (code === 'SC002') {
    return { headline: t('subcontract.cap.linesRequired', 'This purchase has no issued BoQ lines to bill against'), detail: message };
  }
  return null;
}

/** #1671: a void_subcontract_bill refusal as one sentence, keyed on the RPC's stable DETAIL; else the server's words. */
export function voidBillErrorText(err: unknown, t: TFunction): string {
  const details = (err as { details?: unknown } | null)?.details;
  switch (details) {
    case 'void-own-bill':
      return t('procurement:voidBill.error.ownBill', 'You captured this bill, so another Admin or Finance user must void it.');
    case 'void-author-unknown':
      return t('procurement:voidBill.error.authorUnknown', 'Nobody is recorded as capturing this bill, so it cannot be voided here.');
    case 'void-erp-bound':
      return t('procurement:voidBill.error.erpBound', 'Your organisation records bills in its ERP. Cancel the bill there.');
    case 'void-erp-record':
      return t('procurement:voidBill.error.erpRecord', 'This bill came from an ERP record. Cancel it in the ERP.');
    case 'void-has-payment':
      return t('procurement:voidBill.error.hasPayment', 'This bill has a payment. Cancel the payment first.');
    case 'void-payments-exceed':
      return t('procurement:voidBill.error.paymentsExceed', 'Payments on this purchase would be more than its remaining bills. Cancel a payment first.');
    case 'void-already':
      return t('procurement:voidBill.error.already', 'This bill is already voided.');
    default:
      return err instanceof Error && err.message ? err.message : t('procurement:voidBill.error.generic', 'The bill could not be voided. Try again.');
  }
}
