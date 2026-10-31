import type { ReactNode } from 'react';

/** What a loaded document looks like to the panel. The URL lives in the viewer's memory only (NFR-002). */
export type PreviewResult =
  | { mode: 'image'; url: string }
  | { mode: 'pdf'; url: string }
  | { mode: 'embed'; url: string; provider: 'microsoft' | 'office-online' }
  | { mode: 'unsupported' };

export type PreviewFailureKind =
  | 'access_denied'
  | 'not_connected'
  | 'connection_stale'
  | 'consent_needed'
  | 'not_found'
  | 'unsupported'
  | 'rate_limited'
  | 'unavailable'
  | 'no_file'
  | 'expired';

export class PreviewFailure extends Error {
  constructor(public readonly kind: PreviewFailureKind, public readonly retryAfterSeconds?: number) {
    super(kind);
    this.name = 'PreviewFailure';
  }
}

export interface DocumentViewTarget {
  /** Stable identity: one active document owns the panel; a late result for another key is dropped. */
  key: string;
  name: string;
  /** 'SharePoint' | 'OneDrive' | 'Microsoft 365' | 'PMO' (display only). */
  sourceLabel: string;
  /** Runs on open and on Retry only (NFR-004). Throws `PreviewFailure`. */
  load: (signal: AbortSignal) => Promise<PreviewResult>;
  /** Authorized download of the original, independent of preview (FR-010). Rejects with the reason on a denial. */
  download?: () => Promise<void>;
  /** Validated https URL; the panel words the action from `sourceLabel` ("Open in SharePoint"). */
  openInSource?: { url: string };
  /** FR-012: the preview shows the latest source bytes, never the issued or approved version. */
  latestNotice?: boolean;
  /** Existing recovery / drift UI rendered under the preview (project controlled files). */
  extra?: ReactNode;
}
