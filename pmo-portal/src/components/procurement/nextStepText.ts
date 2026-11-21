import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';

/** The next step's words, shared by the table and the grouped list so both say the same thing. */
export function nextStepText(
  status: ProcurementStatus,
  canApprove: boolean,
  t: (key: string, fallback: string) => string,
): string {
  if (status === 'Requested') {
    return canApprove
      ? t('projectDetail.procurement.nextStep.approveOrReturn', 'Approve or return')
      : t('projectDetail.procurement.nextStep.waitingOnApprover', 'Waiting on approver');
  }
  switch (status) {
    case 'Draft': return t('projectDetail.procurement.nextStep.draft', 'Submit for approval');
    case 'Approved': return t('projectDetail.procurement.nextStep.approved', 'Get quotes or order');
    case 'Vendor Quoted': return t('projectDetail.procurement.nextStep.gettingQuotes', 'Choose a quote');
    case 'Quote Selected': return t('projectDetail.procurement.nextStep.quoteChosen', 'Raise the order');
    case 'Ordered': return t('projectDetail.procurement.nextStep.ordered', 'Record delivery');
    case 'Received': return t('projectDetail.procurement.nextStep.delivered', 'Record supplier invoice');
    case 'Vendor Invoiced': return t('projectDetail.procurement.nextStep.supplierInvoiced', 'Pay');
    default: return t('projectDetail.procurement.noNextStep', '—');
  }
}
