import { useTranslation } from 'react-i18next';

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
