import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';

// ── Repository-seam-backed hooks are mocked; the page is the unit under test. ──
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

// CW-4b: rows navigate to /contacts/:id — capture the navigate call.
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import Contacts from './Contacts';

const companies = [
  { id: 'co1', name: 'Cascade Port Authority', type: 'Client', org_id: 'org-1', archived_at: null },
  { id: 'co2', name: 'Steelforge Fabrication', type: 'Vendor', org_id: 'org-1', archived_at: null },
];

const contacts = [
  { id: 'ct1', full_name: 'Jane Doe', company_id: 'co1', title: 'Buyer', email: 'jane@cascade.test', phone: null, notes: null, org_id: 'org-1', archived_at: null, created_at: '2026-01-01T00:00:00Z' },
  { id: 'ct2', full_name: 'Marcus Webb', company_id: 'co2', title: 'Procurement Lead', email: 'm@steelforge.test', phone: null, notes: null, org_id: 'org-1', archived_at: null, created_at: '2026-02-01T00:00:00Z' },
];

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
  contactsState.data = contacts;
  contactsState.isPending = false;
  contactsState.isError = false;
  contactsState.refetch.mockClear();
  companiesState.data = companies;
  companiesState.isPending = false;
  companiesState.isError = false;
  Object.values(mutations).forEach((m) => {
    m.mutateAsync.mockReset();
    m.mutateAsync.mockResolvedValue(undefined);
    m.isPending = false;
  });
  navigateMock.mockClear();
  realRole = 'Admin';
});

describe('Contacts index — rows + states (AC-CRM-030)', () => {
  it('AC-CRM-030: renders seeded contact rows with name + resolved company', () => {
    renderPage();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('Marcus Webb')).toBeInTheDocument();
    // The company name is resolved from the companyById map and shown in the row's Company cell.
    const janeRow = screen.getByText('Jane Doe').closest('tr')!;
    expect(within(janeRow).getByText('Cascade Port Authority')).toBeInTheDocument();
    const marcusRow = screen.getByText('Marcus Webb').closest('tr')!;
    expect(within(marcusRow).getByText('Steelforge Fabrication')).toBeInTheDocument();
  });

  it('AC-CRM-030: loading skeleton while pending', () => {
    contactsState.isPending = true;
    renderPage();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  });

  it('AC-CRM-030: error state with retry', async () => {
    contactsState.isError = true;
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(contactsState.refetch).toHaveBeenCalled();
  });

  it('AC-CRM-030: empty state when there are no contacts', () => {
    contactsState.data = [];
    renderPage('Admin');
    expect(screen.getByText(/No contacts yet/i)).toBeInTheDocument();
  });

  it('AC-CRM-030: search filters rows by name', async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText(/Search contacts/i), 'marcus');
    expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument();
    expect(screen.getByText('Marcus Webb')).toBeInTheDocument();
  });

  it('AC-CRM-030: the company filter narrows the visible rows', async () => {
    renderPage();
    await userEvent.selectOptions(screen.getByLabelText(/Filter by company/i), 'co2');
    expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument();
    expect(screen.getByText('Marcus Webb')).toBeInTheDocument();
  });
});

describe('Contacts index — RBAC affordance gating (AC-CRM-030)', () => {
  it('AC-CRM-030: Admin sees New contact', () => {
    renderPage('Admin');
    expect(screen.getByRole('button', { name: /New contact/i })).toBeInTheDocument();
  });

  it('AC-CRM-030: a non-writer (Engineer) sees NO New contact button and no row menu', () => {
    renderPage('Engineer');
    expect(screen.queryByRole('button', { name: /New contact/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Row actions/i })).not.toBeInTheDocument();
  });
});

describe('Contacts create form (AC-CRM-030)', () => {
  it('AC-CRM-030: a valid create submits name + company to the mutation', async () => {
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /New contact/i }));
    await userEvent.type(screen.getByLabelText(/Full name/i), 'Nina Park');
    await userEvent.selectOptions(screen.getByLabelText(/^Company/i), 'co1');
    await userEvent.click(screen.getByRole('button', { name: /^Create contact$/i }));
    await waitFor(() =>
      expect(mutations.create.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ full_name: 'Nina Park', company_id: 'co1' }),
      ),
    );
  });
});

// CW-4b: the drawer-as-record is retired — a row now NAVIGATES to the routable
// `/contacts/:id` record page (the page's own anatomy + the activity timeline + Log-activity
// form are covered by ContactDetail.test.tsx). The journey's goal — "open this contact's
// record" — is intact; the destination changed from an in-page overlay to a URL.
describe('Contacts index — row → detail navigation (CW-4b)', () => {
  it('CW-4b: activating a row navigates to the routable /contacts/:id page', async () => {
    renderPage('Admin');
    // Row activation = the first-cell <button> (rowLabel "Open <name>").
    expect(screen.getByRole('button', { name: 'Open Marcus Webb' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open Marcus Webb' }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/contacts/ct2'));
  });

  it('CW-4b: the drawer-as-record overlay is gone — activating a row opens no dialog', async () => {
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: 'Open Jane Doe' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Contacts row actions (AC-CRM-030)', () => {
  const openRowMenu = async (name: string) => {
    await userEvent.click(
      within(screen.getByText(name).closest('tr')!).getByRole('button', { name: /Row actions/i }),
    );
  };

  it('AC-CRM-030: Edit pre-fills the row and submits an update', async () => {
    renderPage('Admin');
    await openRowMenu('Jane Doe');
    await userEvent.click(screen.getByRole('menuitem', { name: /Edit/i }));
    const nameInput = screen.getByLabelText(/Full name/i) as HTMLInputElement;
    expect(nameInput.value).toBe('Jane Doe');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Jane Reyes');
    await userEvent.click(screen.getByRole('button', { name: /^Save contact$/i }));
    await waitFor(() =>
      expect(mutations.update.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'ct1', input: expect.objectContaining({ full_name: 'Jane Reyes' }) }),
      ),
    );
  });

  it('AC-CRM-030: Archive routes through a confirm and calls the mutation', async () => {
    renderPage('Admin');
    await openRowMenu('Jane Doe');
    await userEvent.click(screen.getByRole('menuitem', { name: /Archive/i }));
    expect(mutations.archive.mutateAsync).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Archive contact/i }));
    await waitFor(() => expect(mutations.archive.mutateAsync).toHaveBeenCalledWith('ct1'));
  });

  it('AC-CRM-030: Delete routes through a destructive confirm and calls the mutation', async () => {
    renderPage('Admin');
    await openRowMenu('Jane Doe');
    await userEvent.click(screen.getByRole('menuitem', { name: /Delete/i }));
    await userEvent.click(screen.getByRole('button', { name: /Delete contact/i }));
    await waitFor(() => expect(mutations.remove.mutateAsync).toHaveBeenCalledWith('ct1'));
  });

  it('AC-CRM-030: a delete rejected by RLS surfaces a classified warning toast', async () => {
    mutations.remove.mutateAsync.mockRejectedValue(new AppError('not permitted', '42501'));
    renderPage('Admin');
    await openRowMenu('Jane Doe');
    await userEvent.click(screen.getByRole('menuitem', { name: /Delete/i }));
    await userEvent.click(screen.getByRole('button', { name: /Delete contact/i }));
    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent(/don't have permission/i);
  });
});

describe('Contacts page view-gate (AC-CRM-030)', () => {
  it('AC-CRM-030: an Engineer reaching /contacts by URL gets an access-denied surface, not the directory', () => {
    renderPage('Engineer');
    expect(screen.getByText(/don't have access to Contacts/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
