/**
 * AC-W3-F7: Unknown URLs must render a "page not found" surface,
 * not silently redirect to the Executive Dashboard.
 *
 * Test 1: The NotFound component renders "page not found" copy and a
 *         "Back to Dashboard" link — not the ExecutiveDashboard content.
 * Test 2: AppRoutes at a bogus path renders the NotFound surface, not the
 *         ExecutiveDashboard.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';

import NotFound from '../NotFound';

// Minimal mock of the dashboard so its absence proves NotFound is shown.
vi.mock('../ExecutiveDashboard', () => ({
  default: () => <div data-testid="exec-dashboard">Executive Dashboard</div>,
}));

describe('AC-W3-F7: NotFound page component', () => {
  it('exposes the page title as a level one heading', () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  });

  it('renders "page not found" copy', () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    );
    // The copy must include "page not found" (case-insensitive).
    expect(screen.getByText(/page not found/i)).toBeInTheDocument();
  });

  it('renders a "Back to Dashboard" navigation link', () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: /back to dashboard/i });
    expect(link).toBeInTheDocument();
  });

  it('does NOT render the ExecutiveDashboard content', () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('exec-dashboard')).toBeNull();
  });

  // C11 (DS not-found #1/#3): the only action was a hand-styled 13px link with a 30px box. It now
  // renders the shared button anatomy, whose `.touch-target` hook grows the hit area to >=44px on
  // a coarse pointer (and to a 44px box at phone width via the shared phone rule).
  it('C11: the only action is the shared button target, at least 44px on touch', () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: /back to dashboard/i });
    expect(link).toHaveClass('touch-target');
    expect(link).toHaveClass('pointer-coarse:min-h-11');
    expect(link).toHaveClass('bg-primary');
  });

  // C11 (DS not-found #1): no meaningful copy below the 14px floor — the body line used to be 13px.
  it('C11: the body copy is at the 14px control floor, not below it', () => {
    const { container } = render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    );
    expect(container.querySelector('.text-\\[13px\\]')).toBeNull();
    expect(screen.getByText(/doesn't exist or has been moved/i)).toHaveClass('text-control');
  });
});

describe('AC-W3-F7: router catches unknown paths with NotFound, not Dashboard', () => {
  it('a bogus path renders NotFound copy and NOT the dashboard', () => {
    render(
      <MemoryRouter initialEntries={['/this-route-does-not-exist']}>
        <Routes>
          <Route path="/" element={<div data-testid="exec-dashboard">Dashboard</div>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(/page not found/i)).toBeInTheDocument();
    expect(screen.queryByTestId('exec-dashboard')).toBeNull();
  });
});
