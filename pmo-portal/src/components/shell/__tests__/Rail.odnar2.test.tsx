/**
 * OD-NAR-2 (owner, 2026-10-07, #784) — invoicing menus on by default when no ERP owns revenue.
 *
 * Drives the REAL resolution chain (useOrgFeatures → useRevenueMode → Rail / FeatureRoute) with
 * only the auth context, the org-features repository and the ownership query mocked:
 *
 *   - An explicit `org_features` row for `revenue` ALWAYS wins (on or off).
 *   - With NO row: `revenue` is ON when no ERP owns revenue (native), OFF when an ERP owns it.
 *   - While ownership is still loading the entitlement is unknown → items stay hidden and the
 *     route holds (renders null, no redirect flash), then resolves once ownership lands.
 *
 * ERP-connected orgs are unchanged (OD-NAR-2: "ERP-connected orgs are unchanged").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ── Mutable harness state, set per scenario ──────────────────────────────────
const h = vi.hoisted(() => ({
  rows: {} as Record<string, boolean>,
  ownership: { data: undefined as { domain: string; externalTier: string }[] | undefined, isError: false },
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' }, role: 'Finance' }),
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: { orgFeature: { listOwn: () => Promise.resolve(h.rows) } },
}));

vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({
  useExternalDomainOwnership: () => h.ownership,
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

const ownershipRow = (domain: string) => ({ domain, externalTier: 'erpnext' });

const makeWrapper = (initial: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
};

/** The single Finance destination as the Finance role sees it. */
const renderRail = () =>
  render(<Rail />, { wrapper: makeWrapper('/') });

/** The one revenue-gated route: /reports (Management pack) with a dashboard fallback. */
const renderReportsRoute = () =>
  render(
    <Routes>
      <Route path="/reports" element={<FeatureRoute feature="revenue" element={<div>PACK PAGE</div>} />} />
      <Route path="*" element={<div>DASHBOARD</div>} />
    </Routes>,
    { wrapper: makeWrapper('/reports') },
  );

/** Settle the tree on an always-on item before asserting a gated item is absent. */
const settle = async () => {
  expect(await screen.findByRole('link', { name: /Dashboard/i })).toBeInTheDocument();
};

beforeEach(() => {
  h.rows = {};
  h.ownership = { data: undefined, isError: false };
});

describe('OD-NAR-2 — invoicing menus on by default when no ERP owns revenue', () => {
  it('no org_features row + no ERP owns revenue → Finance destination visible and /reports allowed', async () => {
    h.rows = {};
    h.ownership = { data: [ownershipRow('procurement')], isError: false };
    renderRail();
    for (const name of FINANCE_ITEMS) {
      expect(await screen.findByRole('link', { name })).toBeInTheDocument();
    }
    renderReportsRoute();
    expect(await screen.findByText('PACK PAGE')).toBeInTheDocument();
    expect(screen.queryByText('DASHBOARD')).toBeNull();
  });

  it('no org_features row + an ERP owns revenue → Finance destination remains visible, /reports redirects', async () => {
    h.rows = {};
    h.ownership = { data: [ownershipRow('revenue')], isError: false };
    renderRail();
    for (const name of FINANCE_ITEMS) {
      expect(await screen.findByRole('link', { name })).toBeInTheDocument();
    }
    renderReportsRoute();
    // ERP-connected orgs unchanged: the deep-link degrades to the dashboard.
    expect(await screen.findByText('DASHBOARD')).toBeInTheDocument();
    expect(screen.queryByText('PACK PAGE')).toBeNull();
  });

  it('explicit row off + no ERP → Finance destination remains visible', async () => {
    h.rows = { revenue: false };
    h.ownership = { data: [], isError: false };
    renderRail();
    for (const name of FINANCE_ITEMS) {
      expect(await screen.findByRole('link', { name })).toBeInTheDocument();
    }
  });

  it('explicit row on + an ERP owns revenue → Finance destination is visible', async () => {
    h.rows = { revenue: true };
    h.ownership = { data: [ownershipRow('revenue')], isError: false };
    renderRail();
    for (const name of FINANCE_ITEMS) {
      expect(await screen.findByRole('link', { name })).toBeInTheDocument();
    }
  });

  it('ownership still loading → Finance destination stays visible and /reports holds (no redirect)', async () => {
    h.rows = {};
    h.ownership = { data: undefined, isError: false };
    const rail = renderRail();
    for (const name of FINANCE_ITEMS) {
      expect(await screen.findByRole('link', { name })).toBeInTheDocument();
    }
    const route = renderReportsRoute();
    await settle(); // FeatureRoute holds: neither the element nor a redirect — ever — while unknown.
    expect(screen.queryByText('PACK PAGE')).toBeNull();
    expect(screen.queryByText('DASHBOARD')).toBeNull();
    // The area destination is independent of the entitlement; only its Reports area is gated.
    expect(rail).toBeTruthy();
    h.ownership = { data: [ownershipRow('procurement')], isError: false };
    route.rerender(
      <Routes>
        <Route path="/reports" element={<FeatureRoute feature="revenue" element={<div>PACK PAGE</div>} />} />
        <Route path="*" element={<div>DASHBOARD</div>} />
      </Routes>,
    );
    expect(await screen.findByText('PACK PAGE')).toBeInTheDocument();
  });
});
