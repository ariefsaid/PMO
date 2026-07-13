/**
 * AC-ENT-005 — FeatureRoute must NOT redirect while the org-features query is LOADING.
 *
 * Bug: FeatureRoute called useFeature(feature) which, while useOrgFeatures() is loading
 * (data === undefined), returns FEATURE_ENV_DEFAULT[key] (for 'incidents' that is false).
 * This caused an entitled user to be redirected to '/' on fresh login + navigation
 * before the org_features query resolved — a flash redirect race.
 *
 * Fix: FeatureRoute must call useOrgFeatures() directly to observe isLoading, and
 * render null (stay put, no redirect, no element) while loading for non-core features.
 * Core features (projects/dashboard/approvals/administration) always render immediately.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';

// Mutable state the mocked useOrgFeatures returns; each test sets its scenario.
const { useOrgFeaturesState } = vi.hoisted(() => ({
  useOrgFeaturesState: {
    value: { isLoading: false, data: { incidents: false } as Record<string, boolean> | undefined },
  },
}));

vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => useOrgFeaturesState.value,
}));

import { FeatureRoute } from '../FeatureRoute';

const Home = () => <div data-testid="home">Home</div>;
const Guarded = () => <div data-testid="guarded">INCIDENTS</div>;

const renderAt = (path: string, redirectTo?: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route
          path="/guarded"
          element={<FeatureRoute feature="incidents" element={<Guarded />} redirectTo={redirectTo} />}
        />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  useOrgFeaturesState.value = { isLoading: false, data: { incidents: false } };
});

describe('AC-ENT-005 — FeatureRoute does not redirect while org-features query loads', () => {
  it('case (a): query LOADING (isLoading:true, data:undefined) -> renders null (no element, no redirect)', () => {
    useOrgFeaturesState.value = { isLoading: true, data: undefined };
    renderAt('/guarded');
    // Should render NOTHING (null) — neither the guarded element NOR the home redirect target
    expect(screen.queryByTestId('guarded')).toBeNull();
    expect(screen.queryByTestId('home')).toBeNull();
  });

  it('case (b): resolved ENABLED (isLoading:false, data:{incidents:true}) -> element visible', () => {
    useOrgFeaturesState.value = { isLoading: false, data: { incidents: true } };
    renderAt('/guarded');
    expect(screen.getByTestId('guarded')).toBeInTheDocument();
    expect(screen.queryByTestId('home')).toBeNull();
  });

  it('case (c): resolved DISABLED (isLoading:false, data:{incidents:false}) -> redirected to "/"', () => {
    useOrgFeaturesState.value = { isLoading: false, data: { incidents: false } };
    renderAt('/guarded');
    expect(screen.getByTestId('home')).toBeInTheDocument();
    expect(screen.queryByTestId('guarded')).toBeNull();
  });

  it('case (c2): resolved DISABLED honours a custom redirectTo (preserved coverage)', () => {
    useOrgFeaturesState.value = { isLoading: false, data: { incidents: false } };
    render(
      <MemoryRouter initialEntries={['/guarded']}>
        <Routes>
          <Route path="/custom" element={<div data-testid="custom">CUSTOM</div>} />
          <Route
            path="/guarded"
            element={<FeatureRoute feature="incidents" element={<Guarded />} redirectTo="/custom" />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('custom')).toBeInTheDocument();
    expect(screen.queryByTestId('guarded')).toBeNull();
  });

  it('core features (e.g., projects) render immediately even while loading', () => {
    // Core features should render immediately (isCoreFeature returns true)
    useOrgFeaturesState.value = { isLoading: true, data: undefined };
    const GuardedProjects = () => <div data-testid="guarded-projects">PROJECTS</div>;
    render(
      <MemoryRouter initialEntries={['/guarded-projects']}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route
            path="/guarded-projects"
            element={<FeatureRoute feature="projects" element={<GuardedProjects />} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('guarded-projects')).toBeInTheDocument();
  });
});