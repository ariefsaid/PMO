/**
 * AC-ENT-004 — the org-Admin read-only Features list, and the Operator's refusal path
 * (ops-admin-surface S6; the S3 console keeps both behaviours).
 *
 *   - A non-Operator (org Admin) sees the feature list as a read-only set of pills: NO
 *     `role="switch"` control anywhere.
 *   - The Operator gets real switches (the console), and a `core_not_gated` rejection
 *     (errcode `P0001`) surfaces a toast instead of failing silently.
 *   - Core modules render always-on and are not switchable by anyone.
 *
 * The console's own controls (plan picker, all-orgs column, plan defaults, limits) are proven in
 * `pages/AdministrationFeatures.test.tsx` (AC-PLN-012); this suite keeps the original entitlement
 * contract — that the read-only path stays read-only and the refusal is visible.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const { orgFeaturesState, api, toastSpy } = vi.hoisted(() => ({
  orgFeaturesState: {
    value: {
      display: { incidents: false, crm: true } as Record<string, boolean>,
      states: {
        incidents: { enabled: false, displayEnabled: false, source: 'override' },
        crm: { enabled: true, displayEnabled: true, source: 'plan' },
      },
    },
  },
  api: {
    listOwn: vi.fn(),
    listForOrg: vi.fn(),
    getPlanCatalogue: vi.fn(),
    getOrgPlan: vi.fn(),
    listOperatorOrgs: vi.fn(),
    toggle: vi.fn(),
    clearOverride: vi.fn(),
    setOrgPlan: vi.fn(),
    setGlobal: vi.fn(),
    setPlanFeature: vi.fn(),
    setPlanLimits: vi.fn(),
  },
  toastSpy: { fn: vi.fn() },
}));

// Spread the real module: `usePlans` reads the exported query keys from here, and replacing the
// module wholesale would hide them from the console's reads.
vi.mock('@/src/hooks/useOrgFeatures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/hooks/useOrgFeatures')>()),
  useOrgFeatures: () => orgFeaturesState.value,
}));
vi.mock('@/src/auth/useIsOperator', () => ({
  useIsOperator: () => false,
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Admin' }),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    orgFeature: {
      listOwn: () => api.listOwn(),
      listForOrg: (...a: unknown[]) => api.listForOrg(...a),
      getPlanCatalogue: () => api.getPlanCatalogue(),
      getOrgPlan: (...a: unknown[]) => api.getOrgPlan(...a),
      toggle: (...a: unknown[]) => api.toggle(...a),
      clearOverride: (...a: unknown[]) => api.clearOverride(...a),
      setOrgPlan: (...a: unknown[]) => api.setOrgPlan(...a),
      setGlobal: (...a: unknown[]) => api.setGlobal(...a),
      setPlanFeature: (...a: unknown[]) => api.setPlanFeature(...a),
      setPlanLimits: (...a: unknown[]) => api.setPlanLimits(...a),
    },
    usage: { listOperatorOrgs: () => api.listOperatorOrgs() },
  },
}));
vi.mock('@/src/components/ui', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/components/ui')>();
  return {
    ...real,
    // Spy the toast so the P0001 case can assert a toast fired.
    useToast: () => ({ toast: toastSpy.fn }),
  };
});

import AdministrationFeatures from '../AdministrationFeatures';

const makeQc = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

const renderSection = (isOperator: boolean) =>
  render(
    <QueryClientProvider client={makeQc()}>
      <ToastProvider>
        <AdministrationFeatures isOperator={isOperator} orgId="org-1" />
      </ToastProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  orgFeaturesState.value = {
    display: { incidents: false, crm: true },
    states: {
      incidents: { enabled: false, displayEnabled: false, source: 'override' },
      crm: { enabled: true, displayEnabled: true, source: 'plan' },
    },
  };
  api.listOwn.mockResolvedValue(orgFeaturesState.value);
  api.listForOrg.mockResolvedValue(orgFeaturesState.value);
  api.listOperatorOrgs.mockResolvedValue([{ id: 'org-1', name: 'Acme' }]);
  api.getOrgPlan.mockResolvedValue('starter');
  api.getPlanCatalogue.mockResolvedValue({
    plans: [{ planId: 'starter', name: 'Starter', seatLimit: 10, projectLimit: 25, aiMonthlyMessages: 300 }],
    defaults: { starter: { incidents: false, crm: true } },
    global: { incidents: true, crm: true },
  });
  api.toggle.mockResolvedValue(undefined);
  toastSpy.fn = vi.fn();
});

describe('AC-ENT-004 — Features: org-Admin read-only, Operator controls', () => {
  it('AC-ENT-004: a non-Operator org-Admin sees a read-only list with NO toggle controls', () => {
    renderSection(false);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getAllByText(/incidents/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/crm/i).length).toBeGreaterThan(0);
  });

  it('AC-ENT-004: a core_not_gated (P0001) rejection surfaces a toast', async () => {
    api.toggle.mockRejectedValue(Object.assign(new Error('core_not_gated'), { code: 'P0001' }));
    renderSection(true);
    const incidentsRow = await screen.findByTestId('feature-row-incidents');
    fireEvent.click(within(incidentsRow).getByRole('switch', { name: /override for this organisation/i }));
    await waitFor(() => expect(toastSpy.fn).toHaveBeenCalled());
    const [headline] = toastSpy.fn.mock.calls[0];
    expect(String(headline).toLowerCase()).toMatch(/core/);
  });

  it('AC-ENT-004: core modules render always-on and are NOT toggleable', async () => {
    renderSection(true);
    await screen.findByTestId('feature-row-crm');
    // The core line lists the modules and offers no control of its own.
    expect(screen.getByText(/core modules \(never switchable\)/i)).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /projects/i })).toBeNull();
  });
});
