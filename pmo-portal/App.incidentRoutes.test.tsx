/**
 * Incident route gating in the REAL app router (AppRoutes), not a mirror harness.
 *
 * Exercises the actual <Route path="/incidents"> / <Route path="/incidents/:id">
 * wiring through <FeatureRoute feature="incidents">:
 *  - flag OFF (default) → both routes redirect to "/" (Executive Dashboard), the
 *    hidden pages do NOT render.
 *  - flag ON → the Incidents list / detail pages render.
 *
 * This is the codebase's first test that mounts the real AppRoutes, so it also
 * covers App.tsx's route declarations (previously unit-untested wiring).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// Mock the lazy pages on the exercised paths so no real page/provider tree loads:
//  - "/" (redirect target) → ExecutiveDashboard
//  - "/incidents" (flag-on) → Incidents list
//  - "/incidents/:id" (flag-on) → IncidentDetail
vi.mock('./pages/ExecutiveDashboard', () => ({
  default: () => <div data-testid="exec-dashboard">Dashboard</div>,
}));
vi.mock('./pages/Incidents', () => ({
  default: () => <div data-testid="incidents-page">Incidents</div>,
}));
vi.mock('./pages/IncidentDetail', () => ({
  default: () => <div data-testid="incident-detail-page">Incident Detail</div>,
}));

import { AppRoutes } from './App';
import * as features from '@/src/lib/features';

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );

afterEach(() => vi.restoreAllMocks());

describe('AppRoutes — Incidents feature gate (real router)', () => {
  it('flag OFF: /incidents redirects to the dashboard, not the Incidents page', async () => {
    renderAt('/incidents');
    expect(await screen.findByTestId('exec-dashboard')).toBeInTheDocument();
    expect(screen.queryByTestId('incidents-page')).toBeNull();
  });

  it('flag OFF: /incidents/:id redirects to the dashboard, not the detail page', async () => {
    renderAt('/incidents/some-uuid');
    expect(await screen.findByTestId('exec-dashboard')).toBeInTheDocument();
    expect(screen.queryByTestId('incident-detail-page')).toBeNull();
  });

  it('flag ON: /incidents renders the Incidents page', async () => {
    vi.spyOn(features, 'isFeatureEnabled').mockReturnValue(true);
    renderAt('/incidents');
    expect(await screen.findByTestId('incidents-page')).toBeInTheDocument();
    expect(screen.queryByTestId('exec-dashboard')).toBeNull();
  });

  it('flag ON: /incidents/:id renders the Incident detail page', async () => {
    vi.spyOn(features, 'isFeatureEnabled').mockReturnValue(true);
    renderAt('/incidents/abc-123');
    expect(await screen.findByTestId('incident-detail-page')).toBeInTheDocument();
    expect(screen.queryByTestId('exec-dashboard')).toBeNull();
  });
});
