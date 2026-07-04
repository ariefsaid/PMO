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
