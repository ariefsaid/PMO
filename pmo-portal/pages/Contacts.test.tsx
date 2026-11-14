import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { findToastAnnouncement } from '@/src/components/ui/__tests__/toastTestQueries';
import { AppError } from '@/src/lib/appError';

// ── Repository-seam-backed hooks are mocked; the page is the unit under test. ──
// #1989: the page reads ONE SERVER page and no longer filters in the browser, so the
// useContactsPage mock is a SERVER STUB mirroring the directory read's contract (company filter
// + name/email search applied before the range, one pageSize window, exact total). The company
// options read stays whole-directory (the picker must offer everyone), narrowed to display rows.
const h = vi.hoisted(() => ({
  directory: [] as Array<Record<string, unknown>>,
  pending: false,
  error: false,
  /** The kept-previous payload react-query paints while a new query lands (keepPreviousData). */
  placeholder: false,
  refetch: vi.fn(),
  lastInput: null as Record<string, unknown> | null,
  companies: [] as Array<Record<string, unknown>>,
  companiesPending: false,
  companiesError: false,
  total: 0,
  totalEnabled: false,
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    logActivity: { mutateAsync: vi.fn(), isPending: false },
  },
}));

vi.mock('@/src/hooks/useDomainOwnershipMode', async () => await import('@/test/domainOwnershipMock'));

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
      data: h.error || h.pending
        ? null
        : { rows: matching.slice(start, start + input.pageSize), total: matching.length },
      isPending: h.pending,
      isError: h.error,
      isPlaceholderData: h.placeholder,
      isFetching: false,
      refetch: h.refetch,
    };
  },
  useContactsTotal: (options?: { enabled?: boolean }) => {
    h.totalEnabled = options?.enabled ?? false;
    return { data: options?.enabled ? h.total : undefined, isPending: false, isError: false };
  },
  useContactsExportAll: () => ({ mutateAsync: vi.fn(async () => h.directory), isPending: false }),
  useContactMutations: () => h.mutations,
}));
const partyMappings = vi.hoisted(() => ({ ids: ['11111111-1111-4111-8111-111111111111'], isPending: false, isError: false }));
vi.mock('@/src/hooks/useCompanyPartyMappings', () => ({ useCompanyPartyMappings: () => partyMappings }));

vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanyOptions: () => ({
    data: h.companiesError ? undefined : h.companies,
    isPending: h.companiesPending,
    isError: h.companiesError,
    refetch: vi.fn(),
  }),
}));

// list-working-set-return (#683): the page writes real router navigation for its `company`/`q`
// URL state and for record-open return context, so `react-router` stays UNMOCKED — a LocationProbe
// sibling (below) reads the real `useLocation()` to assert the resulting URL/state.

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import Contacts from './Contacts';
import { clearOwnershipCache, setTaskOwnership } from '@/src/lib/adapterSeam/ownershipCache';
import { ownershipMock } from '@/test/domainOwnershipMock';

const companies = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Cascade Port Authority', type: 'Client', org_id: 'org-1', archived_at: null },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Steelforge Fabrication', type: 'Vendor', org_id: 'org-1', archived_at: null },
];

const contacts = [
  { id: 'ct1', full_name: 'Jane Doe', company_id: '11111111-1111-4111-8111-111111111111', title: 'Buyer', email: 'jane@cascade.test', phone: null, notes: null, org_id: 'org-1', archived_at: null, created_at: '2026-01-01T00:00:00Z' },
  { id: 'ct2', full_name: 'Marcus Webb', company_id: '22222222-2222-4222-8222-222222222222', title: 'Procurement Lead', email: 'm@steelforge.test', phone: null, notes: null, org_id: 'org-1', archived_at: null, created_at: '2026-02-01T00:00:00Z' },
];

// list-working-set-return (#683): reads the REAL router location so tests can assert the URL
// (filter/search round-trip) and the record-open return-context `location.state`.
const LocationProbe: React.FC = () => {
  const location = useLocation();
  return (
    <div
      data-testid="location-probe"
      data-pathname={location.pathname}
      data-search={location.search}
    >
      {JSON.stringify(location.state ?? null)}
    </div>
  );
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

const selectCompanyFilter = async (companyName: string) => {
  await userEvent.click(screen.getByRole('combobox', { name: /Filter by company/i }));
  await userEvent.click(await screen.findByRole('option', { name: companyName }));
};

/** The shell's scroll container, sized so a restore has a real range to land in (jsdom has no layout). */
const sizeMainScroll = (): HTMLElement => {
  const main = document.querySelector<HTMLElement>('.main-scroll')!;
  Object.defineProperties(main, {
    scrollHeight: { configurable: true, value: 2000 },
    clientHeight: { configurable: true, value: 400 },
  });
  return main;
};

const mutations = h.mutations;

beforeEach(() => {
  h.directory = contacts;
  h.pending = false;
  h.error = false;
  h.placeholder = false;
  h.refetch.mockClear();
  h.lastInput = null;
  h.companies = companies;
  h.companiesPending = false;
  h.companiesError = false;
  h.total = contacts.length;
  h.totalEnabled = false;
  Object.values(mutations).forEach((m) => {
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

describe('Contacts index — shared ListPage shell (CW-5)', () => {
  it('renders on the shared ListPage shell: header + canonical toolbar', () => {
    renderPage();
    expect(screen.getByTestId('list-page-header')).toBeInTheDocument();
    expect(screen.getByTestId('list-page-toolbar')).toBeInTheDocument();
    expect(within(screen.getByTestId('list-page-header')).getByRole('heading', { name: 'Contacts' })).toBeInTheDocument();
  });

  it('AC-EXP-008 / AC-IMP-009: renders live Export and Import affordances in the toolbar', () => {
    renderPage('Admin');
    const exportBtn = screen.getByRole('button', { name: /export/i });
    expect(exportBtn).toBeInTheDocument();
    expect(exportBtn).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /import/i })).toBeInTheDocument();
  });
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
    h.pending = true;
    renderPage();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  });

  it('AC-CRM-030: error state with retry', async () => {
    h.error = true;
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(h.refetch).toHaveBeenCalled();
  });

  it('AC-CRM-030: empty state when there are no contacts', () => {
    h.directory = [];
    renderPage('Admin');
    expect(screen.getByText(/No contacts yet/i)).toBeInTheDocument();
  });

  it('C5 useContacts.ts:62 / Contacts.tsx: a kept-previous page never states an empty directory', () => {
    // The new (unfiltered) read has not landed yet; react-query paints the PREVIOUS query's
    // zero-match payload as a placeholder. That payload knows nothing about the new query.
    h.directory = [];
    h.placeholder = true;
    renderPage('Admin');

    expect(screen.queryByText(/No contacts yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/No contacts match your filters/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    // …and the toolbar stays mounted, so the person can still clear a filter or search.
    expect(screen.getByLabelText(/Search contacts/i)).toBeInTheDocument();
  });

  it('AC-CRM-030: search filters rows by name — the committed term goes to the server', async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText(/Search contacts/i), 'marcus');
    await waitFor(() => expect(h.lastInput).toMatchObject({ search: 'marcus' }));
    await waitFor(() => expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument());
    expect(screen.getByText('Marcus Webb')).toBeInTheDocument();
  });

  it('AC-CRM-030: the company filter narrows the visible rows — by asking the SERVER for that company', async () => {
    renderPage();
    await selectCompanyFilter('Steelforge Fabrication');
    await waitFor(() => expect(h.lastInput).toMatchObject({ companyId: '22222222-2222-4222-8222-222222222222' }));
    await waitFor(() => expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument());
    expect(screen.getByText('Marcus Webb')).toBeInTheDocument();
  });

  it('move 1: Clear all is absent until a filter is active', async () => {
    renderPage();
    expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Search contacts/i), 'marcus');
    expect(await screen.findByRole('button', { name: 'Clear all' })).toBeInTheDocument();
  });

  it('move 1: gives search a visible label alongside the labelled company filter', () => {
    renderPage();
    expect(screen.getByText('Search contacts')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter by company' })).toBeInTheDocument();
  });
});

describe('Contacts index — server paging (#1989)', () => {
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

  it('renders ONE page of rows and the pager range, with a working Next page', async () => {
    h.directory = bigDirectory;
    renderPage();
    await waitFor(() => expect(screen.getByText('Bulk Person 47')).toBeInTheDocument());
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.queryByText('Bulk Person 51')).not.toBeInTheDocument();
    expect(screen.getByText('1–50 of 59')).toBeInTheDocument();
    const next = screen.getByRole('button', { name: /Next page/i });
    expect(next).toBeEnabled();
    await userEvent.click(next);
    await waitFor(() => expect(screen.getByText('Bulk Person 51')).toBeInTheDocument());
    expect(h.lastInput).toMatchObject({ page: 2 });
    expect(screen.getByText('51–59 of 59')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next page/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Previous page/i })).toBeEnabled();
  });

  it('move 2: shows the matching count against the whole directory total', async () => {
    h.directory = [
      contacts[0],
      { ...contacts[0], id: 'ct3', full_name: 'Amina Yusuf' },
      ...Array.from({ length: 14 }, (_, index) => ({
        ...contacts[1],
        id: `ct-other-${index}`,
        full_name: `Other Contact ${index + 1}`,
      })),
    ];
    h.total = 16;
    renderPage();
    await selectCompanyFilter('Cascade Port Authority');
    expect(await screen.findByText('Showing 2 of 16')).toBeInTheDocument();
    expect(screen.getByText('1–2 of 2')).toBeInTheDocument();
    expect(h.totalEnabled).toBe(true);
  });

  it('move 3: the directory shows a contact title and phone number', () => {
    h.directory = [{
      ...contacts[0],
      title: 'Procurement Lead',
      phone: '+1 555 010 0000',
    }];
    renderPage();
    expect(screen.getByText('Procurement Lead')).toBeInTheDocument();
    expect(screen.getByText('Phone')).toBeInTheDocument();
    expect(screen.getByText('+1 555 010 0000')).toBeInTheDocument();
  });

  it('a filter/search change lands on page 1 of the new result set', async () => {
    h.directory = bigDirectory;
    renderPage();
    await waitFor(() => expect(screen.getByText('1–50 of 59')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Next page/i }));
    await waitFor(() => expect(screen.getByText('51–59 of 59')).toBeInTheDocument());
    await selectCompanyFilter('Steelforge Fabrication');
    // the Steelforge set is small — page 1 of it, not page 2 of the old result set
    await waitFor(() => expect(h.lastInput).toMatchObject({ companyId: '22222222-2222-4222-8222-222222222222', page: 1 }));
    expect(screen.getByText('1–1 of 1')).toBeInTheDocument();
    expect(screen.getByText('Marcus Webb')).toBeInTheDocument();
  });

  it('a filtered zero-match is the table empty state, NOT the collection-empty one (AC-LRC-012)', () => {
    h.directory = [contacts[0]];
    renderPage('Admin', '/contacts?q=zzz');
    expect(screen.getByText(/No contacts match your filters/i)).toBeInTheDocument();
    expect(screen.queryByText(/No contacts yet/i)).not.toBeInTheDocument();
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

it('holds contact creation while ownership is unresolved', () => {
  ownershipMock.override = 'unknown';
  renderPage('Admin');
  expect(screen.queryByRole('button', { name: /New contact/i })).not.toBeInTheDocument();
  expect(screen.getByText(/checking ownership/i)).toBeInTheDocument();
});

describe('Contacts create form (AC-CRM-030)', () => {
  it('offers mapped companies for external contact creation', async () => {
    setTaskOwnership([{ domain: 'companies', externalTier: 'erpnext' }]);
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /New contact/i }));
    const company = screen.getByLabelText(/^Company/i, { selector: 'select' });
    expect(within(company).getByRole('option', { name: 'Cascade Port Authority' })).toBeInTheDocument();
    expect(within(company).queryByRole('option', { name: 'Steelforge Fabrication' })).not.toBeInTheDocument();
  });

  it('explains the mapping prerequisite before contact entry or import', () => {
    setTaskOwnership([{ domain: 'companies', externalTier: 'erpnext' }]);
    partyMappings.ids = [];
    renderPage('Admin');
    expect(screen.queryByRole('button', { name: /New contact/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Import/i })).not.toBeInTheDocument();
    expect(screen.getByText(/map.*company/i)).toBeInTheDocument();
  });

  it('AC-CRM-030: a valid create submits name + company to the mutation', async () => {
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /New contact/i }));
    await userEvent.type(screen.getByLabelText(/Full name/i), 'Nina Park');
    await userEvent.selectOptions(screen.getByLabelText(/^Company/i, { selector: 'input, select, textarea' }), '11111111-1111-4111-8111-111111111111');
    await userEvent.click(screen.getByRole('button', { name: /^Create contact$/i }));
    await waitFor(() =>
      expect(mutations.create.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ full_name: 'Nina Park', company_id: '11111111-1111-4111-8111-111111111111' }),
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
    await waitFor(() =>
      expect(screen.getByTestId('location-probe').dataset.pathname).toBe('/contacts/ct2'),
    );
  });

  it('CW-4b: the drawer-as-record overlay is gone — activating a row opens no dialog', async () => {
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: 'Open Jane Doe' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

// list-working-set-return (#683, AC-LRC-007): `company`/`q` round-trip through the URL, and
// opening a row stamps a validated Contacts return context onto the navigation's router state.
describe('Contacts index — list working set + return context (AC-LRC-007)', () => {
  it('AC-LRC-001: a direct URL with ?company= restores the selected filter and the narrowed rows', () => {
    renderPage('Admin', '/contacts?company=22222222-2222-4222-8222-222222222222');
    expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument();
    expect(screen.getByText('Marcus Webb')).toBeInTheDocument();
  });

  it('AC-LRC-001: choosing a company filter writes ?company= to the URL', async () => {
    renderPage('Admin');
    await selectCompanyFilter('Steelforge Fabrication');
    await waitFor(() =>
      expect(screen.getByTestId('location-probe').dataset.search).toBe(
        '?company=22222222-2222-4222-8222-222222222222',
      ),
    );
  });

  it('AC-LRC-001: typing a search term writes ?q= to the URL', async () => {
    renderPage('Admin');
    await userEvent.type(screen.getByLabelText(/Search contacts/i), 'marcus');
    await waitFor(() =>
      expect(screen.getByTestId('location-probe').dataset.search).toBe('?q=marcus'),
    );
  });

  it('AC-LRC-007: opening a row stamps a validated Contacts return context onto the navigation state', async () => {
    renderPage('Admin', '/contacts?company=22222222-2222-4222-8222-222222222222');
    await userEvent.click(screen.getByRole('button', { name: 'Open Marcus Webb' }));
    await waitFor(() => {
      const probe = screen.getByTestId('location-probe');
      expect(probe.dataset.pathname).toBe('/contacts/ct2');
      const state = JSON.parse(probe.textContent || 'null');
      expect(state.pmoListReturn).toMatchObject({
        list: 'contacts',
        path: '/contacts?company=22222222-2222-4222-8222-222222222222',
      });
    });
  });

  // Supporting case; AC-LRC-012's owning proof is pages/__tests__/listWorkingSet.emptyStates.test.tsx.
  it('a zero-match filtered result offers Clear filters, which restores the rows', async () => {
    renderPage('Admin');
    await userEvent.type(screen.getByLabelText(/Search contacts/i), 'no-such-contact');
    expect(await screen.findByText(/No contacts match your filters/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Clear filters/i }));
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('Marcus Webb')).toBeInTheDocument();
  });

  it('AC-LRC-001: an unavailable ?company= stays the active, clearable choice (control agrees with the URL)', async () => {
    const GONE = '99999999-9999-4999-8999-999999999999';
    renderPage('Admin', `/contacts?company=${GONE}`);
    // The control shows the URL's choice — never silently "All companies" while rows are narrowed.
    expect(screen.getByRole('combobox', { name: /Filter by company/i })).toHaveTextContent('Unavailable company');
    expect(screen.getByText(/No contacts match your filters/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Clear filters/i }));
    await waitFor(() => expect(screen.getByTestId('location-probe').dataset.search).toBe(''));
    expect(screen.getByRole('combobox', { name: /Filter by company/i })).toHaveTextContent('All companies');
    expect(screen.queryByText('Unavailable company')).not.toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('Contacts toolbar: company and search filters round-trip through the URL', async () => {
    renderPage('Admin', '/contacts');
    expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument();
    await selectCompanyFilter('Cascade Port Authority');
    await waitFor(() =>
      expect(screen.getByTestId('location-probe').dataset.search).toContain(
        'company=11111111-1111-4111-8111-111111111111',
      ),
    );
    await userEvent.type(screen.getByLabelText(/Search contacts/i), 'Jane');
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeInTheDocument();
    await waitFor(() => {
      const search = screen.getByTestId('location-probe').dataset.search;
      expect(search).toContain('company=11111111-1111-4111-8111-111111111111');
      expect(search).toContain('q=Jane');
    });
    await userEvent.click(screen.getByRole('button', { name: /Clear all/i }));
    await waitFor(() => expect(screen.getByTestId('location-probe').dataset.search).toBe(''));
  });

  it('FR-LRC-005: a return restores the captured scroll position only once the rows are ready', async () => {
    h.pending = true;
    const path = '/contacts?company=22222222-2222-4222-8222-222222222222';
    const entry = {
      pathname: '/contacts',
      search: '?company=22222222-2222-4222-8222-222222222222',
      state: { pmoListScrollRestore: { list: 'contacts', path, scrollTop: 300 } },
    };
    // A fresh element per render: re-rendering the SAME element would let React bail out.
    const tree = () => (
      <ToastProvider>
        <MemoryRouter initialEntries={[entry]}>
          <div className="main-scroll">
            <Contacts />
          </div>
        </MemoryRouter>
      </ToastProvider>
    );
    const { rerender } = render(tree());
    const main = sizeMainScroll();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(main.scrollTop).toBe(0);

    h.pending = false;
    rerender(tree());
    await waitFor(() => expect(main.scrollTop).toBe(300));
    expect(screen.getByText('Marcus Webb')).toBeInTheDocument();
  });
});

describe('Contacts row actions (AC-CRM-030)', () => {
  const openRowMenu = async (name: string) => {
    await userEvent.click(
      within(screen.getByText(name).closest('tr')!).getByRole('button', { name: /Row actions/i }),
    );
  };

  it('keeps mirrored fields read-only while allowing local contact details', async () => {
    setTaskOwnership([{ domain: 'companies', externalTier: 'erpnext' }]);
    renderPage('Admin');
    await openRowMenu('Jane Doe');
    expect(screen.queryByRole('menuitem', { name: /Delete/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: /Edit/i }));
    for (const label of [/Full name/i, /^Company/i, /^Email/i, /^Phone/i]) {
      expect(screen.getByLabelText(label, { selector: 'input, select, textarea' })).toBeDisabled();
    }
    expect(screen.getByLabelText(/^Title/i)).toBeEnabled();
    expect(screen.getByLabelText(/^Notes/i)).toBeEnabled();
    await userEvent.clear(screen.getByLabelText(/^Title/i));
    await userEvent.type(screen.getByLabelText(/^Title/i), 'Director');
    await userEvent.click(screen.getByRole('button', { name: /^Save contact$/i }));
    await waitFor(() => expect(mutations.update.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ full_name: 'Jane Doe', title: 'Director', email: 'jane@cascade.test' }) })));
  });

  it('preserves unsaved contact identity edits when ownership changes', async () => {
    renderPage('Admin');
    await openRowMenu('Jane Doe');
    await userEvent.click(screen.getByRole('menuitem', { name: /Edit/i }));
    const name = screen.getByLabelText(/Full name/i);
    await userEvent.clear(name);
    await userEvent.type(name, 'Jane Reyes');
    act(() => setTaskOwnership([{ domain: 'companies', externalTier: 'erpnext' }]));
    expect(screen.getByRole('button', { name: /^Save contact$/i })).toBeDisabled();
  });

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
    expect(screen.getByText(/hidden from the default list/i)).toBeInTheDocument();
    expect(screen.getByText(/Existing activity stays intact/i)).toBeInTheDocument();
    expect(screen.getByText(/You can restore them any time\./)).toBeInTheDocument();
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
    const toast = await findToastAnnouncement('alert', /don't have permission/i);
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
