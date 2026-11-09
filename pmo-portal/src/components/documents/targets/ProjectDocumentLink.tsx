import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui';
import { repositories } from '@/src/lib/repositories';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';
import { useViewerOnDemand } from '../viewerContext';
import { projectRegisterTarget } from './projectRegister';

export interface ProjectDocumentLinkProps {
  documentId: string | null;
  /** The project's readable register rows, already loaded by the host surface. */
  documents: ProjectDocumentRow[];
}

/** A linked project document by name: opens the shared viewer; an id outside the readable register is never shown raw. */
export function ProjectDocumentLink({ documentId, documents }: ProjectDocumentLinkProps) {
  const { t } = useTranslation('documentViewer');
  const viewer = useViewerOnDemand();
  const doc = documentId ? documents.find((d) => d.id === documentId) : undefined;
  if (!doc) return <span className="text-muted-foreground">{t('viewer.unavailableDocument', 'Document not available')}</span>;
  const target = projectRegisterTarget(doc, (path, opts) => repositories.document.getSignedUrl(path, opts));
  if (!target) return <span>{doc.title}</span>;
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={t('viewer.previewNamed', 'Preview {{name}}', { name: doc.title })}
      onClick={(e) => viewer.open(target, e.currentTarget)}
    >
      {doc.title}
    </Button>
  );
}
