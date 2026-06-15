/**
 * Feature-flag route gate tests for /incidents and /incidents/:id.
 *
 * Tests that:
 *  - Flag off → navigating to /incidents redirects to / (home), not the Incidents page.
 *  - Flag off → navigating to /incidents/some-id also redirects to /.
 *  - Flag on  → the Incidents page IS rendered (gate is the hiding mechanism).
 *
 * Uses a minimal <Routes> harness (MemoryRouter) that mirrors the exact gating
 * logic wired into App.tsx, so the test proves the mechanism, not the whole app.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import React, { Suspense } from 'react';

// ── Mock the features module (start with real defaults: incidents=false) ──────
vi.mock('@/src/lib/features', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/lib/features')>();
  return { ...real };
});

import * as features from '@/src/lib/features';

// ── Minimal stub pages (avoid lazy-loading real pages in tests) ───────────────
const Home = () => <div data-testid="home-page">Home</div>;
const IncidentsList = () => <div data-testid="incidents-page">Incidents</div>;
const IncidentDetail = () => <div data-testid="incident-detail-page">Incident Detail</div>;

/**
 * Renders the gated route tree using the SAME conditional pattern applied in App.tsx.
 * Flag-off: both incident routes render <Navigate to="/" replace />.
 * Flag-on: the real pages are shown.
 */
const GatedRoutes = () => {
  const incidentsEnabled = features.isFeatureEnabled('incidents');
  return (
    <Suspense fallback={<div>Loading</div>}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route
          path="/incidents"
          element={incidentsEnabled ? <IncidentsList /> : <Navigate to="/" replace />}
        />
        <Route
          path="/incidents/:incidentId"
          element={incidentsEnabled ? <IncidentDetail /> : <Navigate to="/" replace />}
        />
      </Routes>
    </Suspense>
  );
};

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <GatedRoutes />
    </MemoryRouter>,
  );

describe('Incident routes — feature-flag gate', () => {
  let spy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    spy?.mockRestore();
  });

  // ── Flag OFF (current default) ─────────────────────────────────────────────

  it('flag-off: /incidents redirects to home, not the Incidents page', () => {
    renderAt('/incidents');
    expect(screen.getByTestId('home-page')).toBeInTheDocument();
    expect(screen.queryByTestId('incidents-page')).toBeNull();
  });

  it('flag-off: /incidents/:id redirects to home, not the Incident detail page', () => {
    renderAt('/incidents/some-uuid-here');
    expect(screen.getByTestId('home-page')).toBeInTheDocument();
    expect(screen.queryByTestId('incident-detail-page')).toBeNull();
  });

  // ── Flag ON (proves the gate is the redirect, not missing pages) ───────────

  it('flag-on: /incidents renders the Incidents page when feature is enabled', () => {
    spy = vi.spyOn(features, 'isFeatureEnabled').mockImplementation((key) =>
      key === 'incidents' ? true : features.FEATURES[key],
    );
    renderAt('/incidents');
    expect(screen.getByTestId('incidents-page')).toBeInTheDocument();
    expect(screen.queryByTestId('home-page')).toBeNull();
  });

  it('flag-on: /incidents/:id renders the Incident detail page when feature is enabled', () => {
    spy = vi.spyOn(features, 'isFeatureEnabled').mockImplementation((key) =>
      key === 'incidents' ? true : features.FEATURES[key],
    );
    renderAt('/incidents/abc-123');
    expect(screen.getByTestId('incident-detail-page')).toBeInTheDocument();
    expect(screen.queryByTestId('home-page')).toBeNull();
  });
});
