import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ConfirmDialog } from '@/src/components/ui';
import { DocumentFormModal } from './DocumentFormModal';
import { NewRevisionModal } from '@/src/components/NewRevisionModal';
import { FILE_INPUT_ACCEPT } from '@/src/lib/fileConstants';
import type { ProjectDocumentRow, DocStatus } from '@/src/lib/db/documents';
import type { MicrosoftReferenceInput } from '@/src/lib/m365/reference';

/**
 * The bare action word for a transition, used as the confirm-dialog title verb.
 * Derived from the target STATUS (a stable enum) rather than by stripping an English
 * " document" suffix off the translated verb, which only ever worked in English.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the confirm-title verb is shared with the tab's bulk toast.
export function transitionActionLabel(to: DocStatus, t: TFunction): string {
  switch (to) {
    case 'Issued':
      return t('projectDetail.documents.action.issue', 'Issue');
    case 'Approved':
      return t('projectDetail.documents.action.approve', 'Approve');
    case 'Rejected':
      return t('projectDetail.documents.action.reject', 'Reject');
    case 'Draft':
      return t('projectDetail.documents.action.reopen', 'Reopen for revision');
    default:
      return t('projectDetail.documents.action.close', 'Close document');
  }
}

export interface DocumentsPendingTransition {
  doc: ProjectDocumentRow;
  to: DocStatus;
  verb: string;
}

/** The register's dialogs: create/edit modal, file input, new revision, and the four confirms. */
const DocumentsDialogs: React.FC<{
  formTarget: { doc: ProjectDocumentRow | null; reference?: MicrosoftReferenceInput } | null;
  setFormTarget: React.Dispatch<React.SetStateAction<{ doc: ProjectDocumentRow | null; reference?: MicrosoftReferenceInput } | null>>;
  canCreateMicrosoftReference: boolean;
  onCreateDocument: React.ComponentProps<typeof DocumentFormModal>['onCreate'];
  onUpdateDocument: React.ComponentProps<typeof DocumentFormModal>['onUpdate'];
  onDocumentError: React.ComponentProps<typeof DocumentFormModal>['onError'];
  onChangeReference: React.ComponentProps<typeof DocumentFormModal>['onChangeReference'];
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileSelected: (event: React.ChangeEvent<HTMLInputElement>) => void;
  revisionTarget: { parent: ProjectDocumentRow; reference: MicrosoftReferenceInput } | null;
  revisionParent: ProjectDocumentRow | null;
  onCreateRevision: (data: { title: string; code: string; category: string; revision: string; doc_date: string; microsoft?: MicrosoftReferenceInput }) => void;
  revisionLoading: boolean;
  onRevisionClose: () => void;
  unlinkTarget: ProjectDocumentRow | null;
  onUnlinkConfirm: () => void;
  onUnlinkClose: () => void;
  /** Read lazily inside the unlink dialog's own conditional, exactly as the tab did. */
  unlink: { isPending: boolean };
  pending: DocumentsPendingTransition | null;
  onTransitionConfirm: () => void;
  onTransitionCancel: () => void;
  transitionLoading: boolean;
  pendingBulkStatus: DocStatus | null;
  onBulkStatusConfirm: () => void;
  onBulkStatusCancel: () => void;
  bulkSelectedCount: number;
  deleteTarget: ProjectDocumentRow | null;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  deleteLoading: boolean;
}> = ({
  formTarget,
  setFormTarget,
  canCreateMicrosoftReference,
  onCreateDocument,
  onUpdateDocument,
  onDocumentError,
  onChangeReference,
  fileInputRef,
  onFileSelected,
  revisionTarget,
  revisionParent,
  onCreateRevision,
  revisionLoading,
  onRevisionClose,
  unlinkTarget,
  onUnlinkConfirm,
  onUnlinkClose,
  unlink,
  pending,
  onTransitionConfirm,
  onTransitionCancel,
  transitionLoading,
  pendingBulkStatus,
  onBulkStatusConfirm,
  onBulkStatusCancel,
  bulkSelectedCount,
  deleteTarget,
  onDeleteConfirm,
  onDeleteCancel,
  deleteLoading,
}) => {
  const { t } = useTranslation('project');

  return (
    <>
      {/* Create / edit metadata modal */}
      {formTarget && (
        <DocumentFormModal
          doc={formTarget.doc}
          reference={formTarget.reference}
          readOnly={!!formTarget.reference && !canCreateMicrosoftReference}
          onChangeReference={onChangeReference}
          onClose={() => setFormTarget(null)}
          onCreate={onCreateDocument}
          onUpdate={onUpdateDocument}
          onError={onDocumentError}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={FILE_INPUT_ACCEPT}
        aria-label={t('projectDetail.documents.uploadAriaLabel', 'Upload a document')}
        className="hidden"
        onChange={onFileSelected}
        data-testid="file-input"
      />

      {(revisionTarget ?? (revisionParent ? { parent: revisionParent, reference: null } : null)) && (
        <NewRevisionModal
          parent={(revisionTarget?.parent ?? revisionParent) as ProjectDocumentRow}
          microsoft={revisionTarget?.reference ?? null}
          readOnly={!!revisionTarget && !canCreateMicrosoftReference}
          onSubmit={onCreateRevision}
          onClose={onRevisionClose}
          loading={revisionLoading}
        />
      )}

      {/* Unlink confirm: removes only PMO's reference, never anything in Microsoft. */}
      {unlinkTarget && (
        <ConfirmDialog
          open
          tone="default"
          title={t('m365Documents.unlinkTitle', 'Unlink {{title}}?', { title: unlinkTarget.title })}
          description={t('m365Documents.unlinkBody', 'Only the PMO reference is removed. The Microsoft item is unchanged.')}
          confirmLabel={t('m365Documents.unlinkConfirm', 'Unlink')}
          loading={unlink.isPending}
          onConfirm={onUnlinkConfirm}
          onCancel={onUnlinkClose}
        />
      )}

      {/* Status transition confirm (default tone; Reject reads as destructive). */}
      <ConfirmDialog
        open={!!pending}
        tone={pending?.to === 'Rejected' ? 'destructive' : 'default'}
        title={
          pending
            ? `${transitionActionLabel(pending.to, t)} ${pending.doc.title}?`
            : t('projectDetail.documents.transitionConfirm.titleFallback', 'Update status?')
        }
        description={
          pending?.to === 'Approved'
            ? t(
                'projectDetail.documents.transitionConfirm.approved',
                'Approving records you as the reviewer. This is a segregation-of-duties step and is recorded.',
              )
            : pending?.to === 'Rejected'
              ? t(
                  'projectDetail.documents.transitionConfirm.rejected',
                  'Rejecting returns the document for revision. This is recorded.',
                )
              : pending?.to === 'Issued'
                ? t(
                    'projectDetail.documents.transitionConfirm.issued',
                    'Issuing moves the document into review so a reviewer can approve or reject it.',
                  )
                : t(
                    'projectDetail.documents.transitionConfirm.closed',
                    'Closing finalises the document. This is a terminal status.',
                  )
        }
        confirmLabel={
          pending?.verb ?? t('projectDetail.documents.transitionConfirm.confirmFallback', 'Update status')
        }
        loading={transitionLoading}
        onConfirm={onTransitionConfirm}
        onCancel={onTransitionCancel}
      />

      <ConfirmDialog
        open={!!pendingBulkStatus}
        tone={pendingBulkStatus === 'Rejected' ? 'destructive' : 'default'}
        title={pendingBulkStatus
          ? t('projectDetail.documents.bulk.confirmTitle', 'Update status for selected documents?')
          : t('projectDetail.documents.transitionConfirm.titleFallback', 'Update status?')}
        description={pendingBulkStatus === 'Approved'
          ? t('projectDetail.documents.bulk.approvalDescription', 'Apply this approval to {{count}} selected documents. Approval is recorded and follows the reviewer separation rule.', { count: bulkSelectedCount })
          : pendingBulkStatus === 'Rejected'
            ? t('projectDetail.documents.bulk.rejectionDescription', 'Rejecting returns selected documents for revision. This change will be recorded.')
            : pendingBulkStatus === 'Issued'
              ? t('projectDetail.documents.bulk.issueDescription', 'Issuing moves selected documents into review so a reviewer can approve or reject them.')
              : pendingBulkStatus === 'Closed'
                ? t('projectDetail.documents.bulk.closeDescription', 'Closing finalises the selected documents.')
                : t('projectDetail.documents.bulk.confirmDescription', 'Apply this status change to {{count}} selected documents. The change will be recorded.', { count: bulkSelectedCount })}
        confirmLabel={t('projectDetail.documents.bulk.confirmAction', 'Confirm status change')}
        loading={transitionLoading}
        onConfirm={onBulkStatusConfirm}
        onCancel={onBulkStatusCancel}
      />

      {/* Delete confirm (destructive tone; Admin only). */}
      <ConfirmDialog
        open={!!deleteTarget}
        tone="destructive"
        title={
          deleteTarget
            ? `${t('projectDetail.documents.action.delete', 'Delete')} ${deleteTarget.title}?`
            : t('projectDetail.documents.deleteConfirm.titleFallback', 'Delete document?')
        }
        description={t(
          'projectDetail.documents.deleteConfirm.body',
          "This permanently removes the document register entry. This can't be undone.",
        )}
        confirmLabel={t('projectDetail.documents.deleteConfirm.confirm', 'Delete document')}
        loading={deleteLoading}
        onConfirm={onDeleteConfirm}
        onCancel={onDeleteCancel}
      />
    </>
  );
};

export default DocumentsDialogs;
