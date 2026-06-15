import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

/**
 * AC-JR-W1-14 — ContactDetail activity rows link to related project/company when the
 * activity carries project_id/company_id. Plain static block when neither is set.
 * Plan: W1-T12c
 */

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-pm', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Project Manager', realRole: 'Project Manager' }),
}));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('@/src/components/ui', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});

const { contactState, companiesState, activitiesState } = vi.hoisted(() => ({
  contactState: {
    data: null as Record<string, unknown> | null,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  companiesState: {
    data: [{ id: 'co-1', name: 'Apex Corp', archived_at: null }] as Array<Record<string, unknown>>,
    isPending: false,
  },
  activitiesState: {
    data: [] as Array<Record<string, unknown>>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useContacts', () => ({
  useContact: () => contactState,
  useContactActivities: () => activitiesState,
  useContactMutations: () => ({
    update: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    logActivity: { mutateAsync: vi.fn(), isPending: false },
    updateActivity: { mutateAsync: vi.fn(), isPending: false },
    deleteActivity: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => companiesState,
}));

import ContactDetail from '../ContactDetail';

const baseContact = {
  id: 'ct-1',
  full_name: 'Jane Doe',
  company_id: 'co-1',
  title: 'Procurement Lead',
  email: null,
  phone: null,
  notes: null,
  archived_at: null,
};

const makeActivity = (overrides: Record<string, unknown>) => ({
  id: `act-${Math.random()}`,
  contact_id: 'ct-1',
  kind: 'Call' as const,
  subject: 'Project kickoff',
  body: null,
  occurred_at: '2026-06-01T10:00:00Z',
  company_id: null,
  project_id: null,
  org_id: 'org-1',
  logged_by_id: null,
  created_at: '2026-06-01T10:00:00Z',
  ...overrides,
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/contacts/ct-1']}>
      <Routes>
        <Route
          path="/contacts/:contactId"
          element={
            <ToastProvider>
              <ContactDetail />
            </ToastProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  contactState.data = { ...baseContact };
  contactState.isPending = false;
  contactState.isError = false;
  activitiesState.data = [];
  activitiesState.isPending = false;
  activitiesState.isError = false;
});

describe('ContactDetail — activity row related-object links (AC-JR-W1-14)', () => {
  it('AC-JR-W1-14: activity with project_id renders the subject as a link to /projects/:id', () => {
    activitiesState.data = [
      makeActivity({ id: 'act-1', project_id: 'p-1', subject: 'Project kickoff' }),
    ];
    renderPage();
    const projectLink = screen.getByRole('link', { name: 'Project kickoff' });
    expect(projectLink).toHaveAttribute('href', '/projects/p-1');
  });

  it('AC-JR-W1-14: activity with company_id renders the subject as a link to /companies/:id', () => {
    activitiesState.data = [
      makeActivity({ id: 'act-2', company_id: 'co-99', subject: 'Company intro meeting' }),
    ];
    renderPage();
    const companyLink = screen.getByRole('link', { name: 'Company intro meeting' });
    expect(companyLink).toHaveAttribute('href', '/companies/co-99');
  });

  it('AC-JR-W1-14: activity with neither project_id nor company_id renders subject as plain text (no link)', () => {
    activitiesState.data = [
      makeActivity({ id: 'act-3', subject: 'General note', project_id: null, company_id: null }),
    ];
    renderPage();
    expect(screen.getByText('General note').tagName).not.toBe('A');
    // No link for this subject
    expect(screen.queryByRole('link', { name: 'General note' })).not.toBeInTheDocument();
  });

  it('AC-JR-W1-14: project_id takes precedence over company_id when both are set', () => {
    activitiesState.data = [
      makeActivity({ id: 'act-4', project_id: 'p-2', company_id: 'co-2', subject: 'Both set' }),
    ];
    renderPage();
    const link = screen.getByRole('link', { name: 'Both set' });
    expect(link).toHaveAttribute('href', '/projects/p-2');
  });
});
