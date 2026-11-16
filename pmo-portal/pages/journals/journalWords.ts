import type { TFunction } from 'i18next';
import type { JournalKind } from '@/src/lib/db/journals';

/** The journal kinds' display names (static keys so the catalogue gates see every one). */
export function journalKindLabel(t: TFunction, kind: JournalKind | null): string {
  switch (kind) {
    case 'fee': return t('journals:kinds.fee', 'Fee');
    case 'interest': return t('journals:kinds.interest', 'Interest');
    case 'tax-deposit': return t('journals:kinds.taxDeposit', 'Tax deposit');
    case 'accrual': return t('journals:kinds.accrual', 'Accrual');
    case 'reclassification': return t('journals:kinds.reclassification', 'Reclassification');
    case 'correction': return t('journals:kinds.correction', 'Correction');
    case 'funding': return t('journals:kinds.funding', 'Funding');
    case 'depreciation': return t('journals:kinds.depreciation', 'Depreciation');
    case 'revaluation': return t('journals:kinds.revaluation', 'Revaluation');
    case 'closing': return t('journals:kinds.closing', 'Closing');
    default: return '—';
  }
}

/** Headlines for a refused journal write; the RPC's own sentence is the detail (it names the line or account). */
export function journalErrorOverrides(t: TFunction): Record<string, string> {
  return {
    P0001: t('journals:errors.refused', 'The journal was not accepted'),
    PJ422: t('journals:errors.tooManyDecimals', 'The amount has more decimals than the currency holds. Remove the extra decimals.'),
    '22023': t('journals:errors.invalid', 'Check the journal lines'),
    '42501': t('journals:errors.denied', 'You cannot make this change'),
  };
}
