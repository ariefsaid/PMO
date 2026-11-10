import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  GateNotice,
  MenuButton,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { formatDay } from '@/src/lib/format';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';

/** The draft-orders list on the work orders tab — draft rows stay out of the issued register. */
const WorkOrdersDraftOrders: React.FC<{
  rows: WorkOrderRow[];
  readsPending: boolean;
  readsFetching: boolean;
  readsError: boolean;
  lineReadsPending: boolean;
  lineReadsFailed: boolean;
  openPoDrawer: (row: WorkOrderRow) => void;
  onEdit: (row: WorkOrderRow) => void;
  onSetValue: (row: WorkOrderRow) => void;
  onIssue: (row: WorkOrderRow) => void;
  onCancel: (row: WorkOrderRow) => void;
  onAllocateLines: (row: WorkOrderRow) => void;
}> = ({ rows, readsPending, readsFetching, readsError, lineReadsPending, lineReadsFailed, openPoDrawer, onEdit, onSetValue, onIssue, onCancel, onAllocateLines }) => {
  const { t } = useTranslation('project');
  const may = usePermission();
  return (
    <ul className="divide-y divide-border/70">
      {rows.map((row) => {
        const canEdit = may('edit', 'workOrder', { record: { status: row.status } });
        const canSetValue = may('setValue', 'workOrder', { record: { status: row.status } });
        const canTransition = may('transition', 'workOrder');
        const issueBlocked = readsPending || readsFetching || readsError || row.issue_eligibility !== 'allowed';
        const issueGateBody = readsPending || readsFetching
          ? t('project:workOrderEligibility.checking', 'Checking issue eligibility…')
          : readsError
            ? t('project:workOrderEligibility.unavailable', 'Issue eligibility could not be checked. Refresh this page and try again.')
            : row.issue_eligibility === 'missing_witness'
              ? t('projectDetail.workOrders.issueGate.unstampedBody', 'The value must be set by an authorized reviewer before this order can be issued.')
              : row.issue_eligibility === 'self'
                ? t('projectDetail.workOrders.issueGate.body', 'You set its value. Ask another authorized reviewer to review and issue it.')
                : row.issue_eligibility === 'reviewer_required' || row.issue_eligibility === 'inactive_reviewer'
                  ? t('projectDetail.workOrders.issueGate.peerBody', 'The value must be set by your supervisor or a more senior active reviewer before it can be issued.')
                  : t('project:workOrderEligibility.unavailable', 'Issue eligibility could not be checked. Refresh this page and try again.');
        return (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
            <div className="min-w-0">
              <button type="button" data-wo-anchor={row.id} tabIndex={-1} className="rounded-sm text-left font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                aria-label={t('projectDetail.workOrders.action.openDetails', 'View details for {{order}}', { order: row.wo_number ?? row.title })}
                onClick={() => openPoDrawer(row)}>
                {row.wo_number ?? row.title}
              </button>
              {row.wo_number && <span className="ml-2 text-sm text-muted-foreground">{row.title}</span>}
              {row.client_po_number && <span className="ml-3 text-sm text-muted-foreground">{t('projectDetail.workOrders.clientPo', 'Customer PO')} {row.client_po_number}</span>}
              {row.order_date && <span className="ml-3 text-sm text-muted-foreground">{t('projectDetail.workOrders.orderDate', 'Order date')} {formatDay(row.order_date)}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {canEdit && <Button variant="ghost" size="sm" onClick={() => onEdit(row)}>{t('projectDetail.workOrders.action.editOrder', 'Edit order')}</Button>}
              {canSetValue && <Button variant="ghost" size="sm" onClick={() => onSetValue(row)}>{t('projectDetail.workOrders.action.setValue', 'Set value')}</Button>}
              {issueBlocked && canTransition ? <GateNotice variant="blocked" className="max-w-sm px-2 py-1.5 text-sm">{issueGateBody}</GateNotice>
                : canTransition && <Button variant="ghost" size="sm" onClick={() => onIssue(row)}>{t('projectDetail.workOrders.action.issue', 'Issue')}</Button>}
              {canTransition && <Button variant="ghost" size="sm" className="text-destructive-text" onClick={() => onCancel(row)}>{t('projectDetail.workOrders.action.cancelGeneric', 'Cancel')}</Button>}
              <MenuButton ariaLabel={t('projectDetail.workOrders.action.orderMenuLabel', 'Actions for {{order}}', { order: row.wo_number ?? row.title })} items={[
                ...(canEdit ? [{ label: t('projectDetail.workOrders.action.editOrder', 'Edit order'), onClick: () => onEdit(row) }] : []),
                ...(canSetValue ? [{ label: t('projectDetail.workOrders.action.setValue', 'Set value'), onClick: () => onSetValue(row) }] : []),
                ...(!lineReadsPending && !lineReadsFailed && may('create', 'workOrderLine', { record: { status: row.status } }) ? [{ label: t('projectTabs:contractQuantities.workOrders.contractLines.edit', 'Allocate contract lines'), onClick: () => onAllocateLines(row) }] : []),
                ...(!issueBlocked && canTransition ? [{ label: t('projectDetail.workOrders.action.issue', 'Issue'), onClick: () => onIssue(row) }] : []),
                ...(canTransition ? [{ label: t('projectDetail.workOrders.action.cancelGeneric', 'Cancel'), danger: true, onClick: () => onCancel(row) }] : []),
                { label: t('projectDetail.workOrders.action.viewPo', 'View customer PO'), onClick: () => openPoDrawer(row) },
              ]} />
            </div>
          </li>
        );
      })}
    </ul>
  );
};

export default WorkOrdersDraftOrders;
