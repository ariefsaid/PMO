/**
 * AC-ENT-003 — <FeatureGate> + <FeatureRoute> hide CRM affordances (ops-admin-surface S6).
 *
 *   - <FeatureGate feature="crm"> renders children when useFeature('crm') is true and omits
 *     them when false.
 *   - <FeatureRoute feature="crm"> renders the element when enabled and the not-available state
 *     when disabled — a deep-link degrades gracefully, never a 404. (S3/AC-PLN-008 replaced the
 *     old redirect to `/` with that state: the route now says why, and data is kept either way.
 *     The goal oracle is unchanged — the disabled page is never rendered.)
 *   - Rail integration: with crm (and sales_pipeline, its own key since S3) disabled, the CRM rail
 *     items (Sales Pipeline / Companies / Contacts) are absent.
 *
 * The RPC seam is mocked at `useOrgFeatures`, the same projection every consumer reads (FR-PLN-005).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mutable feature map so each test can flip crm without re-mocking the module.
const { featuresState } = vi.hoisted(() => ({
  featuresState: { value: { crm: false } as Record<string, boolean | undefined> },
}));

vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({ data: featuresState.value }),
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Executive', realRole: 'Executive' }),
}));

vi.mock('@/src/hooks/useUserViews', () => ({
  useUserViews: () => ({ data: [], isPending: false, isError: false }),
}));

import { FeatureRoute } from '@/src/components/FeatureRoute';
import { FeatureGate } from '@/src/auth/useFeature';
import { Rail } from '@/src/components/shell/Rail';
import { RailDrawerContext } from '../railDrawerContext';

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const wrap = (ui: React.ReactNode, initial = '/crm') =>
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('AC-ENT-003 — FeatureRoute hides CRM affordances', () => {

  it('AC-ENT-003 FeatureGate hides an in-page affordance when crm is disabled', () => {
    featuresState.value = { crm: false };
    wrap(
      <FeatureGate feature="crm">
        <button type="button">Create company</button>
      </FeatureGate>,
      '/',
    );
    expect(screen.queryByRole('button', { name: 'Create company' })).toBeNull();
  });

  it('AC-ENT-003 FeatureGate renders an in-page affordance when crm is enabled', () => {
    featuresState.value = { crm: true };
    wrap(
      <FeatureGate feature="crm">
        <button type="button">Create company</button>
      </FeatureGate>,
      '/',
    );
    expect(screen.getByRole('button', { name: 'Create company' })).toBeInTheDocument();
  });

  it('AC-PLN-008 <FeatureRoute> renders the not-available state for a /crm deep-link when crm is disabled', () => {
    featuresState.value = { crm: false };
    wrap(
      <Routes>
        <Route path="/crm" element={<FeatureRoute feature="crm" element={<div>CRM page</div>} />} />
        <Route path="/" element={<div>Dashboard</div>} />
      </Routes>,
    );
    // The page is never rendered (the goal oracle), and the route explains itself in place
    // instead of bouncing to the dashboard.
    expect(screen.queryByText('CRM page')).toBeNull();
    expect(screen.getByTestId('feature-unavailable')).toBeInTheDocument();
  });

  it('<FeatureRoute> renders the element when crm is enabled', () => {
    featuresState.value = { crm: true };
    wrap(
      <Routes>
        <Route path="/crm" element={<FeatureRoute feature="crm" element={<div>CRM page</div>} />} />
        <Route path="/" element={<div>Dashboard</div>} />
      </Routes>,
    );
    expect(screen.getByText('CRM page')).toBeInTheDocument();
  });

  it('Rail integration: with crm disabled, the CRM rail items are absent', () => {
    // `sales_pipeline` became its own switch in S3 (it is a Growth+ feature); a CRM-less org
    // without the pipeline therefore shows neither.
    featuresState.value = { crm: false, sales_pipeline: false };
    // Other gated features off too so only the always-on items show.
    wrap(<RailDrawerContext.Provider value><Rail /></RailDrawerContext.Provider>, '/');
    expect(screen.queryByRole('link', { name: /sales pipeline/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /companies/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /contacts/i })).toBeNull();
    // Always-on items remain.
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /projects/i })).toBeInTheDocument();
  });

  it('Rail integration: with crm enabled, the CRM rail items reappear', () => {
    featuresState.value = { crm: true, sales_pipeline: true };
    wrap(<RailDrawerContext.Provider value><Rail /></RailDrawerContext.Provider>, '/');
    expect(screen.getByRole('link', { name: /sales pipeline/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /companies/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /contacts/i })).toBeInTheDocument();
  });
});
