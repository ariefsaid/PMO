import type { TFunction } from 'i18next';

/**
 * The display name of a procurement record's stored status (PR, RFQ, quotation, PO, receipt, invoice,
 * payment). The stored value is never translated; an unknown value reads as stored.
 */
export function recordStatusLabel(t: TFunction, status: string): string {
  const labels: Record<string, string> = {
    Draft: t('procurementRecord:recordStatus.draft', 'Draft'),
    Submitted: t('procurementRecord:recordStatus.submitted', 'Submitted'),
    Approved: t('procurementRecord:recordStatus.approved', 'Approved'),
    Rejected: t('procurementRecord:recordStatus.rejected', 'Rejected'),
    Issued: t('procurementRecord:recordStatus.issued', 'Issued'),
    Received: t('procurementRecord:recordStatus.received', 'Received'),
    Partial: t('procurementRecord:recordStatus.partial', 'Partial'),
    Selected: t('procurementRecord:recordStatus.selected', 'Selected'),
    Closed: t('procurementRecord:recordStatus.closed', 'Closed'),
    Cancelled: t('procurementRecord:recordStatus.cancelled', 'Cancelled'),
    Paid: t('procurementRecord:recordStatus.paid', 'Paid'),
    Unpaid: t('procurementRecord:recordStatus.unpaid', 'Unpaid'),
    Pending: t('procurementRecord:recordStatus.pending', 'Pending'),
    Open: t('procurementRecord:recordStatus.open', 'Open'),
    Sent: t('procurementRecord:recordStatus.sent', 'Sent'),
  };
  return labels[status] ?? status;
}
