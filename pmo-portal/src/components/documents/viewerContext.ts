import { createContext, useContext } from 'react';
import type { DocumentViewTarget, PreviewFailureKind, PreviewResult } from './types';

export type ViewerState =
  | { phase: 'closed' }
  | { phase: 'loading'; target: DocumentViewTarget }
  | { phase: 'ready'; target: DocumentViewTarget; result: PreviewResult }
  | { phase: 'failed'; target: DocumentViewTarget; kind: PreviewFailureKind; retryAfterSeconds?: number };

export interface DocumentViewerApi {
  /** Open the panel for one document. `opener` is the control to refocus on close (defaults to the focused element). */
  open: (target: DocumentViewTarget, opener?: HTMLElement | null) => void;
  close: () => void;
}

export const DocumentViewerContext = createContext<DocumentViewerApi | null>(null);

export function useDocumentViewer(): DocumentViewerApi {
  const viewer = useContext(DocumentViewerContext);
  if (!viewer) throw new Error('useDocumentViewer must be used inside <DocumentViewerProvider>');
  return viewer;
}

/** For surfaces that also render outside the app shell (tests, embeds): no provider means no Preview affordance. */
export function useOptionalDocumentViewer(): DocumentViewerApi | null {
  return useContext(DocumentViewerContext);
}

const MISSING: DocumentViewerApi = {
  open: () => { throw new Error('Preview needs <DocumentViewerProvider>'); },
  close: () => {},
};

/**
 * For leaf surfaces rendered bare in many tests: resolves without a provider and fails loudly only when a
 * preview is actually opened (the shell always mounts the provider).
 */
export function useViewerOnDemand(): DocumentViewerApi {
  return useContext(DocumentViewerContext) ?? MISSING;
}
