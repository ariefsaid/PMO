/**
 * <FeatureRoute> — the per-org entitlement route gate (ops-admin-surface S6, FR-ENT-005/006,
 * AC-ENT-003).
 *
 * Proves the gate both ways (so it's a hiding mechanism, not a deletion):
 *  - entitlement OFF → renders <Navigate> (redirect), NOT the element
 *  - entitlement ON  → renders the element
 *  - honours a custom redirectTo
 *  - consults the named feature key
 *
 * The gate resolves via `useFeature()` → `useOrgFeatures()`; we mock `useOrgFeatures` so the
 * test controls the resolved entitlement without an AuthProvider/QueryClient.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';

// Mutable entitlement map the mocked useOrgFeatures returns; each test sets incidents.
const { featuresState } = vi.hoisted(() => ({
  featuresState: { value: { incidents: false } as Record<string, boolean | undefined> },
}));

vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({ data: featuresState.value }),
}));

import { FeatureRoute } from '../FeatureRoute';

const Home = () => <div data-testid="home">Home</div>;
const Other = () => <div data-testid="other">Other</div>;
const Guarded = () => <div data-testid="guarded">Guarded</div>;

const renderAt = (path: string, redirectTo?: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/other" element={<Other />} />
        <Route
          path="/guarded"
          element={<FeatureRoute feature="incidents" element={<Guarded />} redirectTo={redirectTo} />}
        />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  featuresState.value = { incidents: false };
});

describe('FeatureRoute', () => {
  it('entitlement OFF: redirects to "/" and does NOT render the element', () => {
    featuresState.value = { incidents: false };
    renderAt('/guarded');
    expect(screen.getByTestId('home')).toBeInTheDocument();
    expect(screen.queryByTestId('guarded')).toBeNull();
  });

  it('entitlement ON: renders the element', () => {
    featuresState.value = { incidents: true };
    renderAt('/guarded');
    expect(screen.getByTestId('guarded')).toBeInTheDocument();
    expect(screen.queryByTestId('home')).toBeNull();
  });

  it('entitlement OFF: honours a custom redirectTo', () => {
    featuresState.value = { incidents: false };
    renderAt('/guarded', '/other');
    expect(screen.getByTestId('other')).toBeInTheDocument();
    expect(screen.queryByTestId('guarded')).toBeNull();
  });

  it('consults the named feature key — flipping incidents toggles the gate', () => {
    // OFF: the guarded element is hidden.
    featuresState.value = { incidents: false };
    const { unmount } = renderAt('/guarded');
    expect(screen.queryByTestId('guarded')).toBeNull();
    unmount();
    // ON: the same route now renders the guarded element. Proves the gate reads the
    // `incidents` entitlement rather than unconditionally hiding/showing.
    featuresState.value = { incidents: true };
    renderAt('/guarded');
    expect(screen.getByTestId('guarded')).toBeInTheDocument();
  });
});
