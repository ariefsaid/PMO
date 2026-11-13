import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  ConfirmDialog,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { formatCurrency } from '@/src/lib/format';
import { localToday } from '@/src/lib/efaktur';
import type { WorkOrderInput, WorkOrderPatch, SetWorkOrderValueInput, WorkOrderRow } from '@/src/lib/db/workOrders';
import type { PrepareWorkOrderAcceptanceInput, WorkOrderAcceptanceWithLines, WorkOrderLineRow } from '@/src/lib/db/workOrderAcceptances';
import type { BoqItemRow, ProgressAssessmentInput, ProgressClaimInput, ProgressClaimWithInvoice } from '@/src/lib/db/progressBilling';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';
import { claimNet, type ProjectBillingSummary } from '@/src/lib/progressBilling';
import WorkOrderFormModal from '../WorkOrderFormModal';
import WorkOrderValueModal from '../WorkOrderValueModal';
import InvoiceWorkOrderModal from '../InvoiceWorkOrderModal';
import WorkOrderLinesModal from '../WorkOrderLinesModal';
import WorkOrderAcceptanceModal from '../WorkOrderAcceptanceModal';
import ProgressClaimModal from '../ProgressClaimModal';
import ProgressAssessmentModal from '../ProgressAssessmentModal';
import { RecordProgressModal } from '@/src/components/reports/RecordProgressModal';
import ClaimEvidenceModal from '../ClaimEvidenceModal';
import { thisMonth, type PendingTransition } from './workOrdersTabFigures';

/** Every dialog the work-orders surface can open — rendered from the tab's own state, verbatim. */
const WorkOrdersModals: React.FC<{
  boqRows: BoqItemRow[];
  documentRows: ProjectDocumentRow[];
  documentsPending: boolean;
  documentsError: boolean;
  onRetryDocuments: () => void;
  rows: WorkOrderRow[];
  /** Raw allocation rows (`lines.data`). */
  allocations: WorkOrderLineRow[];
  allocationsById: Map<string, WorkOrderLineRow[]>;
  acceptancesByWo: Map<string, WorkOrderAcceptanceWithLines[]>;
  contractLines: ProjectBillingSummary['contractLines'];
  summary: ProjectBillingSummary | null;
  currency: string;
  currencyPrefix: string;
  projectId: string;
  projectName: string;
  liveDownPayment: boolean;
  evidenceAttachedIds: string[];
  linesSources: { name: string; pending: boolean; error: boolean; retry: () => void }[];
  // Modal state (closed = null/undefined, exactly as the tab holds it).
  assessOpen: boolean;
  percentOpen: boolean;
  formFor: WorkOrderRow | null | undefined;
  linesFor: WorkOrderRow | null;
  bastFor: { row: WorkOrderRow; draft: WorkOrderAcceptanceWithLines | null } | null;
  withdrawFor: WorkOrderAcceptanceWithLines | null;
  confirmFor: { acceptance: WorkOrderAcceptanceWithLines; error: string | null } | null;
  valueFor: WorkOrderRow | null;
  invoiceFor: { row: WorkOrderRow; remaining: number } | null;
  clientId: string | null;
  claimFor: WorkOrderRow | null;
  newClaimOpen: boolean;
  evidenceFor: string | null;
  raiseFor: { claim: ProgressClaimWithInvoice; idempotencyKey: string } | null;
  withdrawClaimFor: ProgressClaimWithInvoice | null;
  pending: PendingTransition | null;
  overCommit: { row: WorkOrderRow; message: string } | null;
  // Busy flags — read lazily inside each dialog's own conditional, exactly as the tab did.
  bastMutations: { withdraw: { isPending: boolean }; confirm: { isPending: boolean } };
  claimMutations: { raiseInvoice: { isPending: boolean }; withdrawClaim: { isPending: boolean } };
  transition: { isPending: boolean };
  // Gates.
  canIssue: (id: string) => boolean;
  canEditLinesFor: (row: WorkOrderRow) => boolean;
  // Handlers.
  onCloseAssessment: () => void;
  onSaveAssessment: (input: Omit<ProgressAssessmentInput, 'projectId'>) => Promise<void>;
  onError: (err: unknown) => void;
  onClosePercent: () => void;
  onCloseForm: () => void;
  onCreateOrder: (input: WorkOrderInput) => Promise<void>;
  onUpdateOrder: (id: string, patch: WorkOrderPatch) => Promise<void>;
  onCloseLines: () => void;
  onCreateLine: (workOrderId: string, boqItemId: string, quantity: number) => Promise<void>;
  onUpdateLine: (id: string, quantity: number) => Promise<void>;
  onDeleteLine: (id: string) => Promise<void>;
  onCloseBast: () => void;
  onSaveBast: (input: Omit<PrepareWorkOrderAcceptanceInput, 'workOrderId'>) => Promise<void>;
  onWithdrawBast: () => Promise<void>;
  onCloseWithdraw: () => void;
  onConfirmBast: () => Promise<void>;
  onCloseConfirm: () => void;
  currentValueText: string;
  onCloseValue: () => void;
  onSaveValue: (input: SetWorkOrderValueInput) => Promise<void>;
  onCloseInvoice: () => void;
  onInvoiceCreated: (invoice: { id: string; si_number: string | null }) => void;
  onCloseClaim: () => void;
  onSaveClaim: (input: Omit<ProgressClaimInput, 'projectId'>) => Promise<void>;
  onClaimError: (err: unknown, overrides?: Record<string, string>) => void;
  onCloseEvidence: () => void;
  onAttachEvidence: (documentId: string) => Promise<void>;
  onEvidenceError: (err: unknown, overrides?: Record<string, string>) => void;
  onRaise: () => Promise<void>;
  onCloseRaise: () => void;
  onWithdrawClaimConfirm: () => Promise<void>;
  onCloseWithdrawClaim: () => void;
  onTransition: (pending: PendingTransition) => Promise<void>;
  onCloseTransition: () => void;
  onAcknowledgedIssue: (row: WorkOrderRow) => Promise<void>;
  onCloseOverCommit: () => void;
}> = (props) => {
  const {
    boqRows, documentRows, rows, allocations, allocationsById, acceptancesByWo, contractLines, summary,
    currency, currencyPrefix, projectId, projectName, liveDownPayment, evidenceAttachedIds, linesSources,
    assessOpen, percentOpen, formFor, linesFor, bastFor, withdrawFor, confirmFor, valueFor,
    invoiceFor, clientId, claimFor, newClaimOpen, evidenceFor, raiseFor, withdrawClaimFor,
    pending, overCommit,
    bastMutations, claimMutations, transition,
    canIssue, canEditLinesFor,
    onCloseAssessment, onSaveAssessment, onError,
    onClosePercent,
    onCloseForm, onCreateOrder, onUpdateOrder,
    onCloseLines, onCreateLine, onUpdateLine, onDeleteLine,
    onCloseBast, onSaveBast, onWithdrawBast, onCloseWithdraw, onConfirmBast, onCloseConfirm,
    currentValueText, onCloseValue, onSaveValue,
    onCloseInvoice, onInvoiceCreated,
    onCloseClaim, onSaveClaim, onClaimError,
    onCloseEvidence, onAttachEvidence, onEvidenceError, documentsPending, documentsError, onRetryDocuments,
    onRaise, onCloseRaise, onWithdrawClaimConfirm, onCloseWithdrawClaim,
    onTransition, onCloseTransition, onAcknowledgedIssue, onCloseOverCommit,
  } = props;
  const { t } = useTranslation('project');
  const may = usePermission();

  const confirmCopy = (p: PendingTransition) => {
    if (p.to === 'Issued') {
      return {
        title: t('projectDetail.workOrders.confirm.issue.title', 'Issue this work order?'),
        description: t(
          'projectDetail.workOrders.confirm.issue.body',
          'It gets our WO number, starts drawing down the project’s contract, and its content is frozen from then on. Amending an issued work order means cancelling it and raising a replacement.',
        ),
        confirmLabel: t('projectDetail.workOrders.confirm.issue.confirm', 'Issue work order'),
        tone: 'default' as const,
      };
    }
    if (p.to === 'Closed') {
      return {
        title: t('projectDetail.workOrders.confirm.close.title', 'Close this work order?'),
        description: t(
          'projectDetail.workOrders.confirm.close.body',
          'Closing is final. The value stays in the drawdown. Closed work orders count as committed, exactly as issued ones do.',
        ),
        confirmLabel: t('projectDetail.workOrders.confirm.close.confirm', 'Close work order'),
        tone: 'default' as const,
      };
    }
    return {
      title: t('projectDetail.workOrders.confirm.cancel.title', 'Cancel this work order?'),
      description: t(
        'projectDetail.workOrders.confirm.cancel.body',
        'Cancelling is final and cannot be undone. It is how a work order is withdrawn, since there is no delete. Its value stops counting towards the drawdown.',
      ),
      confirmLabel: t('projectDetail.workOrders.confirm.cancel.confirm', 'Cancel work order'),
      tone: 'destructive' as const,
    };
  };

  return (
    <>
      {assessOpen && summary && <ProgressAssessmentModal boqItems={boqRows} assessedByBoqItem={summary.assessedByBoqItem} defaultMonth={thisMonth()}
        onClose={onCloseAssessment} onSave={onSaveAssessment} onError={onError} />}

      {percentOpen && <RecordProgressModal open onClose={onClosePercent} projectId={projectId} projectName={projectName}
        defaultMonth={thisMonth()} deliveryPct={null} />}

      {formFor !== undefined && (
        <WorkOrderFormModal
          workOrder={formFor}
          currencySymbolPrefix={currencyPrefix}
          onClose={onCloseForm}
          onCreate={onCreateOrder}
          onUpdate={onUpdateOrder}
        />
      )}

      {linesFor && (
        <WorkOrderLinesModal
          sources={linesSources}
          workOrder={linesFor}
          boqItems={boqRows}
          contractLines={contractLines}
          allocations={allocationsById.get(linesFor.id) ?? []}
          canEdit={canEditLinesFor(linesFor)}
          onClose={onCloseLines}
          onCreate={(boqItemId, quantity) => onCreateLine(linesFor.id, boqItemId, quantity)}
          onUpdate={onUpdateLine}
          onDelete={onDeleteLine}
          onError={onError}
        />
      )}

      {bastFor && (
        <WorkOrderAcceptanceModal
          workOrder={bastFor.row}
          boqItems={boqRows}
          allocations={allocationsById.get(bastFor.row.id) ?? []}
          acceptances={acceptancesByWo.get(bastFor.row.id) ?? []}
          documents={documentRows}
          today={localToday()}
          draft={bastFor.draft}
          onClose={onCloseBast}
          onSave={onSaveBast}
          onError={onError}
        />
      )}

      {withdrawFor && (
        <ConfirmDialog
          open
          tone="destructive"
          title={t('projectTabs:contractQuantities.workOrders.acceptances.confirmWithdraw.title', 'Withdraw this BAST draft?')}
          description={t('projectTabs:contractQuantities.workOrders.acceptances.confirmWithdraw.body', 'The draft is withdrawn and cannot be confirmed. Prepare a new BAST if the client still accepts the work.')}
          confirmLabel={t('projectTabs:contractQuantities.workOrders.acceptances.confirmWithdraw.confirm', 'Withdraw BAST')}
          loading={bastMutations.withdraw.isPending}
          onConfirm={() => void onWithdrawBast()}
          onCancel={onCloseWithdraw}
        />
      )}

      {confirmFor && (
        <ConfirmDialog
          open
          tone="destructive"
          title={confirmFor.acceptance.is_final
            ? t('projectTabs:contractQuantities.workOrders.acceptances.confirmFinal.title', 'Confirm the final BAST?')
            : t('projectTabs:contractQuantities.workOrders.acceptances.confirmStage.title', 'Confirm this BAST?')}
          description={
            <div className="flex flex-col gap-2">
              <p>
                {confirmFor.acceptance.is_final
                  ? t('projectTabs:contractQuantities.workOrders.acceptances.confirmFinal.body', 'Confirming a final BAST closes the work order at the accepted quantities. The client’s PO value stays as recorded; the closing value is kept separately and unused quantity returns to the contract balance. This cannot be undone.')
                  : t('projectTabs:contractQuantities.workOrders.acceptances.confirmStage.body', 'The accepted quantities are recorded as of this BAST. The work order stays open and nothing is invoiced.')}
              </p>
              {confirmFor.error && (
                <p role="alert" data-testid="bast-confirm-error" className="font-medium text-destructive-text">{confirmFor.error}</p>
              )}
            </div>
          }
          confirmLabel={confirmFor.acceptance.is_final
            ? t('projectTabs:contractQuantities.workOrders.acceptances.confirmFinal.confirm', 'Confirm final BAST')
            : t('projectTabs:contractQuantities.workOrders.acceptances.confirmStage.confirm', 'Confirm BAST')}
          loading={bastMutations.confirm.isPending}
          onConfirm={() => void onConfirmBast()}
          onCancel={onCloseConfirm}
        />
      )}

      {valueFor && (
        <WorkOrderValueModal
          workOrder={valueFor}
          currentValueText={currentValueText}
          currencySymbolPrefix={currencyPrefix}
          onClose={onCloseValue}
          onSave={onSaveValue}
        />
      )}

      {invoiceFor && clientId && (
        <InvoiceWorkOrderModal
          workOrder={invoiceFor.row}
          projectId={projectId}
          clientId={clientId}
          remaining={invoiceFor.remaining}
          onClose={onCloseInvoice}
          onCreated={onInvoiceCreated}
        />
      )}

      {(claimFor || newClaimOpen) && summary && (
        <ProgressClaimModal
          boqItems={boqRows}
          workOrders={rows}
          allocations={allocations}
          contractLines={summary.contractLines}
          contractNet={summary.contractNet}
          currencySymbolPrefix={currencyPrefix}
          hasDownPayment={liveDownPayment}
          claimedByBoqItem={summary.claimedByBoqItem}
          assessedByBoqItem={summary.assessedByBoqItem}
          assessmentMonth={summary.assessment?.month ?? null}
          initialWorkOrderId={claimFor?.id}
          onClose={onCloseClaim}
          onSave={onSaveClaim}
          onError={onClaimError}
        />
      )}

      {evidenceFor && (
        <ClaimEvidenceModal
          documents={documentRows}
          attachedDocumentIds={evidenceAttachedIds}
          sourcePending={documentsPending}
          sourceError={documentsError ? t('projectDetail.billing.evidence.documentsError', "Couldn't load evidence documents") : null}
          onRetry={onRetryDocuments}
          onClose={onCloseEvidence}
          onAttach={onAttachEvidence}
          onError={onEvidenceError}
        />
      )}

      {raiseFor && (
        <ConfirmDialog
          open
          title={t('projectDetail.billing.claims.confirmRaise.title', "Raise this claim's invoice?")}
          description={
            <div className="flex flex-col gap-2">
              <p>{t('projectDetail.billing.claims.confirmRaise.body', 'An ERP sales invoice draft is created from this claim. A different Admin or Finance user submits it.')}</p>
              <p data-testid="raise-figures">
                {t('projectDetail.billing.claims.confirmRaise.figures', 'Claimed {{gross}} · down payment recovered {{recovery}} · net {{net}} (excl. PPN)', {
                  gross: formatCurrency(Number(raiseFor.claim.gross_amount), currency),
                  recovery: formatCurrency(Number(raiseFor.claim.dp_recovery_amount), currency),
                  net: formatCurrency(claimNet(Number(raiseFor.claim.gross_amount), Number(raiseFor.claim.dp_recovery_amount)), currency),
                  interpolation: { escapeValue: false },
                })}
              </p>
            </div>
          }
          confirmLabel={t('projectDetail.billing.claims.confirmRaise.confirm', 'Create ERP invoice')}
          loading={claimMutations.raiseInvoice.isPending}
          onConfirm={() => void onRaise()}
          onCancel={onCloseRaise}
        />
      )}

      {withdrawClaimFor && (
        <ConfirmDialog
          open
          tone="destructive"
          title={t('projectDetail.billing.claims.confirmWithdraw.title', 'Withdraw this claim?')}
          description={t('projectDetail.billing.claims.confirmWithdraw.body', 'Withdrawing is final. Its quantities and down payment recovery are released for a new claim.')}
          confirmLabel={t('projectDetail.billing.claims.confirmWithdraw.confirm', 'Withdraw claim')}
          loading={claimMutations.withdrawClaim.isPending}
          onConfirm={() => void onWithdrawClaimConfirm()}
          onCancel={onCloseWithdrawClaim}
        />
      )}

      {pending && (
        <ConfirmDialog
          open
          {...confirmCopy(pending)}
          confirmDisabled={pending.to === 'Issued' && (!may('transition', 'workOrder') || !canIssue(pending.row.id))}
          loading={transition.isPending}
          onConfirm={() => void onTransition(pending)}
          onCancel={onCloseTransition}
        />
      )}

      {/* The acknowledgement. Deliberately a SEPARATE confirm carrying the server's own sentence —
          it names the candidate total, the ceiling and what is already committed, which is more
          than any figure the client holds could promise to be current about. */}
      {overCommit && (
        <ConfirmDialog
          open
          tone="destructive"
          title={t(
            'projectDetail.workOrders.confirm.overCommit.title',
            'This would go past the contract ceiling',
          )}
          description={
            <div className="flex flex-col gap-2" data-testid="wo-over-commit-body">
              <p data-testid="wo-over-commit-message">{overCommit.message}</p>
              <p>
                {t(
                  'projectDetail.workOrders.confirm.overCommit.body',
                  'You may still issue it. If you do, your name and the time are recorded on this work order as the person who chose to over-commit.',
                )}
              </p>
            </div>
          }
          confirmLabel={t(
            'projectDetail.workOrders.confirm.overCommit.confirm',
            'Acknowledge and issue',
          )}
          loading={transition.isPending}
          confirmDisabled={!may('transition', 'workOrder') || !canIssue(overCommit.row.id)}
          onConfirm={() => void onAcknowledgedIssue(overCommit.row)}
          onCancel={onCloseOverCommit}
        />
      )}
    </>
  );
};

export default WorkOrdersModals;
