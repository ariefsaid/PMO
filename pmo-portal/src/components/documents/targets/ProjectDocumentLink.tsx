import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui/Button';
import { repositories } from '@/src/lib/repositories';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';
import { useViewerOnDemand } from '../viewerContext';
import { projectRegisterTarget } from './projectRegister';

export interface ProjectDocumentLinkProps {
  documentId: string | null;
  /** Readable project-register rows already loaded by the owning surface. */
  documents: ReadonlyArray<ProjectDocumentRow>;
}

/** A linked project document by name; an id outside the readable register is never shown raw. */
export function ProjectDocumentLink({ documentId, documents }: ProjectDocumentLinkProps) {
  const { t } = useTranslation('documentViewer');
  const viewer = useViewerOnDemand();
  const doc = documentId ? documents.find((candidate) => candidate.id === documentId) : undefined;
  if (!doc) return <span className="text-muted-foreground">{t('viewer.unavailableDocument', 'Document not available')}</span>;

  const target = projectRegisterTarget(doc, (path, opts) => repositories.document.getSignedUrl(path, opts));
  if (!target) return <span>{doc.title}</span>;

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={t('viewer.previewNamed', 'Preview {{name}}', { name: doc.title })}
      onClick={(event) => viewer.open(target, event.currentTarget)}
    >
      {doc.title}
    </Button>
  );
}
