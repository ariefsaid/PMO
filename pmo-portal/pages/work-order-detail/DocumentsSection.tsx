import React from 'react';
import { useViewerOnDemand } from '@/src/components/documents/viewerContext';
import { storageTarget } from '@/src/components/documents/targets/storage';
import { referenceTarget } from '@/src/components/documents/targets/reference';
import { projectOwner, projectReference, validMicrosoftBrowserUrl } from '@/src/lib/m365/reference';
import { repositories } from '@/src/lib/repositories';
import { useTranslation } from 'react-i18next';
import { ListState, RecordSection } from '@/src/components/ui';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';
import { WorkOrderDocumentActions, type WorkOrderDocumentSlot } from './WorkOrderDocumentActions';

interface Props {
  workOrderId?: string;
  projectId?: string;
  folderDoc?: ProjectDocumentRow | null;
  documents: ProjectDocumentRow[];
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
}

const EMPTY_SLOT: WorkOrderDocumentSlot = {
  headerActions: null,
  folderTree: null,
  renderRowAction: () => null,
  hiddenInput: null,
};

/** Caller-visible work-order documents and cloud folder tree. */
export const DocumentsSection: React.FC<Props> = ({
  workOrderId,
  projectId,
  folderDoc = null,
  documents,
  isPending,
  isError,
  onRetry,
}) => {
  const { t } = useTranslation('workOrders');
  const viewer = useViewerOnDemand();
  const open = (doc: ProjectDocumentRow) => {
    const reference = projectReference(doc);
    if (reference?.web_url && validMicrosoftBrowserUrl(reference.web_url)) {
      viewer.open(referenceTarget({ reference, owner: projectOwner(doc), title: doc.title }));
    } else if (doc.file_path) {
      viewer.open(storageTarget({ key: `project-document:${doc.id}`, name: doc.title, filePath: doc.file_path,
        getSignedUrl: (path, opts) => repositories.document.getSignedUrl(path, opts) }));
    }
  };
  const title = t('documents.title', 'Documents');
  if (isPending) return <RecordSection title={title}><ListState variant="loading" rows={1} /></RecordSection>;
  if (isError) return <RecordSection title={title}><ListState variant="error" title={t('documents.error', "Couldn't load the documents")} onRetry={onRetry} /></RecordSection>;

  const renderContent = (slot: WorkOrderDocumentSlot) => (
    <RecordSection title={title}>
      {slot.headerActions && <div className="mb-3">{slot.headerActions}</div>}
      {slot.folderTree && <div className="mb-3 rounded-lg border border-border">{slot.folderTree}</div>}
      {documents.length === 0
        ? <p className="text-control text-muted-foreground">{t('documents.empty', 'No visible documents are linked to this work order yet.')}</p>
        : <ul className="divide-y divide-border" data-testid="wo-documents">
            {documents.map((d) => {
              const ref = projectReference(d);
              const canOpen = Boolean(d.file_path || (ref?.web_url && validMicrosoftBrowserUrl(ref.web_url)));
              const action = slot.renderRowAction(d);
              return (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span>{canOpen
                    ? <button type="button" className="underline" onClick={() => open(d)}>{d.title}</button>
                    : d.title}</span>
                  {action}
                </li>
              );
            })}
          </ul>}
      {slot.hiddenInput}
    </RecordSection>
  );

  if (workOrderId && projectId) {
    return (
      <WorkOrderDocumentActions
        workOrderId={workOrderId}
        projectId={projectId}
        documents={documents}
        folderDoc={folderDoc}
      >
        {renderContent}
      </WorkOrderDocumentActions>
    );
  }
  return renderContent(EMPTY_SLOT);
};
