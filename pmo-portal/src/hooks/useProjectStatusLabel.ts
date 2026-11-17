import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { stageLabelForStatus } from '@/components/procurement';
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
    'Loss Tender': t('projects.status.lossTender', 'Lost'),
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
  const { t: tStatus } = useTranslation('status');
  const labels: Record<string, string> = {
    'stage-Leads': t('sales.stage.leads', 'Leads'),
    // The same words as the project status pill and filters (one name per state).
    'stage-PQ Submitted': tStatus('project.pqSubmitted', 'PQ submitted'),
    'stage-Quotation Submitted': tStatus('project.quotationSubmitted', 'Quotation submitted'),
    'stage-Tender Submitted': tStatus('project.tenderSubmitted', 'Tender submitted'),
    'stage-Negotiation': t('sales.stage.negotiation', 'Negotiation'),
    'stage-Won': t('projects.kanban.won', 'Won'),
    'stage-Lost': t('sales.stage.lost', 'Lost'),
  };
  return (col) => labels[col.testId] ?? col.title;
}

/** Display the shared full purchasing-state noun without changing its stored enum. */
export function useProcurementStatusLabel(): (status: string) => string {
  const { t } = useTranslation();
  // The label table (and the callback over it) is stable between language switches, so a caller's
  // `useMemo` over derived columns/tabs keeps bailing on unrelated re-renders (the list page
  // re-renders once per query settle; rebuilding an export-column list each time is pure waste).
  const labels: Record<string, string> = useMemo(() => ({
    Draft: t('uxs19.status.draft', 'Draft'),
    Requested: t('uxs19.status.requested', 'Purchase Request'),
    Approved: t('uxs19.status.approved', 'Approved'),
    'Vendor Quoted': t('uxs19.status.vendorQuoted', 'Supplier quote'),
    'Quote Selected': t('uxs19.status.quoteSelected', 'Quote Selected'),
    Ordered: t('uxs19.status.ordered', 'Purchase Order'),
    Received: t('uxs19.status.received', 'Goods Receipt'),
    'Vendor Invoiced': t('uxs19.status.vendorInvoiced', 'Supplier invoice'),
    Paid: t('uxs19.status.paid', 'Paid'),
    Rejected: t('uxs19.status.rejected', 'Rejected'),
    Cancelled: t('uxs19.status.cancelled', 'Cancelled'),
  }), [t]);
  return useMemo(() => (status: string) => labels[status] ?? stageLabelForStatus(status as ProcurementStatus), [labels]);
}
