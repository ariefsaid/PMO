type T = (key: string, fallback: string) => string;

/** FR-JEC-011 refusal codes → plain sentences (finance namespace). Unknown text passes through. */
export function journalReasonText(reason: string | null, t: T): string {
  switch (reason) {
    case null:
    case '': return t('finance:erpJournal.reason.unknown', 'This journal line could not be attached.');
    case 'line_key_missing': return t('finance:erpJournal.reason.keyMissing', 'The journal line is incomplete.');
    case 'invalid_id': return t('finance:erpJournal.reason.invalidId', 'The purchase or project could not be read. Refresh and try again.');
    case 'journal_posted_by_pmo': return t('finance:erpJournal.reason.pmoPosted', 'PMO posted this journal itself; it already has its own record.');
    case 'line_not_found': return t('finance:erpJournal.reason.notFound', 'This journal line is not in PMO yet. Wait for the next sync.');
    case 'line_not_positive': return t('finance:erpJournal.reason.notPositive', 'Only a journal line that adds cost can be attached.');
    case 'purchase_not_found': return t('finance:erpJournal.reason.purchaseNotFound', 'Purchase not found.');
    case 'purchase_closed': return t('finance:erpJournal.reason.purchaseClosed', 'This purchase is cancelled or rejected.');
    case 'project_mismatch': return t('finance:erpJournal.reason.project', 'This purchase belongs to another project.');
    case 'currency_mismatch': return t('finance:erpJournal.reason.currency', 'The purchase currency differs from the accounting currency.');
    case 'line_attached_to_another_purchase': return t('finance:erpJournal.reason.attachedElsewhere', 'This journal line already belongs to another purchase.');
    case 'already_attached': return t('finance:erpJournal.reason.alreadyAttached', 'This journal line is already attached to this purchase.');
    default: return reason;
  }
}
