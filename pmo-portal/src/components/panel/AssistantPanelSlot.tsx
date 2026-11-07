import React, { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { lazyWithPreload } from '@/src/lib/lazyWithPreload';

// Perf: the panel pulls markdown, the viewspec compiler and the chart widgets (recharts) — none needed for
// first paint, and it mounts closed. Own chunk, fetched right after the shell renders.
const loadPanel = () => import('./AssistantPanel').then((m) => ({ default: m.AssistantPanel }));
const makePanel = () => lazyWithPreload(loadPanel);

/** Contains a failed panel chunk to the panel: the shell keeps working, Retry re-imports. */
class PanelBoundary extends React.Component<
  { onRetry: () => void; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="fixed bottom-4 right-4 z-40 rounded-lg border border-border bg-card p-3 text-sm shadow-sm">
        <p className="text-foreground">The assistant could not load.</p>
        <button
          type="button"
          className="mt-2 rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-accent"
          onClick={() => {
            this.props.onRetry();
            this.setState({ failed: false });
          }}
        >
          Retry
        </button>
      </div>
    );
  }
}

export const AssistantPanelSlot: React.FC<{ open: boolean }> = ({ open }) => {
  const [Panel, setPanel] = useState(makePanel);
  // Focus owner at the moment of opening: the panel may mount after that, when focus has already moved to <body>.
  const openerRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    openerRef.current = open ? (document.activeElement as HTMLElement | null) : null;
  }, [open]);
  // React.lazy swallows its own rejection, so start the import in a void-style call: the rejection
  // then reaches the stale-chunk reload guard exactly as a route chunk's does.
  useEffect(() => {
    Panel.preload().catch((reason: unknown) => {
      window.dispatchEvent(
        new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason }),
      );
    });
  }, [Panel]);
  return (
    <PanelBoundary onRetry={() => setPanel(makePanel)}>
      <Suspense fallback={null}>
        <Panel openerRef={openerRef} />
      </Suspense>
    </PanelBoundary>
  );
};
