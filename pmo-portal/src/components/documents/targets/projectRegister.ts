import { projectOwner, projectReference, validMicrosoftBrowserUrl } from '@/src/lib/m365/reference';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';
import type { DocumentViewTarget } from '../types';
import { referenceTarget } from './reference';
import { storageTarget, type SignedUrlAccessor } from './storage';

/** The viewer target for one project register row: a valid Microsoft reference, else its stored file, else null. */
export function projectRegisterTarget(doc: ProjectDocumentRow, getSignedUrl: SignedUrlAccessor): DocumentViewTarget | null {
  const reference = projectReference(doc);
  if (reference?.web_url) {
    if (!validMicrosoftBrowserUrl(reference.web_url)) return null;
    return referenceTarget({ reference, owner: projectOwner(doc), title: doc.title });
  }
  if (!doc.file_path) return null;
  return storageTarget({ key: `project-document:${doc.id}`, name: doc.title, filePath: doc.file_path, getSignedUrl });
}
