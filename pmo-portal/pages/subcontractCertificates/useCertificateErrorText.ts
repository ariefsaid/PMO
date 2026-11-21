import { useTranslation } from 'react-i18next';
import { certificateErrorMessage, type CertificateErrorKey } from '@/src/lib/subcontracts/certificateErrors';

export function useCertificateErrorText() {
  const { t } = useTranslation('subcontractCertificates');
  return (err: unknown) => certificateErrorMessage(err, (key: CertificateErrorKey) => t(`subcontractCertificates:errors.${key}`, errorDefaults[key]));
}

const errorDefaults: Record<CertificateErrorKey, string> = {
  needsDifferentApprover: 'A certificate needs a different approver than the person who prepared and submitted it.',
  overCap: 'This is more than the signed acceptance and the purchase order allow.',
  alreadyCertified: 'Some of this work or backcharge is already in another live certificate.',
  alreadyBilled: 'This certificate is already submitted or billed.',
  netNegative: 'The backcharges are more than the certified work, so the net would be negative.',
  unrated: 'Some measured work has no usable rate. Rate it or set it aside first.',
  empty: 'Nothing measured and rated to certify in this period.',
  notAllowed: 'You are not allowed to do this.',
  periodExists: 'A certificate already exists for this purchase order and month.',
  rateWindow: 'This rate window overlaps another rate line for the same vendor and item.',
  rateMonthStart: 'A rate takes effect on the first day of a month and ends on the last day of a month.',
  erpDeduction: 'This organisation records bills in its ERP; a certificate with backcharges waits for the ERP route.',
  other: 'Not saved.',
};

