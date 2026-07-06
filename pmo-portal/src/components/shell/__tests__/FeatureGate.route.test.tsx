/**
 * AC-ENT-003 — <FeatureGate> + <FeatureRoute> hide CRM affordances (ops-admin-surface S6).
 *
 *   - <FeatureGate feature="crm"> renders children when useFeature('crm') is true and omits
 *     them when false.
 *   - <FeatureRoute feature="crm"> renders the element when enabled and <Navigate>s to `/`
 *     (dashboard) when disabled — a deep-link degrades gracefully, never a 404.
 *   - Rail integration: with crm disabled, the CRM rail items (Sales Pipeline / Companies /
 *     Contacts) are absent; a deep-link to /crm redirects to `/`.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
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

import { FeatureGate } from '@/src/auth/useFeature';
import { FeatureRoute } from '@/src/components/FeatureRoute';
import { Rail } from '@/src/components/shell/Rail';

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const wrap = (ui: React.ReactNode, initial = '/crm') =>
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('AC-ENT-003 — FeatureGate + FeatureRoute hide CRM affordances', () => {
  it('<FeatureGate> renders children when the feature is enabled', () => {
    featuresState.value = { crm: true };
    wrap(
      <FeatureGate feature="crm"><div>CRM content</div></FeatureGate>,
    );
    expect(screen.getByText('CRM content')).toBeInTheDocument();
  });

  it('<FeatureGate> omits children when the feature is disabled', () => {
    featuresState.value = { crm: false };
    wrap(
      <FeatureGate feature="crm"><div>CRM content</div></FeatureGate>,
    );
    expect(screen.queryByText('CRM content')).toBeNull();
  });

  it('<FeatureRoute> redirects a /crm deep-link to / when crm is disabled', () => {
    featuresState.value = { crm: false };
    wrap(
      <Routes>
        <Route path="/crm" element={<FeatureRoute feature="crm" element={<div>CRM page</div>} />} />
        <Route path="/" element={<div>Dashboard</div>} />
      </Routes>,
    );
    expect(screen.queryByText('CRM page')).toBeNull();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
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
    featuresState.value = { crm: false };
    // Other gated features off too so only the always-on items show.
    wrap(<Rail />, '/');
    expect(screen.queryByRole('link', { name: /sales pipeline/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /companies/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /contacts/i })).toBeNull();
    // Always-on items remain.
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /projects/i })).toBeInTheDocument();
  });

  it('Rail integration: with crm enabled, the CRM rail items reappear', () => {
    featuresState.value = { crm: true };
    wrap(<Rail />, '/');
    expect(screen.getByRole('link', { name: /sales pipeline/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /companies/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /contacts/i })).toBeInTheDocument();
  });
});
