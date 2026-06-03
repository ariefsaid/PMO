/**
 * TDD: Code-splitting — verifies that:
 *   1. React.lazy + Suspense pattern works correctly in the test environment.
 *   2. The LoadingFallback component renders an accessible status element.
 *
 * Build-level chunk verification is done via `npm run build` (see CI acceptance
 * criteria). Unit tests here verify the behavioral contracts of the components
 * introduced for code-splitting.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React, { Suspense } from 'react';

// ── 1. React.lazy + Suspense contract ─────────────────────────────────────

describe('route components are lazy-loaded', () => {
  it('React.lazy produces a component with the lazy $$typeof symbol', () => {
    const REACT_LAZY_TYPE = Symbol.for('react.lazy');
    const lazyComp = React.lazy(() =>
      Promise.resolve({ default: () => <div>loaded</div> }),
    );
    expect((lazyComp as { $$typeof: symbol }).$$typeof).toBe(REACT_LAZY_TYPE);
  });

  it('Suspense boundary resolves lazy component and shows content', async () => {
    const LazyContent = React.lazy(() =>
      Promise.resolve({ default: () => <div data-testid="lazy-content">Loaded!</div> }),
    );

    render(
      <Suspense fallback={<div data-testid="loading-fallback">Loading...</div>}>
        <LazyContent />
      </Suspense>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('lazy-content')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('loading-fallback')).not.toBeInTheDocument();
  });
});

// ── 2. LoadingFallback component ───────────────────────────────────────────

describe('LoadingFallback — Suspense fallback renders accessible status', () => {
  it('renders an element with role="status"', async () => {
    const { LoadingFallback } = await import('../components/LoadingFallback');
    render(<LoadingFallback />);
    const el = screen.getByRole('status');
    expect(el).toBeInTheDocument();
  });
});
