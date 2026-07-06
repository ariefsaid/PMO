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
// vi.mock replaces the entire module; individual tests spy on FEATURE_ENV_DEFAULT
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

// ops-admin-surface S6 rewire: the Incidents gate now flows through useOrgFeatures
// (which calls useAuth → react-query). Mock the hook so Rail renders without an
// AuthProvider; each test sets the feature map via the hoisted state. Returning
// `data: undefined` makes Rail fall back to FEATURE_ENV_DEFAULT (the interim path).
const { orgFeaturesState } = vi.hoisted(() => ({
  orgFeaturesState: { value: undefined as Record<string, boolean | undefined> | undefined },
}));
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({ data: orgFeaturesState.value }),
}));

import { Rail } from '../Rail';
import { FEATURE_ENV_DEFAULT } from '@/src/lib/features';

const renderRail = () =>
  render(
    <MemoryRouter>
      <Rail />
    </MemoryRouter>,
  );

describe('Rail — feature-flag gate for Incidents', () => {
  let originalIncidentsDefault: boolean;

  afterEach(() => {
    // Restore the env default + clear any per-test org-feature override.
    (FEATURE_ENV_DEFAULT as Record<string, boolean>).incidents = originalIncidentsDefault;
    orgFeaturesState.value = undefined;
  });

  // ── Flag OFF (current default) ─────────────────────────────────────────────

  it('flag-off: Incidents nav item is NOT rendered', () => {
    // Default: FEATURE_ENV_DEFAULT.incidents === false; no org row → falls back to it.
    originalIncidentsDefault = FEATURE_ENV_DEFAULT.incidents;
    (FEATURE_ENV_DEFAULT as Record<string, boolean>).incidents = false;
    orgFeaturesState.value = undefined;
    renderRail();
    expect(screen.queryByRole('link', { name: /incidents/i })).toBeNull();
  });

  it('flag-off: other nav items (Dashboard, Projects, Companies) are still rendered', () => {
    originalIncidentsDefault = FEATURE_ENV_DEFAULT.incidents;
    (FEATURE_ENV_DEFAULT as Record<string, boolean>).incidents = false;
    // CRM is a separate gated key — enable it so the Companies assertion holds.
    orgFeaturesState.value = { crm: true };
    renderRail();
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /projects/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /companies/i })).toBeInTheDocument();
  });

  it('flag-off: the Delivery group still renders (Procurement/Projects remain)', () => {
    originalIncidentsDefault = FEATURE_ENV_DEFAULT.incidents;
    (FEATURE_ENV_DEFAULT as Record<string, boolean>).incidents = false;
    orgFeaturesState.value = undefined;
    renderRail();
    expect(screen.getByText('Delivery')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /procurement/i })).toBeInTheDocument();
  });

  // ── Flag ON (proves the gate is the hiding mechanism, not deletion) ────────

  it('flag-on: Incidents nav item IS rendered when an org_features row enables it', () => {
    originalIncidentsDefault = FEATURE_ENV_DEFAULT.incidents;
    (FEATURE_ENV_DEFAULT as Record<string, boolean>).incidents = false;
    // A stored row overrides the env default (FR-ENT-004).
    orgFeaturesState.value = { incidents: true };
    renderRail();
    expect(screen.getByRole('link', { name: /incidents/i })).toBeInTheDocument();
  });

  it('flag-on: other nav items are still rendered when Incidents is enabled', () => {
    originalIncidentsDefault = FEATURE_ENV_DEFAULT.incidents;
    (FEATURE_ENV_DEFAULT as Record<string, boolean>).incidents = false;
    orgFeaturesState.value = { incidents: true };
    renderRail();
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /projects/i })).toBeInTheDocument();
  });
});
