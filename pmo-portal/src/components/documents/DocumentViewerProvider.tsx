import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { DocumentViewer } from './DocumentViewer';
import { DocumentViewerContext, type DocumentViewerApi, type ViewerState } from './viewerContext';
import { PreviewFailure, type DocumentViewTarget } from './types';

/**
 * One active document owns the side panel (FR-001). The panel opens and shows its loading state before any
 * source I/O (NFR-004); `load` runs on open and on Retry only, a late result for a superseded or closed
 * document is dropped (FR-011), and the result (a short-lived URL) lives in this component's state only:
 * never in the query cache, a log or storage (NFR-002).
 */
export function DocumentViewerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ViewerState>({ phase: 'closed' });
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  /** The target of the committed failed state: Retry reads it here, so no side effect runs inside a state updater. */
  const failedTarget = useRef<DocumentViewTarget | null>(null);
  useEffect(() => { failedTarget.current = state.phase === 'failed' ? state.target : null; }, [state]);

  const run = useCallback((target: DocumentViewTarget) => {
    controller.current?.abort();
    const ac = (controller.current = new AbortController());
    const gen = ++generation.current;
    setState({ phase: 'loading', target });
    const current = () => gen === generation.current && !ac.signal.aborted;
    // `load` may throw synchronously; a rejected promise is the same failure.
    Promise.resolve().then(() => target.load(ac.signal)).then(
      (result) => { if (current()) setState({ phase: 'ready', target, result }); },
      (err: unknown) => {
        if (!current()) return;
        setState(err instanceof PreviewFailure
          ? { phase: 'failed', target, kind: err.kind, retryAfterSeconds: err.retryAfterSeconds }
          : { phase: 'failed', target, kind: 'unavailable' });
      },
    );
  }, []);

  const open = useCallback((target: DocumentViewTarget, opener?: HTMLElement | null) => {
    openerRef.current = opener ?? (document.activeElement as HTMLElement | null);
    run(target);
  }, [run]);

  const close = useCallback(() => {
    controller.current?.abort();
    generation.current += 1;
    setState({ phase: 'closed' });
    const el = openerRef.current;
    openerRef.current = null;
    requestAnimationFrame(() => { if (el?.isConnected) el.focus({ preventScroll: true }); });
  }, []);

  // A render error in the image (expired URL, deleted object) is a failed load, not a blank panel.
  const renderFailed = useCallback(() => {
    setState((s) => (s.phase === 'ready' ? { phase: 'failed', target: s.target, kind: 'unavailable' } : s));
  }, []);

  const retry = useCallback(() => {
    const target = failedTarget.current;
    if (target) run(target);
  }, [run]);

  // A route change closes the panel so a stale document never covers a new page; a search/filter change keeps it.
  const { pathname } = useLocation();
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    controller.current?.abort();
    generation.current += 1;
    setState({ phase: 'closed' });
  }, [pathname]);

  useEffect(() => () => { controller.current?.abort(); }, []);

  const api = useMemo<DocumentViewerApi>(() => ({ open, close }), [open, close]);
  return (
    <DocumentViewerContext.Provider value={api}>
      {children}
      <DocumentViewer state={state} onClose={close} onRetry={retry} onRenderError={renderFailed} />
    </DocumentViewerContext.Provider>
  );
}
