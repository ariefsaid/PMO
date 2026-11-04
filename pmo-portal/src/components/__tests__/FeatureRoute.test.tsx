/**
 * AC-PLN-008 [Vitest] — what a gated route renders.
 *
 * Four states, and the differences between them are the whole point:
 *   - core        → the page renders immediately;
 *   - loading     → HOLD (null), so a deep-link never flash-denies a module the org has;
 *   - read failed → the unavailable-with-retry state, never the words "not on your plan";
 *   - resolved off→ the not-available state (the page is NOT rendered, and there is no redirect
 *                   racing the shell — the old behaviour redirected to `/`; AC-PLN-008 asks the
 *                   route to say why);
 *   - resolved on → the page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import React from 'react';

const { useOrgFeaturesState } = vi.hoisted(() => ({
  useOrgFeaturesState: {
    value: {
      isLoading: false,
      isError: false,
      data: { incidents: false } as Record<string, boolean> | undefined,
      refetch: vi.fn(),
    },
  },
}));

vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => useOrgFeaturesState.value,
}));

import { FeatureRoute } from '../FeatureRoute';

const Home = () => <div data-testid="home">Home</div>;
const Guarded = () => <div data-testid="guarded">INCIDENTS</div>;

const renderAt = (path: string, feature: 'incidents' | 'projects' = 'incidents') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route
          path="/guarded"
          element={<FeatureRoute feature={feature} element={feature === 'incidents' ? <Guarded /> : <div data-testid="guarded-projects">PROJECTS</div>} />}
        />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  useOrgFeaturesState.value = {
    isLoading: false,
    isError: false,
    data: { incidents: false },
    refetch: vi.fn(),
  };
});

describe('AC-PLN-008 — FeatureRoute states', () => {
  it('AC-PLN-008: resolved OFF renders the not-available state, not the page and not a redirect', () => {
    renderAt('/guarded');
    expect(screen.getByTestId('feature-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('guarded')).toBeNull();
    // The old behaviour redirected to `/`; the route now stays put and explains itself.
    expect(screen.queryByTestId('home')).toBeNull();
  });

  it('AC-PLN-008: resolved ON renders the page', () => {
    useOrgFeaturesState.value = { ...useOrgFeaturesState.value, data: { incidents: true } };
    renderAt('/guarded');
    expect(screen.getByTestId('guarded')).toBeInTheDocument();
    expect(screen.queryByTestId('feature-unavailable')).toBeNull();
  });

  it('AC-PLN-008: while the read is in flight the route HOLDS (no page, no denial)', () => {
    useOrgFeaturesState.value = { ...useOrgFeaturesState.value, isLoading: true, data: undefined };
    renderAt('/guarded');
    expect(screen.queryByTestId('guarded')).toBeNull();
    expect(screen.queryByTestId('feature-unavailable')).toBeNull();
    expect(screen.queryByTestId('feature-unavailable-error')).toBeNull();
  });

  it('AC-PLN-008: a failed read holds with a retry and never claims the plan is missing the module', () => {
    const refetch = vi.fn();
    useOrgFeaturesState.value = {
      isLoading: false,
      isError: true,
      data: undefined,
      refetch,
    };
    renderAt('/guarded');
    expect(screen.getByTestId('feature-unavailable-error')).toBeInTheDocument();
    expect(screen.queryByTestId('feature-unavailable')).toBeNull();
    expect(screen.queryByTestId('guarded')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('AC-PLN-008: core keys render immediately even while the read is loading', () => {
    useOrgFeaturesState.value = { ...useOrgFeaturesState.value, isLoading: true, data: undefined };
    renderAt('/guarded', 'projects');
    expect(screen.getByTestId('guarded-projects')).toBeInTheDocument();
  });
});
