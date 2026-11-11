import type { ReactNode } from 'react';
import { previewMicrosoftDocument, type PreviewRequestInput } from '@/src/lib/m365/previewClient';
import { microsoftProvenance, validMicrosoftBrowserUrl } from '@/src/lib/m365/reference';
import type { DocumentViewTarget } from '../types';

export interface MicrosoftTargetInput {
  /** The typed PMO identity the server reads under the caller's JWT; never a drive, item or URL. */
  request: PreviewRequestInput;
  name: string;
  /** The stored browser URL: used only for the provenance label and the validated Open-in-source action. */
  webUrl: string;
  extra?: ReactNode;
  latestNotice?: boolean;
}

/** A short, non-reversible tag for a child id so two children of one folder are two documents without putting the id in the key. */
function tag(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) h = ((h * 33) ^ value.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** One adapter for every Microsoft-backed document (project, purchase, budget, folder child, purchase attachment). */
export function microsoftTarget(input: MicrosoftTargetInput): DocumentViewTarget {
  const { request } = input;
  const child = 'child_item_id' in request && request.child_item_id ? `:${tag(request.child_item_id)}` : '';
  return {
    key: `ms:${request.kind}:${'phase' in request ? `${request.phase}:` : ''}${request.id}${child}`,
    name: input.name,
    sourceLabel: microsoftProvenance(input.webUrl),
    load: (signal) => previewMicrosoftDocument(request, signal),
    openInSource: validMicrosoftBrowserUrl(input.webUrl) ? { url: input.webUrl } : undefined,
    extra: input.extra,
    latestNotice: input.latestNotice,
  };
}
