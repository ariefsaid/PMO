import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ErrorBoundary } from './ErrorBoundary';

// A child that throws on first render, then can be flipped to render normally
// so we can prove the reset action recovers the tree (not just a static fallback).
function Boom({ crash }: { crash: boolean }): React.ReactElement {
  if (crash) throw new Error('kaboom');
  return <div>recovered content</div>;
}

describe('ErrorBoundary (reliability harden #4 — render throw must not white-screen)', () => {
  // React logs the caught error to console.error; silence it to keep the run clean.
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
  });

  it('renders the fallback (not a blank screen) when a child throws', () => {
    render(
      <ErrorBoundary>
        <Boom crash />
      </ErrorBoundary>,
    );
    // Fallback is present with an accessible alert role + a human message.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    // The thrown message/content is NOT what the user sees — the app did not white-screen.
    expect(screen.queryByText('recovered content')).not.toBeInTheDocument();
  });

  it('offers retry and home actions', () => {
    render(
      <ErrorBoundary>
        <Boom crash />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /home/i })).toBeInTheDocument();
  });

  it('retry resets the boundary so a recovered child renders again', () => {
    // The child throws while `crash` is true; after clicking retry with a now-healthy
    // child, the boundary must clear its error state and re-render children.
    function Harness(): React.ReactElement {
      const [crash, setCrash] = React.useState(true);
      return (
        <ErrorBoundary onReset={() => setCrash(false)}>
          <Boom crash={crash} />
        </ErrorBoundary>
      );
    }
    render(<Harness />);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(screen.getByText('recovered content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders children unchanged when nothing throws', () => {
    render(
      <ErrorBoundary>
        <Boom crash={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('recovered content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// ── PostHog exception capture (observability floor, S6) ─────────────────────
// A second describe block in the same file, per the plan: ErrorBoundary.tsx
// imports analyticsClient from '@/src/lib/analytics/client' directly (the barrel
// deliberately does not export it) and safeTrack from the barrel
// '@/src/lib/analytics'. Two separate vi.mock calls are needed because the two
// specifiers point at different modules.
const analyticsMock = vi.hoisted(() => ({
  captureException: vi.fn(),
}));
vi.mock('@/src/lib/analytics/client', () => ({
  analyticsClient: analyticsMock,
}));
vi.mock('@/src/lib/analytics', () => ({
  safeTrack: (fn: () => void) => {
    try {
      fn();
    } catch {
      // mirror the real safeTrack's swallow behavior in the test double
    }
  },
}));

function BoomWithCapture({ crash }: { crash: boolean }): React.ReactElement {
  if (crash) throw new Error('kaboom');
  return <div>recovered content</div>;
}

describe('ErrorBoundary — PostHog exception capture (observability floor)', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    analyticsMock.captureException.mockClear();
  });
  afterEach(() => errSpy.mockRestore());

  it('AC-OF-009: calls captureException with {name, message, componentStack} exactly once per caught error', () => {
    render(
      <ErrorBoundary>
        <BoomWithCapture crash />
      </ErrorBoundary>,
    );
    expect(analyticsMock.captureException).toHaveBeenCalledTimes(1);
    const arg = analyticsMock.captureException.mock.calls[0][0];
    expect(arg).toMatchObject({ name: 'Error', message: 'kaboom' });
    expect(typeof arg.componentStack).toBe('string');
  });

  it('AC-OF-009: console.error is still called (existing behavior preserved)', () => {
    render(
      <ErrorBoundary>
        <BoomWithCapture crash />
      </ErrorBoundary>,
    );
    expect(errSpy).toHaveBeenCalled();
  });
});
