/**
 * AC-AXP-015 — ContactDetail publishes its loaded record to the live agent
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

const { detailState, activitiesState, mutations, companiesState } = vi.hoisted(() => ({
  detailState: {
    data: undefined as Record<string, unknown> | null | undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  activitiesState: {
    data: [] as Record<string, unknown>[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    archive: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    remove: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    logActivity: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    updateActivity: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    deleteActivity: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
  },
  companiesState: {
    data: [{ id: 'co-1', name: 'Cascade Port Authority', type: 'Client' }],
  },
}));

vi.mock('@/src/hooks/useContacts', () => ({
  useContact: () => detailState,
  useContactActivities: () => activitiesState,
  useContactMutations: () => mutations,
}));
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => companiesState,
}));

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import ContactDetail from './ContactDetail';

const contact = {
  id: 'ct-1',
  org_id: 'org-1',
  company_id: 'co-1',
  full_name: 'Jane Doe',
  title: 'Procurement Lead',
  email: 'jane@example.com',
  phone: '+1 555 010 0000',
  notes: 'Key contact',
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
      <MemoryRouter initialEntries={['/contacts/ct-1']}>
        <AgentContextProvider>
          <Probe />
          <Routes>
            <Route path="/contacts/:contactId" element={mount ? <ContactDetail /> : <div />} />
          </Routes>
        </AgentContextProvider>
      </MemoryRouter>
    </ToastProvider>,
  );
};

beforeEach(() => {
  detailState.data = contact;
  detailState.isPending = false;
  detailState.isError = false;
  activitiesState.data = [];
  activitiesState.isPending = false;
  activitiesState.isError = false;
});

describe('ContactDetail entity context', () => {
  it('AC-AXP-015 detail route publishes entity', () => {
    const { rerender } = renderPage();

    expect(screen.getByTestId('entity').textContent).toBe(
      JSON.stringify({ type: 'contact', id: 'ct-1', label: 'Jane Doe' }),
    );

    rerender(
      <ToastProvider>
        <MemoryRouter initialEntries={['/contacts/ct-1']}>
          <AgentContextProvider>
            <Probe />
          </AgentContextProvider>
        </MemoryRouter>
      </ToastProvider>,
    );

    expect(screen.getByTestId('entity').textContent).toBe('none');
  });
});
