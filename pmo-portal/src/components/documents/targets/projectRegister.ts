import { projectOwner, projectReference, validMicrosoftBrowserUrl } from '@/src/lib/m365/reference';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';
import type { DocumentViewTarget } from '../types';
import { referenceTarget } from './reference';
import { storageTarget, type SignedUrlAccessor } from './storage';

/** Build the shared viewer target for a project-register row, whether it is stored or Microsoft-backed. */
export function projectRegisterTarget(
  doc: ProjectDocumentRow,
  getSignedUrl: SignedUrlAccessor,
  detail?: string,
): DocumentViewTarget | null {
  const reference = projectReference(doc);
  let target: DocumentViewTarget | null = null;
  if (reference?.web_url) {
    if (validMicrosoftBrowserUrl(reference.web_url)) {
      target = referenceTarget({ reference, owner: projectOwner(doc), title: doc.title });
    }
  } else if (doc.file_path) {
    target = storageTarget({
      key: `project-document:${doc.id}`,
      name: doc.title,
      filePath: doc.file_path,
      getSignedUrl,
    });
  }
  return target && detail ? { ...target, detail } : target;
}
