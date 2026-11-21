import { classifyMutationError } from '@/src/lib/classifyMutationError';

/**
 * Names a refusal from the certificate functions (#2584). The server's message is already specific (item, verified,
 * PO quantity, billed) for the cap, so it is shown as given; the rest map to a fixed, translated sentence.
 */
export type CertificateErrorKey =
  | 'needsDifferentApprover' | 'overCap' | 'alreadyCertified' | 'alreadyBilled' | 'netNegative' | 'unrated' | 'empty'
  | 'notAllowed' | 'periodExists' | 'rateWindow' | 'rateMonthStart' | 'erpDeduction' | 'other';

interface ErrLike { code?: string; message?: string; details?: string | null }

export function certificateErrorKey(err: unknown): CertificateErrorKey {
  const e = (err ?? {}) as ErrLike;
  const detail = `${e.details ?? ''}`;
  const message = `${e.message ?? ''}`;
  if (detail.includes('needs-different-approver')) return 'needsDifferentApprover';
  if (e.code === 'SC001') return 'overCap';
  if (detail.includes('cert-net-negative')) return 'netNegative';
  if (detail.includes('cert-unrated')) return 'unrated';
  if (detail.includes('cert-empty')) return 'empty';
  if (detail.includes('cert-billed') || detail.includes('cert-not-submittable')) return 'alreadyBilled';
  if (detail.includes('cert-period-exists')) return 'periodExists';
  if (detail.includes('already-certified') || message.startsWith('already certified')) return 'alreadyCertified';
  if (detail.includes('rate-overlap') || e.code === '23P01') return 'rateWindow';
  if (detail.includes('rate-not-month')) return 'rateMonthStart';
  if (detail.includes('erp-deduction-unsupported')) return 'erpDeduction';
  if (e.code === '42501') return 'notAllowed';
  return 'other';
}

/** The text to show: the cap refusal keeps the server's own wording (it carries the figures). */
export function certificateErrorMessage(err: unknown, translate: (key: CertificateErrorKey) => string): string {
  const key = certificateErrorKey(err);
  if (key === 'overCap') return (err as ErrLike).message ?? translate('other');
  if (key === 'other') return classifyMutationError(err).headline;
  return translate(key);
}
