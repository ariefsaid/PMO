import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, useToast } from '@/src/components/ui';
import { LinkedFolderTree } from '@/src/components/m365/LinkedFolderTree';
import { RecordFolderAction } from '@/src/components/m365/RecordFolderAction';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { FILE_INPUT_ACCEPT } from '@/src/lib/fileConstants';
import { projectReference } from '@/src/lib/m365/reference';
import { repositories, type ProjectDocumentInput, type ProjectDocumentRow } from '@/src/lib/repositories';
import { DocumentFormModal } from '../project-detail/tabs/DocumentFormModal';
import { useDocumentFiles } from '../project-detail/tabs/useDocumentFiles';

export interface WorkOrderDocumentSlot {
  headerActions: React.ReactNode;
  folderTree: React.ReactNode;
  renderRowAction: (doc: ProjectDocumentRow) => React.ReactNode;
  hiddenInput: React.ReactNode;
}

interface Props {
  workOrderId: string;
  projectId: string;
  documents: ProjectDocumentRow[];
  folderDoc: ProjectDocumentRow | null;
  children: (slot: WorkOrderDocumentSlot) => React.ReactNode;
}

/**
 * Interactive create, upload, and cloud-folder controls for one work order's documents.
 * Uses the caller's real role (no impersonated elevation) and ensures the work order's
 * SharePoint folder on first upload when the organisation has a connected default library.
 */
export const WorkOrderDocumentActions: React.FC<Props> = ({
  workOrderId,
  projectId,
  documents,
  folderDoc,
  children,
}) => {
  const { t } = useTranslation('workOrders');
  const { toast } = useToast();
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const roles = useEffectiveRole();
  const may = usePermission();
  const [showAdd, setShowAdd] = useState(false);

  const realActing = roles.realRole === roles.effectiveRole;
  const canCreate = realActing && may('create', 'document', { record: { work_order_id: workOrderId } });
  const canEditDoc = (doc: ProjectDocumentRow) =>
    realActing
    && Boolean(doc.work_order_id)
    && may('edit', 'document', {
      currentUserId: currentUser?.id,
      record: { author_id: doc.author_id, work_order_id: doc.work_order_id },
    });

  const createDoc = useMutation({
    mutationFn: (input: ProjectDocumentInput) =>
      repositories.document.create(projectId, input, currentUser?.id ?? null, workOrderId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['project-documents', currentUser?.org_id, projectId] });
    },
  });

  const { fileInputRef, handleFileSelected, fileCell } = useDocumentFiles(
    projectId,
    documents,
    canEditDoc,
    { workOrderId, hasFolder: Boolean(folderDoc) },
  );

  const folderRef = folderDoc ? projectReference(folderDoc) : null;
  const folderTree = folderDoc && folderRef ? (
    <LinkedFolderTree
      roots={[{
        key: folderDoc.id,
        title: folderDoc.title,
        drive_id: folderRef.drive_id,
        item_id: folderRef.item_id,
        web_url: folderRef.web_url,
      }]}
    />
  ) : null;

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      <RecordFolderAction compact target={{ kind: 'work_order', id: workOrderId }} hasFolder={Boolean(folderDoc)} />
      {canCreate && (
        <Button type="button" size="sm" variant="outline" onClick={() => setShowAdd(true)}>
          {t('documents.add', 'Add document')}
        </Button>
      )}
    </div>
  );

  const renderRowAction = (doc: ProjectDocumentRow) =>
    doc.work_order_id === workOrderId && doc.source !== 'onedrive' ? fileCell(doc) : null;

  const handleCreate = async (input: ProjectDocumentInput) => {
    await createDoc.mutateAsync(input);
    setShowAdd(false);
  };

  const handleCreateError = (err: unknown) => {
    const { headline, detail } = classifyMutationError(err, undefined, { suppressCapture: true });
    toast(headline, detail, 'warning');
  };

  return (
    <>
      {children({
        headerActions,
        folderTree,
        renderRowAction,
        hiddenInput: (
          <input
            ref={fileInputRef}
            type="file"
            accept={FILE_INPUT_ACCEPT}
            aria-label={t('documents.uploadAria', 'Choose document file')}
            className="sr-only"
            tabIndex={-1}
            onChange={handleFileSelected}
          />
        ),
      })}
      {showAdd && (
        <DocumentFormModal
          doc={null}
          onClose={() => setShowAdd(false)}
          onCreate={handleCreate}
          onUpdate={async () => undefined}
          onError={handleCreateError}
        />
      )}
    </>
  );
};
