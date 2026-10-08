import { useTranslation } from 'react-i18next';
import { useProjectStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import { useProcurementStageLabel } from '@/src/hooks/useProcurementStageLabel';
import { useTaxTreatmentOptions } from '@/src/hooks/useTaxTreatmentOptions';
import { classificationValueLabel } from '@/src/lib/projectClassification';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { stageLabelForStatus } from '@/components/procurement';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';

/** Procurement statuses whose header label IS a lifecycle stage name (STATUS_LABEL) — localized via the stage keys. */
const PROCUREMENT_STAGE_KEY: Record<string, string> = {
  Requested: 'pr',
  'Vendor Quoted': 'vq',
  Ordered: 'po',
  Received: 'gr',
  'Vendor Invoiced': 'vi',
};

/**
 * Display label for a stored enum / closed-set value, through each module's own label helper or its
 * own translation keys — so History reads the same word the record page does. A value with no
 * mapping (or an unknown stored value) is shown as stored, never relabelled.
 */
export function useHistoryEnumLabel(): (entityType: string, column: string, value: string) => string {
  const { t } = useTranslation();
  const projectStatus = useProjectStatusLabel();
  const procurementStage = useProcurementStageLabel();
  const { options: taxOptions } = useTaxTreatmentOptions();

  return (entityType, column, value) => {
    if (column === 'tax_treatment') return taxOptions.find((o) => o.value === value)?.label ?? value;
    if (column === 'withheld_pph_type') {
      if (value === 'pph23') return t('history.withholdingType.pph23', 'PPh 23');
      if (value === 'pph4_2') return t('history.withholdingType.pph4_2', 'PPh 4(2)');
    }
    if (column === 'award_type' || column === 'bidding_entity') return classificationValueLabel(t, value);
    if (column === 'budget_category' || (entityType === 'budget_line_item' && column === 'category')) {
      return budgetCategoryLabel(value, t);
    }
    if (column === 'type' && entityType === 'company') {
      switch (value) {
        case 'Client': return t('companies.type.client', 'Client');
        case 'Vendor': return t('companies.type.vendor', 'Vendor');
        case 'Internal': return t('companies.type.internal', 'Internal');
        default: return value;
      }
    }
    if (column !== 'status') return value;
    switch (entityType) {
      case 'project':
        return projectStatus(value);
      case 'procurement': {
        const key = PROCUREMENT_STAGE_KEY[value];
        const header = stageLabelForStatus(value as ProcurementStatus);
        if (key) return procurementStage({ key, full: header });
        return value === 'Paid' ? t('procurement.filter.paid', 'Paid') : header;
      }
      case 'task':
        switch (value) {
          case 'To Do': return t('task.status.toDo', 'To Do');
          case 'In Progress': return t('task.status.inProgress', 'In Progress');
          case 'Done': return t('task.status.done', 'Done');
          case 'Blocked': return t('task.status.blocked', 'Blocked');
          default: return value;
        }
      case 'work_order':
        switch (value) {
          case 'Draft': return t('projectDetail.workOrders.status.draft', 'Draft');
          case 'Issued': return t('projectDetail.workOrders.status.issued', 'Issued');
          case 'Closed': return t('projectDetail.workOrders.status.closed', 'Closed');
          case 'Cancelled': return t('projectDetail.workOrders.status.cancelled', 'Cancelled');
          default: return value;
        }
      case 'budget_version':
        switch (value) {
          case 'Draft': return t('financeCopy.statusDraft', 'Draft');
          case 'Active': return t('financeCopy.statusActive', 'Active');
          case 'Archived': return t('financeCopy.statusArchived', 'Archived');
          default: return value;
        }
      default:
        return value;
    }
  };
}
