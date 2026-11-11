/**
 * OD-NAR-2 (owner 2026-10-07, #784) — invoicing surfaces follow the RESOLVED revenue display value.
 *
 * ⚑ Moved layer by S3 (FR-PLN-005a). This suite used to drive the old FE rule
 * (`useOrgFeatures → useRevenueMode`, "native unless an ERP owns revenue"). That rule now lives in
 * the database resolver (`display_enabled`, migration 0532/0533) and is proven there by
 * `supabase/tests/plans_resolution.test.sql` and `plans_compatibility.test.sql` (ERP-owned with no
 * override → display false, entitlement true; explicit override → display true; global off → hidden).
 *
 * What the FE still owes is exactly one thing: render `display_enabled` and stop re-deriving. This
 * suite proves that — a resolved false hides the Finance children (rail + route), a resolved true
 * shows them, and an unresolved read holds rather than guess.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ── Mutable harness state, set per scenario ──────────────────────────────────
const h = vi.hoisted(() => ({
  /** What the DB projection returns: display map + per-key detail. */
  resolved: { display: {}, states: {} } as {
    display: Record<string, boolean>;
    states: Record<string, { enabled: boolean; displayEnabled: boolean; source: string }>;
  },
  pending: false,
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' }, role: 'Finance' }),
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    orgFeature: {
      listOwn: () => (h.pending ? new Promise(() => {}) : Promise.resolve(h.resolved)),
    },
  },
}));

vi.mock('@/src/hooks/useUserViews', () => ({
  useUserViews: () => ({ data: [], isPending: false, isError: false }),
}));

vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Finance', realRole: 'Finance', canImpersonate: false, viewAs: vi.fn() }),
}));

import { Rail } from '../Rail';
import { FeatureRoute } from '@/src/components/FeatureRoute';

const FINANCE_ITEMS = [/^Finance$/i];
/** The revenue-gated Finance children: invoicing (Receivables) and the revenue report (Reports). */
// `Reports` is gated by `management_pack` (not revenue) since S3; Receivables is the revenue child.
const REVENUE_ITEMS = [/^Receivables$/i];

const makeWrapper = (initial: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
};

/** The single Finance destination as the Finance role sees it. */
const renderRail = () => render(<Rail />, { wrapper: makeWrapper('/') });

/** The revenue-gated Reports area with a dashboard fallback. */
const renderReportsRoute = () =>
  render(
    <Routes>
      <Route path="/finance/reports" element={<FeatureRoute feature="revenue" element={<div>PACK PAGE</div>} />} />
      <Route path="*" element={<div>DASHBOARD</div>} />
    </Routes>,
    { wrapper: makeWrapper('/finance/reports') },
  );

/** Let the resolved-set query settle before asserting a gated item is ABSENT. */
const resolveFeatures = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

beforeEach(() => {
  h.pending = false;
  h.resolved = {
    display: { revenue: false },
    states: { revenue: { enabled: true, displayEnabled: false, source: 'plan' } },
  };
});

describe('OD-NAR-2 / FR-PLN-005a — the FE renders display_enabled, it does not re-derive ownership', () => {
  it('display true (no ERP owns revenue, or an explicit override) → Finance children visible and the route renders', async () => {
    h.resolved = {
      display: { revenue: true },
      states: { revenue: { enabled: true, displayEnabled: true, source: 'plan' } },
    };
    renderRail();
    for (const name of FINANCE_ITEMS) {
      expect(await screen.findByRole('link', { name })).toBeInTheDocument();
    }
    for (const name of REVENUE_ITEMS) {
      expect(await screen.findByRole('link', { name })).toBeInTheDocument();
    }
    renderReportsRoute();
    expect(await screen.findByText('PACK PAGE')).toBeInTheDocument();
    expect(screen.queryByText('DASHBOARD')).toBeNull();
  });

  it('display false (an ERP owns revenue with no override) → Finance destination stays, revenue items hidden, route explains itself', async () => {
    h.resolved = {
      display: { revenue: false },
      // Entitlement is ON and the policy layer would allow the write; only the DISPLAY is false.
      states: { revenue: { enabled: true, displayEnabled: false, source: 'plan' } },
    };
    renderRail();
    for (const name of FINANCE_ITEMS) {
      expect(await screen.findByRole('link', { name })).toBeInTheDocument();
    }
    await resolveFeatures();
    for (const name of REVENUE_ITEMS) {
      expect(screen.queryByRole('link', { name })).toBeNull();
    }
    renderReportsRoute();
    expect(await screen.findByTestId('feature-unavailable')).toBeInTheDocument();
    expect(screen.queryByText('PACK PAGE')).toBeNull();
  });

  it('an explicit override shows even where the plan would hide (display true, source override)', async () => {
    h.resolved = {
      display: { revenue: true },
      states: { revenue: { enabled: true, displayEnabled: true, source: 'override' } },
    };
    renderRail();
    expect(await screen.findByRole('link', { name: /^Receivables$/i })).toBeInTheDocument();
  });

  it('an in-flight read → revenue items hidden and the route HOLDS (no page, no denial)', async () => {
    h.pending = true;
    renderRail();
    for (const name of FINANCE_ITEMS) {
      expect(await screen.findByRole('link', { name })).toBeInTheDocument();
    }
    renderReportsRoute();
    expect(screen.queryByText('PACK PAGE')).toBeNull();
    expect(screen.queryByTestId('feature-unavailable')).toBeNull();
    expect(screen.queryByTestId('feature-unavailable-error')).toBeNull();
  });
});
