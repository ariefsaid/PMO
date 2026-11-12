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
import { MemoryRouter } from 'react-router';
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

// useIsOperator is queried by Rail's real-Operator Administration footer; default to false
// (plain role) unless a specific test overrides it. Avoids a QueryClient in the harness.
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));
import { Rail } from '../Rail';
import { FEATURE_ENV_DEFAULT } from '@/src/lib/features';
import { RailDrawerContext } from '../railDrawerContext';

const renderRail = () =>
  render(
    <MemoryRouter>
      <RailDrawerContext.Provider value><Rail /></RailDrawerContext.Provider>
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

/**
 * AC-PLN-008 — the S3 nav matrix: every rail item that carries a switch key follows the resolved
 * set, two-sided (off → absent, on → present), and the CRM-less Suppliers doorway still appears
 * exactly when CRM is off. The rail reads the resolved display map only; nothing here re-derives
 * the order (that is the DB projection's job, proven in the useFeature suite).
 */
describe('AC-PLN-008 — rail gate matrix follows the resolved switches', () => {
  /** A resolved map with everything on, then the per-test override applied. */
  const resolvedWith = (overrides: Record<string, boolean>) => ({
    incidents: true,
    crm: true,
    procurement: true,
    procurement_full: true,
    timesheets: true,
    import_export: true,
    agent_assistant: true,
    user_views: true,
    revenue: true,
    m365_integration: true,
    sales_pipeline: true,
    sales_invoices: true,
    budget_projection: true,
    imprest: true,
    clickup_sync: true,
    erp_sync: true,
    erp_purchases: true,
    financial_statements: true,
    management_pack: true,
    budget_phasing: true,
    multi_currency: true,
    stock: true,
    api_access: true,
    sso: true,
    feedback_surveys: true,
    ...overrides,
  });

  it('sales_pipeline: absent when off, present when on', () => {
    orgFeaturesState.value = resolvedWith({ sales_pipeline: false });
    const { unmount } = renderRail();
    expect(screen.queryByRole('link', { name: /sales pipeline/i })).toBeNull();
    unmount();
    orgFeaturesState.value = resolvedWith({});
    renderRail();
    expect(screen.getByRole('link', { name: /sales pipeline/i })).toBeInTheDocument();
  });

  it('stock: absent when off, present when on', () => {
    orgFeaturesState.value = resolvedWith({ stock: false });
    const { unmount } = renderRail();
    expect(screen.queryByRole('link', { name: /^stock$/i })).toBeNull();
    unmount();
    orgFeaturesState.value = resolvedWith({});
    renderRail();
    expect(screen.getByRole('link', { name: /^stock$/i })).toBeInTheDocument();
  });

  it('imprest: absent when off, present when on (Site cash)', () => {
    orgFeaturesState.value = resolvedWith({ imprest: false });
    const { unmount } = renderRail();
    expect(screen.queryByRole('link', { name: /site cash/i })).toBeNull();
    unmount();
    orgFeaturesState.value = resolvedWith({});
    renderRail();
    expect(screen.getByRole('link', { name: /site cash/i })).toBeInTheDocument();
  });

  it('management_pack and financial_statements gate their own Finance items', () => {
    orgFeaturesState.value = resolvedWith({ management_pack: false, financial_statements: false });
    const { unmount } = renderRail();
    expect(screen.queryByRole('link', { name: /^reports$/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /^statements$/i })).toBeNull();
    unmount();
    orgFeaturesState.value = resolvedWith({});
    renderRail();
    expect(screen.getByRole('link', { name: /^reports$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^statements$/i })).toBeInTheDocument();
  });

  it('revenue gates Receivables', () => {
    orgFeaturesState.value = resolvedWith({ revenue: false });
    const { unmount } = renderRail();
    expect(screen.queryByRole('link', { name: /receivables/i })).toBeNull();
    unmount();
    orgFeaturesState.value = resolvedWith({});
    renderRail();
    expect(screen.getByRole('link', { name: /receivables/i })).toBeInTheDocument();
  });

  it('crm gates Companies and Contacts', () => {
    orgFeaturesState.value = resolvedWith({ crm: false });
    const { unmount } = renderRail();
    expect(screen.queryByRole('link', { name: /companies/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /contacts/i })).toBeNull();
    unmount();
    orgFeaturesState.value = resolvedWith({ crm: true });
    renderRail();
    expect(screen.getByRole('link', { name: /companies/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /contacts/i })).toBeInTheDocument();
    // The CRM-less Suppliers doorway is role-scoped (Project Manager / Finance / Admin); this
    // harness renders an Executive, so it is correctly absent in both states.
    expect(screen.queryByRole('link', { name: /suppliers/i })).toBeNull();
  });
});
