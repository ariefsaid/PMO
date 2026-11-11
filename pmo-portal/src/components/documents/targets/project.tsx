import type { MicrosoftReference } from '@/src/lib/m365/reference';
import type { DocumentViewTarget } from '../types';
import { ControlledExtra, type ProjectOwner } from './ControlledExtra';
import { microsoftTarget } from './microsoft';

export function projectDocumentTarget(input: { reference: MicrosoftReference; owner: ProjectOwner; title?: string }): DocumentViewTarget {
  const { reference, owner } = input;
  const controlled = owner.status !== 'Draft';
  return microsoftTarget({
    request: { kind: 'project_document', id: owner.id },
    name: input.title ?? reference.name,
    webUrl: reference.web_url,
    latestNotice: controlled,
    extra: controlled ? <ControlledExtra reference={reference} owner={owner} /> : undefined,
  });
}
