import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

// ── The single-company hook + mutations + the company-contacts read are mocked; the page is the unit. ──
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
  // AC-IFW-COMPANY-01 hooks — default to empty/idle so existing tests are unaffected.
  useProjectsByClient: () => ({ data: [], isPending: false, isError: false }),
  useProcurementsByVendor: () => ({ data: [], isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useContacts', () => ({
  useContactsByCompany: () => contactsState,
}));

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import CompanyDetail from './CompanyDetail';

const company = {
  id: 'co1',
  org_id: 'org-1',
  name: 'Cascade Port Authority',
  type: 'Client' as const,
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
};

const renderPage = (role: Role = 'Admin') => {
  realRole = role;
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/companies/co1']}>
        <Routes>
          <Route path="/companies/:companyId" element={<CompanyDetail />} />
          <Route path="/companies" element={<div>Companies index</div>} />
          <Route path="/contacts/:contactId" element={<div>Contact page</div>} />
        </Routes>
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
  mutations.update.mutateAsync.mockClear().mockResolvedValue(undefined);
  mutations.archive.mutateAsync.mockClear().mockResolvedValue(undefined);
  realRole = 'Admin';
});

describe('CompanyDetail', () => {
  it('CW-4b: renders the shared RecordHeader with the company name + type pill, and its fields', () => {
    renderPage();
    const header = screen.getByTestId('record-header');
    expect(within(header).getByText('Cascade Port Authority')).toBeInTheDocument();
    // The categorical company-type pill surfaces in the header.
    expect(within(header).getByText('Client')).toBeInTheDocument();
  });

  it('CW-4b: shows the loading skeleton while the record is pending', () => {
    detailState.data = undefined;
    detailState.isPending = true;
    renderPage();
    expect(screen.getByTestId('company-loading')).toBeInTheDocument();
  });

  it('CW-4b: shows a calm not-found state when the record is absent', () => {
    detailState.data = null;
    detailState.isPending = false;
    renderPage();
    expect(screen.getByTestId('company-not-found')).toBeInTheDocument();
  });

  it('CW-4b: a transient load error offers Retry', async () => {
    detailState.data = undefined;
    detailState.isError = true;
    renderPage();
    const retry = screen.getByRole('button', { name: /retry|try again/i });
    await userEvent.click(retry);
    expect(detailState.refetch).toHaveBeenCalled();
  });

  it('CW-4b: Back returns to the Companies list', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /back to companies/i }));
    expect(screen.getByText('Companies index')).toBeInTheDocument();
  });

  it('CW-4b: renders the Contacts section (FR-CRM-008) — empty state when none', () => {
    contactsState.data = [];
    renderPage();
    expect(screen.getByText(/no contacts yet/i)).toBeInTheDocument();
  });

  it('CW-4b: renders the company contacts list (FR-CRM-008) when present', () => {
    contactsState.data = [
      { id: 'ct1', full_name: 'Jane Doe', title: 'Procurement Lead' },
      { id: 'ct2', full_name: 'John Roe', title: null },
    ];
    renderPage();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('John Roe')).toBeInTheDocument();
  });

  it('CW-4b: a contact in the Contacts section navigates to its routable /contacts/:id page (the master-data graph is navigable)', async () => {
    contactsState.data = [{ id: 'ct1', full_name: 'Jane Doe', title: 'Procurement Lead' }];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /open jane doe/i }));
    expect(screen.getByText('Contact page')).toBeInTheDocument();
  });

  it('CW-4b: the Contacts section shows a loading state while contacts are fetching', () => {
    contactsState.isPending = true;
    contactsState.data = [];
    renderPage();
    expect(screen.getByRole('status', { name: /loading contacts/i })).toBeInTheDocument();
  });

  it('CW-4b: a manager can open the edit modal from the header and save an update', async () => {
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    const dialog = await screen.findByRole('dialog', { name: /edit company/i });
    const nameField = within(dialog).getByLabelText(/company name/i);
    await userEvent.clear(nameField);
    await userEvent.type(nameField, 'Cascade Holdings');
    await userEvent.click(within(dialog).getByRole('button', { name: /save company/i }));
    expect(mutations.update.mutateAsync).toHaveBeenCalledWith({
      id: 'co1',
      input: expect.objectContaining({ name: 'Cascade Holdings' }),
    });
  });

  it('CW-4b: a manager can archive from the header (confirm-before-write)', async () => {
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /^archive$/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /archive company/i }));
    expect(mutations.archive.mutateAsync).toHaveBeenCalledWith('co1');
  });

  it('CW-4b: an Engineer (no company access) sees the access-denied surface, not the record', () => {
    renderPage('Engineer');
    expect(screen.getByText(/don't have access to companies/i)).toBeInTheDocument();
    expect(screen.queryByTestId('record-header')).toBeNull();
  });
});
