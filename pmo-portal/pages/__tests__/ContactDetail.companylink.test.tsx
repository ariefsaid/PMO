import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

/**
 * AC-JR-W1-13 — ContactDetail Company field renders as a /companies/:id Link when company_id
 * resolves. Plan: W1-T12b
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
  contactState.data = null;
  contactState.isPending = false;
  contactState.isError = false;
  activitiesState.data = [];
});

describe('ContactDetail — Company field link (AC-JR-W1-13)', () => {
  it('AC-JR-W1-13: Company field is a Link to /companies/:id when company_id resolves', () => {
    contactState.data = { ...baseContact };
    renderPage();
    const companyLink = screen.getByRole('link', { name: 'Apex Corp' });
    expect(companyLink).toHaveAttribute('href', '/companies/co-1');
  });

  it('AC-JR-W1-13: Company field shows the name as plain text (em-dash) when company_id is missing', () => {
    contactState.data = { ...baseContact, company_id: null };
    // No matching company — shows em-dash
    renderPage();
    expect(screen.queryByRole('link', { name: /apex corp/i })).not.toBeInTheDocument();
    // "—" present in the Company dd
    const companyDt = screen.getByText('Company');
    const companyDd =
      companyDt.closest('[class]')?.querySelector('dd') ??
      companyDt.parentElement?.querySelector('dd');
    expect(companyDd?.textContent).toBe('—');
  });
});
