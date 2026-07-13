import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

// empty_state_seen (FIX 1, 2026-07-13 wiring plan follow-up). Mirrors
// Contacts.test.tsx's mock harness; adds the analytics facade mock.
const analytics = vi.hoisted(() => ({ trackEmptyStateSeen: vi.fn() }));
vi.mock('@/src/lib/analytics', () => ({ trackEmptyStateSeen: analytics.trackEmptyStateSeen }));

const { contactsState, companiesState, mutations, navigateMock } = vi.hoisted(() => ({
  contactsState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  companiesState: { data: [] as unknown[], isPending: false, isError: false },
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    logActivity: { mutateAsync: vi.fn(), isPending: false },
  },
  navigateMock: vi.fn(),
}));

vi.mock('@/src/hooks/useContacts', () => ({
  useContacts: () => contactsState,
  useContactMutations: () => mutations,
}));
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => companiesState,
}));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import Contacts from './Contacts';

const renderPage = (role: Role = 'Admin') => {
  realRole = role;
  return render(
    <ToastProvider>
      <MemoryRouter>
        <Contacts />
      </MemoryRouter>
    </ToastProvider>,
  );
};

beforeEach(() => {
  contactsState.data = [];
  contactsState.isPending = false;
  contactsState.isError = false;
  analytics.trackEmptyStateSeen.mockClear();
  realRole = 'Admin';
});

describe('Contacts: empty_state_seen fires when there are zero contacts (FIX 1)', () => {
  it('AC: renders the empty ListState and fires empty_state_seen with state_id/role/module', () => {
    renderPage('Finance');
    expect(screen.getByText('No contacts yet')).toBeInTheDocument();
    expect(analytics.trackEmptyStateSeen).toHaveBeenCalledWith('contacts-empty', 'Finance', 'contacts');
  });
});
