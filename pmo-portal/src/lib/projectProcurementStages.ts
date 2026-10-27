import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';

export interface ProjectProcurementStageCopy {
  label: string;
  nextStep?: string;
}

/** Plain-language procurement labels used by the project tab for every lifecycle stage. */
export const PROJECT_PROCUREMENT_STAGE_COPY: Record<ProcurementStatus, ProjectProcurementStageCopy> = {
  Draft: { label: 'Draft', nextStep: 'Submit for approval' },
  Requested: { label: 'Awaiting approval', nextStep: 'Approve or reject' },
  Approved: { label: 'Approved', nextStep: 'Get quotes or order' },
  'Vendor Quoted': { label: 'Getting quotes', nextStep: 'Choose a quote' },
  'Quote Selected': { label: 'Quote chosen', nextStep: 'Raise the order' },
  Ordered: { label: 'Ordered', nextStep: 'Record delivery' },
  Received: { label: 'Delivered', nextStep: 'Record supplier invoice' },
  'Vendor Invoiced': { label: 'Supplier invoiced', nextStep: 'Pay' },
  Paid: { label: 'Paid' },
  Rejected: { label: 'Rejected' },
  Cancelled: { label: 'Cancelled' },
};

export interface ProjectProcurementGroup {
  key: 'needs-action' | 'in-progress' | 'invoiced-or-paid' | 'rejected-or-cancelled';
  label: string;
  statuses: readonly ProcurementStatus[];
  folded?: boolean;
}

export const PROJECT_PROCUREMENT_GROUPS: readonly ProjectProcurementGroup[] = [
  { key: 'needs-action', label: 'Needs action', statuses: ['Draft', 'Requested', 'Quote Selected'] },
  { key: 'in-progress', label: 'In progress', statuses: ['Approved', 'Vendor Quoted', 'Ordered', 'Received'] },
  { key: 'invoiced-or-paid', label: 'Invoiced or paid', statuses: ['Vendor Invoiced', 'Paid'] },
  { key: 'rejected-or-cancelled', label: 'Rejected or cancelled', statuses: ['Rejected', 'Cancelled'], folded: true },
];
