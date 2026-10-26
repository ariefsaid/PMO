import type { TFunction } from 'i18next';

/** Display labels only; stored workflow values remain unchanged. */
export function approvalStatusLabel(status: string, t: TFunction): string {
  switch (status) {
    case 'Requested': return t('approvals.status.requested', 'Requested');
    case 'Approved': return t('approvals.status.approved', 'Approved');
    case 'Rejected': return t('approvals.status.rejected', 'Rejected');
    case 'Submitted': return t('approvals.status.submitted', 'Submitted');
    case 'Draft': return t('approvals.status.draft', 'Draft');
    case 'Returned': return t('approvals.status.returned', 'Returned');
    default: return status;
  }
}
