import { useTranslation } from 'react-i18next';
import { nextProcurementStep, stageLabelForStatus } from '@/components/procurement';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';

/**
 * Display label for a project status. The enum value ('Quotation Submitted', 'Won, Pending KoM', …)
 * is DATA and never changes; only what the user reads is translated. English defaults equal the
 * enum text, so the English UI is unchanged. Unknown values fall through untouched.
 */
export function useProjectStatusLabel(): (status: string) => string {
  const { t } = useTranslation();
  const labels: Record<string, string> = {
    'Leads': t('projects.status.leads', 'Leads'),
    'PQ Submitted': t('projects.status.pqSubmitted', 'PQ Submitted'),
    'Quotation Submitted': t('projects.status.quotationSubmitted', 'Quotation Submitted'),
    'Tender Submitted': t('projects.status.tenderSubmitted', 'Tender Submitted'),
    'Negotiation': t('projects.status.negotiation', 'Negotiation'),
    'Won, Pending KoM': t('projects.status.wonPendingKom', 'Won, Pending KoM'),
    'Ongoing Project': t('projects.status.ongoingProject', 'Ongoing Project'),
    'On Hold': t('projects.status.onHold', 'On Hold'),
    'Close Out': t('projects.status.closeOut', 'Close Out'),
    'Loss Tender': t('projects.status.lossTender', 'Loss Tender'),
    Declined: t('projects.status.declined', 'Declined'),
    'Internal Project': t('projects.status.internalProject', 'Internal Project'),
  };
  return (status) => labels[status] ?? status;
}

/**
 * Display title of a Sales-board column, keyed by its `testId`. Won reuses the Projects board's key
 * so both boards say the same word. English defaults are the columns' own titles.
 */
export function useSalesStageLabel(): (col: { title: string; testId: string }) => string {
  const { t } = useTranslation();
  const labels: Record<string, string> = {
    'stage-Leads': t('sales.stage.leads', 'Leads'),
    'stage-PQ Submitted': t('sales.stage.preQual', 'Pre-Qual'),
    'stage-Quotation Submitted': t('sales.stage.quotation', 'Quotation'),
    'stage-Tender Submitted': t('sales.stage.tender', 'Tender'),
    'stage-Negotiation': t('sales.stage.negotiation', 'Negotiation'),
    'stage-Won': t('projects.kanban.won', 'Won'),
    'stage-Lost': t('sales.stage.lost', 'Lost'),
  };
  return (col) => labels[col.testId] ?? col.title;
}

/** Display the shared full purchasing-state noun without changing its stored enum. */
export function useProcurementStatusLabel(): (status: string) => string {
  const { t } = useTranslation();
  const labels: Record<string, string> = {
    Draft: t('uxs19.status.draft', 'Draft'),
    Requested: t('uxs19.status.requested', 'Purchase Request'),
    Approved: t('uxs19.status.approved', 'Approved'),
    'Vendor Quoted': t('uxs19.status.vendorQuoted', 'Vendor Quote'),
    'Quote Selected': t('uxs19.status.quoteSelected', 'Quote Selected'),
    Ordered: t('uxs19.status.ordered', 'Purchase Order'),
    Received: t('uxs19.status.received', 'Goods Receipt'),
    'Vendor Invoiced': t('uxs19.status.vendorInvoiced', 'Vendor Invoice'),
    Paid: t('uxs19.status.paid', 'Paid'),
    Rejected: t('uxs19.status.rejected', 'Rejected'),
    Cancelled: t('uxs19.status.cancelled', 'Cancelled'),
  };
  return (status) => labels[status] ?? stageLabelForStatus(status as ProcurementStatus);
}

/** Localized next-step descriptions stay descriptive and never authorize a transition. */
export function useProcurementNextStepLabel(): (status: string) => string | null {
  const { t } = useTranslation();
  const labels: Partial<Record<string, string>> = {
    Draft: t('uxs19.nextStep.draft', 'Submit request'),
    Requested: t('uxs19.nextStep.requested', 'Await approval'),
    Approved: t('uxs19.nextStep.approved', 'Request vendor quotes'),
    'Vendor Quoted': t('uxs19.nextStep.vendorQuoted', 'Select quote'),
    'Quote Selected': t('uxs19.nextStep.quoteSelected', 'Prepare purchase order'),
    Ordered: t('uxs19.nextStep.ordered', 'Record receipt'),
    Received: t('uxs19.nextStep.received', 'Record vendor invoice'),
    'Vendor Invoiced': t('uxs19.nextStep.vendorInvoiced', 'Record payment'),
  };
  return (status) => {
    const fallback = nextProcurementStep(status as ProcurementStatus);
    return fallback == null ? null : labels[status] ?? fallback;
  };
}
