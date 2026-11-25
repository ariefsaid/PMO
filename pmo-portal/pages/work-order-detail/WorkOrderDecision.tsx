import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, ReasonDialog, useToast, type RecordMenuItem } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useWorkOrderMutations } from '@/src/hooks/useWorkOrders';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { isOverCommitmentRefusal, type WorkOrderRow } from '@/src/lib/db/workOrders';
import { OpenChecksWarning } from './OpenChecksWarning';

/**
 * The work order's decision on its own page (#2898): Issue a Draft (the header's one filled action) or Cancel it with a
 * reason (the header menu). Open checks never block Issue. Issue shows only while the server's issue eligibility says the
 * reader may (the value SoD); an over-ceiling refusal is re-offered as an explicit acknowledgement, as on the contract's
 * work orders. `can('transition', 'workOrder')` is the UX gate; transition_work_order and cancel_work_order decide.
 */
export function useWorkOrderDecision(row: Pick<WorkOrderRow, 'id' | 'project_id' | 'status' | 'title' | 'issue_eligibility'> | null) {
  const { t } = useTranslation(['workOrders', 'project']);
  const may = usePermission();
  const { toast } = useToast();
  const projectId = row?.project_id ?? '';
  const canTransition = Boolean(row) && may('transition', 'workOrder');
  const isDraft = row?.status === 'Draft';
  const { transition, cancel } = useWorkOrderMutations(projectId);
  const [issueOpen, setIssueOpen] = useState(false);
  const [overCommit, setOverCommit] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [error, setError] = useState<string>();

  const eligible = row?.issue_eligibility === 'allowed';
  const message = (err: unknown) => { const { headline, detail } = classifyMutationError(err, undefined, { suppressCapture: true }); return detail ? `${headline} ${detail}` : headline; };
  const close = () => { setIssueOpen(false); setOverCommit(null); setCancelOpen(false); setError(undefined); };

  const issue = (ack: boolean) => {
    if (!row) return;
    setError(undefined);
    transition.mutate({ id: row.id, to: 'Issued', ...(ack ? { overCommitAck: true } : {}) }, {
      onSuccess: () => { toast(t('project:projectDetail.workOrders.toast.transitioned', 'Work order updated'), row.title, 'success'); close(); },
      onError: (err) => { if (!ack && isOverCommitmentRefusal(err)) setOverCommit(err instanceof Error ? err.message : ''); else setError(message(err)); },
    });
  };

  const primaryAction = canTransition && isDraft && eligible
    ? <Button variant="primary" onClick={() => setIssueOpen(true)}>{t('project:projectDetail.workOrders.action.issue', 'Issue')}</Button>
    : undefined;
  const menuItems: RecordMenuItem[] = canTransition && (isDraft || row?.status === 'Issued')
    ? [{ key: 'cancel', label: t('decision.cancel', 'Cancel work order'), danger: true, onSelect: () => setCancelOpen(true) }]
    : [];

  const dialogs = row && (
    <>
      {issueOpen && (
        <ConfirmDialog open
          title={overCommit !== null ? t('project:projectDetail.workOrders.confirm.overCommit.title', 'This would go past the contract ceiling') : t('project:projectDetail.workOrders.confirm.issue.title', 'Issue this work order?')}
          description={overCommit !== null
            ? <div className="flex flex-col gap-2"><p>{overCommit}</p><p>{t('project:projectDetail.workOrders.confirm.overCommit.body', 'You may still issue it. If you do, your name and the time are recorded on this work order as the person who chose to over-commit.')}</p></div>
            : <div className="flex flex-col gap-2">
                <p>{t('project:projectDetail.workOrders.confirm.issue.body', 'It gets our WO number, starts drawing down the project’s contract, and its content is frozen from then on. Amending an issued work order means cancelling it and raising a replacement.')}</p>
                <OpenChecksWarning projectId={projectId} workOrderId={row.id} />
              </div>}
          confirmLabel={overCommit !== null ? t('project:projectDetail.workOrders.confirm.overCommit.confirm', 'Acknowledge and issue') : t('project:projectDetail.workOrders.confirm.issue.confirm', 'Issue work order')}
          tone={overCommit !== null ? 'destructive' : 'default'}
          loading={transition.isPending} error={error}
          onConfirm={() => issue(overCommit !== null)} onCancel={close} />
      )}
      <ReasonDialog open={cancelOpen} kind="reject" maxLength={500}
        title={t('project:projectDetail.workOrders.confirm.cancel.title', 'Cancel this work order?')}
        label={t('decision.cancelReason', 'Reason for cancelling')}
        helper={t('decision.cancelHelper', 'Cancelling is final. The reason stays on the work order.')}
        confirmLabel={t('project:projectDetail.workOrders.confirm.cancel.confirm', 'Cancel work order')}
        loading={cancel.isPending} error={error}
        onConfirm={(reason) => { setError(undefined); cancel.mutate({ id: row.id, reason }, { onSuccess: () => { toast(t('project:projectDetail.workOrders.toast.transitioned', 'Work order updated'), row.title, 'success'); close(); }, onError: (err) => setError(message(err)) }); }}
        onCancel={close} />
    </>
  );
  return { primaryAction, menuItems, dialogs };
}
