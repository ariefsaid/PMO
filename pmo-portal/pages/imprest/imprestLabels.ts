type Translate = (key: string, fallback: string) => string;

/** Plan and replenishment statuses, as literal `t()` calls so the catalogue gates see every label. */
export function imprestStatusLabel(status: string, t: Translate): string {
  switch (status) {
    case 'Draft': return t('imprest:status.draft', 'Draft');
    case 'Submitted': return t('imprest:status.submitted', 'Submitted');
    case 'Approved': return t('imprest:status.approved', 'Approved');
    case 'Rejected': return t('imprest:status.rejected', 'Rejected');
    case 'Cancelled': return t('imprest:status.cancelled', 'Cancelled');
    case 'Requested': return t('imprest:status.requested', 'Requested');
    case 'Paid': return t('imprest:status.paid', 'Paid');
    default: return status;
  }
}
