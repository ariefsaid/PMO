/**
 * AC-AXP-015 — CompanyDetail publishes its loaded record to the live agent
 * context (FR-AXP-021, Track C of docs/plans/2026-07-05-agent-experience-layer.md).
 *
 * Context is GROUNDING ONLY (NFR-AXP-SEC-003): setEntity publishes {type,id,label};
 * nothing here selects a client, skips can(), or bypasses dispatchAction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { AgentContextProvider } from '@/src/lib/agent/context/AgentContextProvider';
import { useAgentContext } from '@/src/lib/agent/context/useAgentContext';

const { detailState, mutations, contactsState } = vi.hoisted(() => ({
  detailState: {
    data: undefined as Record<string, unknown> | null | undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    archive: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    remove: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
  },
  contactsState: {
    data: [] as Record<string, unknown>[],
    isPending: false,
  },
}));

vi.mock('@/src/hooks/useCompanies', () => ({
  useCompany: () => detailState,
  useCompanyMutations: () => mutations,
  useProjectsByClient: () => ({ data: [], isPending: false, isError: false }),
  useProcurementsByVendor: () => ({ data: [], isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useContacts', () => ({
  useContactsByCompany: () => contactsState,
  useCompanyActivities: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useContactMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    logActivity: { mutateAsync: vi.fn(), isPending: false },
    updateActivity: { mutateAsync: vi.fn(), isPending: false },
    deleteActivity: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import CompanyDetail from './CompanyDetail';

const company = {
  id: 'co-1',
  org_id: 'org-1',
  name: 'Cascade Port Authority',
  type: 'Client' as const,
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
};

const Probe: React.FC = () => {
  const { getContext } = useAgentContext();
  const ctx = getContext();
  return <span data-testid="entity">{ctx.entity ? JSON.stringify(ctx.entity) : 'none'}</span>;
};

const renderPage = (mount = true) => {
  realRole = 'Admin';
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/companies/co-1']}>
        <AgentContextProvider>
          <Probe />
          <Routes>
            <Route path="/companies/:companyId" element={mount ? <CompanyDetail /> : <div />} />
          </Routes>
        </AgentContextProvider>
      </MemoryRouter>
    </ToastProvider>,
  );
};

beforeEach(() => {
  detailState.data = company;
  detailState.isPending = false;
  detailState.isError = false;
  contactsState.data = [];
  contactsState.isPending = false;
});

describe('CompanyDetail entity context', () => {
  it('AC-AXP-015 detail route publishes entity', () => {
    const { rerender } = renderPage();

    expect(screen.getByTestId('entity').textContent).toBe(
      JSON.stringify({ type: 'company', id: 'co-1', label: 'Cascade Port Authority' }),
    );

    rerender(
      <ToastProvider>
        <MemoryRouter initialEntries={['/companies/co-1']}>
          <AgentContextProvider>
            <Probe />
          </AgentContextProvider>
        </MemoryRouter>
      </ToastProvider>,
    );

    expect(screen.getByTestId('entity').textContent).toBe('none');
  });
});
