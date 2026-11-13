/**
 * Floor tests for the Contacts index (floor-wave2).
 *
 * Each test drives ONE control a person can reach on this screen and asserts the OUTCOME that
 * control exists for (rows narrow, a dialog opens, the value reaches the create/update payload,
 * the route changes). No looks, no exact marketing copy. The mock set-up mirrors the page's own
 * test file (Contacts.test.tsx) — same repository-seam mocks, same real router.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { clearOwnershipCache } from '@/src/lib/adapterSeam/ownershipCache';
import { ownershipMock } from '@/test/domainOwnershipMock';

const h = vi.hoisted(() => ({
  directory: [] as Array<Record<string, unknown>>,
  refetch: vi.fn(),
  lastInput: null as Record<string, unknown> | null,
  exportAll: vi.fn(),
  companies: [] as Array<Record<string, unknown>>,
  companiesError: false,
  companyRefetch: vi.fn(),
  exportXlsx: vi.fn(),
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    logActivity: { mutateAsync: vi.fn(), isPending: false },
  },
}));

vi.mock('@/src/hooks/useDomainOwnershipMode', async () => await import('@/test/domainOwnershipMock'));

vi.mock('@/src/components/export/useExport', () => ({
  useExport: () => ({ exportXlsx: h.exportXlsx, busy: false }),
}));

vi.mock('@/src/hooks/useContacts', () => ({
  useContactsPage: (input: { companyId: string; search: string; page: number; pageSize: number }) => {
    h.lastInput = input;
    const q = input.search.trim().toLowerCase();
    const matching = h.directory.filter((c) => {
      const companyOk = input.companyId === 'All' || c.company_id === input.companyId;
      const searchOk = !q || String(c.full_name).toLowerCase().includes(q) || String(c.email ?? '').toLowerCase().includes(q);
      return companyOk && searchOk;
    });
    const start = (input.page - 1) * input.pageSize;
    return {
      data: { rows: matching.slice(start, start + input.pageSize), total: matching.length },
      isPending: false,
      isError: false,
      isPlaceholderData: false,
      isFetching: false,
      refetch: h.refetch,
    };
  },
  useContactsTotal: () => ({ data: null, isPending: false, isError: false }),
  useContactsExportAll: () => ({ mutateAsync: h.exportAll, isPending: false }),
  useContactMutations: () => h.mutations,
}));

const partyMappings = vi.hoisted(() => ({ ids: ['11111111-1111-4111-8111-111111111111'], isPending: false, isError: false }));
vi.mock('@/src/hooks/useCompanyPartyMappings', () => ({ useCompanyPartyMappings: () => partyMappings }));

vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanyOptions: () => ({
    data: h.companiesError ? undefined : h.companies,
    isPending: false,
    isError: h.companiesError,
    refetch: h.companyRefetch,
  }),
}));

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import Contacts from './Contacts';

const companies = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Cascade Port Authority', type: 'Client', org_id: 'org-1', archived_at: null },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Steelforge Fabrication', type: 'Vendor', org_id: 'org-1', archived_at: null },
];

const contacts = [
  { id: 'ct1', full_name: 'Jane Doe', company_id: '11111111-1111-4111-8111-111111111111', title: 'Buyer', email: 'jane@cascade.test', phone: null, notes: null, org_id: 'org-1', archived_at: null, created_at: '2026-01-01T00:00:00Z' },
  { id: 'ct2', full_name: 'Marcus Webb', company_id: '22222222-2222-4222-8222-222222222222', title: 'Procurement Lead', email: 'm@steelforge.test', phone: null, notes: null, org_id: 'org-1', archived_at: null, created_at: '2026-02-01T00:00:00Z' },
];

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="location-probe" data-pathname={location.pathname} data-search={location.search} />;
};

const renderPage = (role: Role = 'Admin', initialPath = '/contacts') => {
  realRole = role;
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <LocationProbe />
        <Contacts />
      </MemoryRouter>
    </ToastProvider>,
  );
};

beforeEach(() => {
  h.directory = contacts;
  h.refetch.mockClear();
  h.lastInput = null;
  h.exportAll.mockReset();
  h.exportAll.mockResolvedValue(contacts);
  h.companies = companies;
  h.companiesError = false;
  h.companyRefetch.mockClear();
  h.exportXlsx.mockReset();
  Object.values(h.mutations).forEach((m) => {
    m.mutateAsync.mockReset();
    m.mutateAsync.mockResolvedValue(undefined);
    m.isPending = false;
  });
  realRole = 'Admin';
  partyMappings.ids = ['11111111-1111-4111-8111-111111111111'];
  partyMappings.isPending = false;
  partyMappings.isError = false;
  ownershipMock.override = null;
  ownershipMock.retry.mockClear();
  clearOwnershipCache();
});

describe('Contacts floor — empty state', () => {
  it('floor: Add your first contact opens the create form and saves the contact', async () => {
    h.directory = [];
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /Add your first contact/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Full name/i), 'Nina Park');
    await userEvent.selectOptions(
      screen.getByLabelText(/^Company/i, { selector: 'select' }),
      '11111111-1111-4111-8111-111111111111',
    );
    await userEvent.click(screen.getByRole('button', { name: /^Create contact$/i }));
    await waitFor(() =>
      expect(h.mutations.create.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ full_name: 'Nina Park', company_id: '11111111-1111-4111-8111-111111111111' }),
      ),
    );
  });
});

describe('Contacts floor — toolbar', () => {
  it('floor: Export reads every contact matching the active filter and names its company', async () => {
    renderPage('Admin', '/contacts?company=22222222-2222-4222-8222-222222222222');
    await userEvent.click(screen.getByRole('button', { name: /^Export$/i }));
    await waitFor(() => expect(h.exportAll).toHaveBeenCalledWith({ companyId: '22222222-2222-4222-8222-222222222222', search: undefined }));
    // The full matching set is handed to the workbook writer, with the display columns bound.
    await waitFor(() => expect(h.exportXlsx).toHaveBeenCalled());
    const rowsArg = h.exportXlsx.mock.calls[0][0] as typeof contacts;
    const columnsArg = h.exportXlsx.mock.calls[0][1] as Array<{ key: string; exportValue?: (r: (typeof contacts)[number]) => string }>;
    expect(rowsArg).toEqual(contacts);
    const byKey = Object.fromEntries(columnsArg.map((c) => [c.key, c]));
    expect(byKey.full_name.exportValue?.(contacts[0])).toBe('Jane Doe');
    expect(byKey.company.exportValue?.(contacts[0])).toBe('Cascade Port Authority');
    expect(byKey.email.exportValue?.(contacts[0])).toBe('jane@cascade.test');
  });

  it('floor: Import opens the contact import wizard', async () => {
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /^Import$/i }));
    expect(await screen.findByRole('dialog', { name: /Import contacts/i })).toBeInTheDocument();
  });
});

describe('Contacts floor — pager', () => {
  const bigDirectory = [
    ...contacts,
    ...Array.from({ length: 57 }, (_, i) => ({
      id: `ct-bulk-${i}`,
      full_name: `Bulk Person ${String(i + 1).padStart(2, '0')}`,
      company_id: '11111111-1111-4111-8111-111111111111',
      email: null,
      archived_at: null,
    })),
  ];

  it('floor: Previous page returns to page one and is disabled at the first page', async () => {
    h.directory = bigDirectory;
    renderPage('Admin');
    await waitFor(() => expect(screen.getByText('Bulk Person 47')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Previous page/i })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /Next page/i }));
    await waitFor(() => expect(screen.getByText('Bulk Person 51')).toBeInTheDocument());
    expect(h.lastInput).toMatchObject({ page: 2 });
    await userEvent.click(screen.getByRole('button', { name: /Previous page/i }));
    await waitFor(() => expect(h.lastInput).toMatchObject({ page: 1 }));
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.queryByText('Bulk Person 51')).not.toBeInTheDocument();
  });
});

describe('Contacts floor — recoveries', () => {
  it('floor: ownership error Retry rechecks ownership', async () => {
    ownershipMock.override = 'error';
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /^Retry$/i }));
    expect(ownershipMock.retry).toHaveBeenCalled();
  });

  it('floor: company directory Retry refetches the directory', async () => {
    h.companiesError = true;
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /^Retry$/i }));
    expect(h.companyRefetch).toHaveBeenCalled();
  });

  it('floor: access denied Back returns to the dashboard', async () => {
    renderPage('Engineer');
    expect(screen.getByText(/don't have access to Contacts/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Back to Dashboard/i }));
    await waitFor(() => expect(screen.getByTestId('location-probe').dataset.pathname).toBe('/'));
  });
});

describe('Contacts floor — contact-details fields', () => {
  const openCreate = async () => {
    await userEvent.click(screen.getByRole('button', { name: /New contact/i }));
    await userEvent.type(screen.getByLabelText(/Full name/i), 'Nina Park');
    await userEvent.selectOptions(
      screen.getByLabelText(/^Company/i, { selector: 'select' }),
      '11111111-1111-4111-8111-111111111111',
    );
  };

  // NB: an `input type="email"` sanitizes leading/trailing whitespace itself (HTML value
  // sanitization, honoured by jsdom), so the payload's `.trim()` cannot be observed through this
  // field — the floor here is that the typed address REACHES the create payload.
  it('floor: email typed on the create form reaches the create payload', async () => {
    renderPage('Admin');
    await openCreate();
    await userEvent.type(screen.getByLabelText(/^Email/i, { selector: 'input' }), 'nina@cascade.test');
    await userEvent.click(screen.getByRole('button', { name: /^Create contact$/i }));
    await waitFor(() =>
      expect(h.mutations.create.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'nina@cascade.test' }),
      ),
    );
  });

  it('floor: phone typed on the create form reaches the create payload trimmed', async () => {
    renderPage('Admin');
    await openCreate();
    await userEvent.type(screen.getByLabelText(/^Phone/i), '  +1 555 010 0000  ');
    await userEvent.click(screen.getByRole('button', { name: /^Create contact$/i }));
    await waitFor(() =>
      expect(h.mutations.create.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '+1 555 010 0000' }),
      ),
    );
  });

  it('floor: notes typed on the edit form reach the update payload', async () => {
    renderPage('Admin');
    const janeRow = screen.getByText('Jane Doe').closest('tr')!;
    await userEvent.click(within(janeRow).getByRole('button', { name: /Row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Edit/i }));
    await userEvent.type(screen.getByLabelText(/^Notes/i), 'Prefers email');
    await userEvent.click(screen.getByRole('button', { name: /^Save contact$/i }));
    await waitFor(() =>
      expect(h.mutations.update.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'ct1', input: expect.objectContaining({ notes: 'Prefers email' }) }),
      ),
    );
  });
});
