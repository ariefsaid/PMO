import type { MicrosoftReference, ReferenceOwner } from '@/src/lib/m365/reference';
import type { DocumentViewTarget } from '../types';
import { microsoftTarget } from './microsoft';
import { projectDocumentTarget } from './project';

/** The viewer target for a stored Microsoft FILE reference, by who owns it (project / purchase / budget). */
export function referenceTarget(input: { reference: MicrosoftReference; owner: ReferenceOwner; title?: string }): DocumentViewTarget {
  const { reference, owner } = input;
  if (owner.kind === 'project') return projectDocumentTarget({ reference, owner, title: input.title });
  return microsoftTarget({
    request: owner.kind === 'procurement' ? { kind: 'procurement_document', id: owner.id } : { kind: 'budget_link', id: owner.id },
    name: input.title ?? reference.name,
    webUrl: reference.web_url,
  });
}

/** A file inside a linked folder: previewed as a direct child of the owner's folder reference (FR-015). */
export function folderChildTarget(input: { owner: ReferenceOwner; childItemId: string; name: string; webUrl: string }): DocumentViewTarget {
  const { owner } = input;
  const kind = owner.kind === 'project' ? 'project_document' : owner.kind === 'procurement' ? 'procurement_document' : 'budget_link';
  return microsoftTarget({
    request: { kind, id: owner.id, child_item_id: input.childItemId },
    name: input.name,
    webUrl: input.webUrl,
  });
}
