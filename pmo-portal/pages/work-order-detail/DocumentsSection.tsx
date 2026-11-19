import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState, RecordSection } from '@/src/components/ui';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';

interface Props { projectId: string; documents: ProjectDocumentRow[]; isPending: boolean; isError: boolean; onRetry: () => void }

/** Documents (FR-WORP-024, link-only v1): the files this work order's acceptances point to, opened on the project's Documents tab. */
export const DocumentsSection: React.FC<Props> = ({ projectId, documents, isPending, isError, onRetry }) => {
  const { t } = useTranslation('workOrders');
  const title = t('documents.title', 'Documents');
  if (isPending) return <RecordSection title={title}><ListState variant="loading" rows={1} /></RecordSection>;
  if (isError) return <RecordSection title={title}><ListState variant="error" title={t('documents.error', "Couldn't load the documents")} onRetry={onRetry} /></RecordSection>;
  return (
    <RecordSection title={title}>
      {documents.length === 0
        ? <p className="text-control text-muted-foreground">{t('documents.empty', 'No documents are linked to this work order yet.')}</p>
        : <ul className="divide-y divide-border" data-testid="wo-documents">
            {documents.map((d) => (
              <li key={d.id} className="py-1.5"><Link className="underline" to={`/projects/${projectId}?tab=documents`}>{d.title}</Link></li>
            ))}
          </ul>}
    </RecordSection>
  );
};
