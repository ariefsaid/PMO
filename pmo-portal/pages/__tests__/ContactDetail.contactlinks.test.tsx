import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

/**
 * AC-JR-W1-12 — ContactDetail email→mailto: and phone→tel: links with em-dash fallback.
 * Plan: W1-T12a
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
  email: 'jane@apex.co',
  phone: '+1 555 010 0000',
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
  activitiesState.isPending = false;
  activitiesState.isError = false;
});

describe('ContactDetail — email/phone action links (AC-JR-W1-12)', () => {
  it('AC-JR-W1-12: email renders as a mailto: link when present', () => {
    contactState.data = { ...baseContact };
    renderPage();
    const emailLink = screen.getByRole('link', { name: 'jane@apex.co' });
    expect(emailLink).toHaveAttribute('href', 'mailto:jane@apex.co');
  });

  it('AC-JR-W1-12: phone renders as a tel: link with digits-and-plus only', () => {
    contactState.data = { ...baseContact };
    renderPage();
    const phoneLink = screen.getByRole('link', { name: '+1 555 010 0000' });
    // spaces/dashes stripped: +15550100000
    expect(phoneLink).toHaveAttribute('href', 'tel:+15550100000');
  });

  it('AC-JR-W1-12: email shows em-dash (not a link) when null', () => {
    contactState.data = { ...baseContact, email: null };
    renderPage();
    // No mailto: link in the document
    const allLinks = screen.queryAllByRole('link');
    const mailtoLinks = allLinks.filter((l) => l.getAttribute('href')?.startsWith('mailto:'));
    expect(mailtoLinks).toHaveLength(0);
    // The Field dt "Email" is a <dt> element; find it by role=term
    const emailDt = screen.getAllByText('Email').find((el) => el.tagName === 'DT');
    expect(emailDt).toBeTruthy();
    const emailDd = emailDt!.closest('div')?.querySelector('dd');
    expect(emailDd?.textContent).toBe('—');
  });

  it('AC-JR-W1-12: phone shows em-dash (not a link) when null', () => {
    contactState.data = { ...baseContact, phone: null };
    renderPage();
    // No tel: link in the document
    const allLinks = screen.queryAllByRole('link');
    const telLinks = allLinks.filter((l) => l.getAttribute('href')?.startsWith('tel:'));
    expect(telLinks).toHaveLength(0);
    const phoneDt = screen.getByText('Phone');
    const phoneDd = phoneDt.closest('div')?.querySelector('dd');
    expect(phoneDd?.textContent).toBe('—');
  });
});
