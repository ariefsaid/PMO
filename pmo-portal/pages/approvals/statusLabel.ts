import type { TFunction } from 'i18next';

/** Display labels only; stored workflow values remain unchanged. */
export function approvalStatusLabel(status: string, t: TFunction): string {
  switch (status) {
    case 'Requested': return t('work:approvals.status.requested', 'Requested');
    case 'Approved': return t('work:approvals.status.approved', 'Approved');
    case 'Rejected': return t('work:approvals.status.rejected', 'Rejected');
    case 'Submitted': return t('work:approvals.status.submitted', 'Submitted');
    case 'Draft': return t('work:approvals.status.draft', 'Draft');
    case 'Returned': return t('work:approvals.status.returned', 'Returned');
    default: return status;
  }
}
