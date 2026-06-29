/**
 * Feature-flag gate tests for Rail.tsx (interim UI feature flags).
 *
 * Proves the gate is real (two-sided):
 *  - Flag off  → Incidents nav item absent (current hardcoded state).
 *  - Flag on   → Incidents nav item present (gate is the hiding mechanism, not deletion).
 * Other nav items must be unaffected in both states.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// ── Mock impersonation ────────────────────────────────────────────────────────
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({
    effectiveRole: 'Executive',
    realRole: 'Executive',
    canImpersonate: false,
    viewAs: vi.fn(),
  }),
}));

// ── Mock the features module (start with the real default: incidents=false) ──
// vi.mock replaces the entire module; individual tests spy on isFeatureEnabled
// to simulate the flag-on case without altering the source.
vi.mock('@/src/lib/features', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/lib/features')>();
  return { ...real };
});

// useUserViews calls useAuth internally; mock the whole hook so Rail tests
// that predate the My Views group don't need an AuthProvider.
vi.mock('@/src/hooks/useUserViews', () => ({
  useUserViews: () => ({ data: [], isPending: false, isError: false }),
}));

import { Rail } from '../Rail';
import * as features from '@/src/lib/features';

const renderRail = () =>
  render(
    <MemoryRouter>
      <Rail />
    </MemoryRouter>,
  );

describe('Rail — feature-flag gate for Incidents', () => {
  let spy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    spy?.mockRestore();
  });

  // ── Flag OFF (current default) ─────────────────────────────────────────────

  it('flag-off: Incidents nav item is NOT rendered', () => {
    // Default: isFeatureEnabled('incidents') === false (the actual flag value)
    renderRail();
    expect(screen.queryByRole('link', { name: /incidents/i })).toBeNull();
  });

  it('flag-off: other nav items (Dashboard, Projects, Companies) are still rendered', () => {
    renderRail();
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /projects/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /companies/i })).toBeInTheDocument();
  });

  it('flag-off: the Delivery group still renders (Procurement/Projects remain)', () => {
    renderRail();
    expect(screen.getByText('Delivery')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /procurement/i })).toBeInTheDocument();
  });

  // ── Flag ON (proves the gate is the hiding mechanism, not deletion) ────────

  it('flag-on: Incidents nav item IS rendered when isFeatureEnabled returns true', () => {
    spy = vi.spyOn(features, 'isFeatureEnabled').mockImplementation((key) =>
      key === 'incidents' ? true : features.FEATURES[key],
    );
    renderRail();
    expect(screen.getByRole('link', { name: /incidents/i })).toBeInTheDocument();
  });

  it('flag-on: other nav items are still rendered when Incidents is enabled', () => {
    spy = vi.spyOn(features, 'isFeatureEnabled').mockImplementation((key) =>
      key === 'incidents' ? true : features.FEATURES[key],
    );
    renderRail();
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /projects/i })).toBeInTheDocument();
  });
});
