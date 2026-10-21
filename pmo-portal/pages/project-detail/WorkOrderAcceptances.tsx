import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ListState, StatusPill, type StatusVariant } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { formatDateOnly, formatNumberExact } from '@/src/lib/format';
import type { BoqItemRow } from '@/src/lib/db/progressBilling';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';
import type { WorkOrderAcceptanceWithLines } from '@/src/lib/db/workOrderAcceptances';

/**
 * The BAST (client acceptance) list of ONE work order (ADR-0090). Statuses and Stage/Final are words, not colour
 * alone. Actions follow DD-CQ-8: PM (own project) or Finance rank prepare and re-record a Draft; the preparer or
 * Admin/Finance withdraw it; Admin/Finance confirm. Confirm is offered to the preparer too — the server lets a sole
 * active operator confirm their own preparation and refuses it otherwise with its reason — with a hint, never a
 * silent hide. `can()` is UX only; the database decides.
 */
export interface WorkOrderAcceptancesProps {
  workOrder: { id: string; status: string };
  boqItems: BoqItemRow[];
  documents: ProjectDocumentRow[];
  /** This work order's BAST headers with their lines. */
  acceptances: WorkOrderAcceptanceWithLines[];
  state: 'ready' | 'loading' | 'error';
  onRetry: () => void;
  currentUserId: string | null;
  projectManagerId: string | null;
  hasAllocations: boolean;
  onPrepare: () => void;
  onEdit: (acceptance: WorkOrderAcceptanceWithLines) => void;
  onWithdraw: (acceptance: WorkOrderAcceptanceWithLines) => void;
  onConfirm: (acceptance: WorkOrderAcceptanceWithLines) => void;
}

const STATUS_VARIANT: Record<WorkOrderAcceptanceWithLines['status'], StatusVariant> = { Draft: 'draft', Confirmed: 'won', Withdrawn: 'lost' };

const WorkOrderAcceptances: React.FC<WorkOrderAcceptancesProps> = ({
  workOrder, boqItems, documents, acceptances, state, onRetry, currentUserId, projectManagerId, hasAllocations,
  onPrepare, onEdit, onWithdraw, onConfirm,
}) => {
  const { t } = useTranslation();
  const may = usePermission();
  const itemOf = new Map(boqItems.map((b) => [b.id, b]));
  const canPrepare = workOrder.status === 'Issued' && hasAllocations
    && may('create', 'workOrderAcceptance', { currentUserId, record: { project_manager_id: projectManagerId } });
  const sorted = [...acceptances].sort((a, b) => b.acceptance_date.localeCompare(a.acceptance_date) || b.prepared_at.localeCompare(a.prepared_at));

  const statusLabel = (status: WorkOrderAcceptanceWithLines['status']): string =>
    status === 'Draft' ? t('projectTabs:contractQuantities.workOrders.acceptances.status.draft', 'Draft')
      : status === 'Confirmed' ? t('projectTabs:contractQuantities.workOrders.acceptances.status.confirmed', 'Confirmed')
        : t('projectTabs:contractQuantities.workOrders.acceptances.status.withdrawn', 'Withdrawn');

  const linesText = (a: WorkOrderAcceptanceWithLines): string => a.lines.map((line) => {
    const item = itemOf.get(line.boq_item_id);
    const quantity = Number(line.quantity);
    if (!item) return `${formatNumberExact(quantity)}`;
    return item.earning_basis === 'lump_sum'
      ? `${item.item_code} ${formatNumberExact(Math.round(quantity * 1000) / 10)}%`
      : `${item.item_code} ${formatNumberExact(quantity)} ${item.unit}`;
  }).join(', ');

  if (state === 'loading') return <ListState variant="loading" rows={2} />;
  if (state === 'error') {
    return <ListState variant="error" title={t('projectTabs:contractQuantities.workOrders.acceptances.error', 'Couldn’t load the BASTs')} onRetry={onRetry} />;
  }

  return (
    <div className="flex flex-col gap-2">
      {sorted.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t('projectTabs:contractQuantities.workOrders.acceptances.empty', 'No BASTs yet')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sorted.map((a) => {
            const document = documents.find((d) => d.id === a.document_id);
            const draft = a.status === 'Draft';
            const preparedByMe = Boolean(currentUserId) && a.prepared_by === currentUserId;
            const canEdit = draft && workOrder.status === 'Issued'
              && may('create', 'workOrderAcceptance', { currentUserId, record: { project_manager_id: projectManagerId } });
            const canWithdraw = draft && may('withdraw', 'workOrderAcceptance', { currentUserId, record: { prepared_by: a.prepared_by } });
            const canConfirm = draft && may('confirm', 'workOrderAcceptance', { currentUserId });
            return (
              <li key={a.id} data-testid={`bast-${a.id}`} className="flex flex-col gap-1 rounded-md border border-border p-2.5">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="tabular font-semibold">{formatDateOnly(a.acceptance_date)}</span>
                  <StatusPill variant={a.is_final ? 'progress' : 'draft'}>
                    {a.is_final ? t('projectTabs:contractQuantities.workOrders.acceptances.final', 'Final') : t('projectTabs:contractQuantities.workOrders.acceptances.stage', 'Stage')}
                  </StatusPill>
                  <StatusPill variant={STATUS_VARIANT[a.status]}>{statusLabel(a.status)}</StatusPill>
                </div>
                {a.lines.length > 0 && <p className="text-[12px] tabular text-muted-foreground">{linesText(a)}</p>}
                <p className="text-[12px] text-muted-foreground">
                  {document
                    ? t('projectTabs:contractQuantities.workOrders.acceptances.document', 'Signed BAST: {{title}}', { title: document.title })
                    : t('projectTabs:contractQuantities.workOrders.acceptances.noDocument', 'No signed BAST document linked')}
                </p>
                {a.status === 'Confirmed' && a.confirm_basis === 'sole_operator' && (
                  <p className="text-[12px] text-muted-foreground">
                    {t('projectTabs:contractQuantities.workOrders.acceptances.soleOperator', 'Confirmed by the only active member')}
                  </p>
                )}
                {a.note && <p className="text-[12px]">{a.note}</p>}
                {draft && canConfirm && preparedByMe && (
                  <p className="text-[12px] text-muted-foreground">
                    {t('projectTabs:contractQuantities.workOrders.acceptances.selfConfirmHint', 'You prepared this. Another Admin or Finance user must confirm it, unless you are the only active member.')}
                  </p>
                )}
                {(canEdit || canWithdraw || canConfirm) && (
                  <div className="flex flex-wrap gap-1.5">
                    {canConfirm && (
                      <Button variant="primary" size="sm" onClick={() => onConfirm(a)}>
                        {t('projectTabs:contractQuantities.workOrders.acceptances.confirm', 'Confirm BAST')}
                      </Button>
                    )}
                    {canEdit && (
                      <Button variant="outline" size="sm" aria-label={t('projectTabs:contractQuantities.workOrders.acceptances.editLabel', 'Edit draft BAST of {{date}}', { date: a.acceptance_date })} onClick={() => onEdit(a)}>
                        {t('projectTabs:contractQuantities.workOrders.acceptances.edit', 'Edit')}
                      </Button>
                    )}
                    {canWithdraw && (
                      <Button variant="ghost" size="sm" className="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
                        aria-label={t('projectTabs:contractQuantities.workOrders.acceptances.withdrawLabel', 'Withdraw draft BAST of {{date}}', { date: a.acceptance_date })} onClick={() => onWithdraw(a)}>
                        {t('projectTabs:contractQuantities.workOrders.acceptances.withdraw', 'Withdraw')}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canPrepare && (
        <div>
          <Button variant="primary" size="sm" onClick={onPrepare}>{t('projectTabs:contractQuantities.workOrders.acceptances.prepare', 'Prepare BAST')}</Button>
        </div>
      )}
    </div>
  );
};

export default WorkOrderAcceptances;
