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
// useCompaniesPage mock is a SERVER STUB: it mirrors the directory read's contract (type filter
// + search applied before the range, one pageSize window, exact total). The page is tested
// against what a conforming server sends — never against in-memory narrowing.
const h = vi.hoisted(() => ({
  directory: [] as Array<Record<string, unknown>>,
  pending: false,
  error: false,
  /** Overrides the stub's exact total (defaults to the filtered directory length). */
  totalOverride: null as number | null,
  /** The "of Y" the head-count query returns (null = the query has not answered). */
  allTotal: null as number | null,
  refetch: vi.fn(),
  lastInput: null as Record<string, unknown> | null,
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    setProjectNumberSegment: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
  },
}));

vi.mock('@/src/hooks/useDomainOwnershipMode', async () => await import('@/test/domainOwnershipMock'));

vi.mock('@/src/hooks/useCompanies', () => ({
  useCompaniesPage: (input: { type: string; search: string; page: number; pageSize: number }) => {
    h.lastInput = input;
    const q = input.search.trim().toLowerCase();
    const matching = h.directory.filter((c) => {
      const typeOk = input.type === 'All' || c.type === input.type;
      const searchOk = !q || String(c.name).toLowerCase().includes(q) || String(c.short_name ?? '').toLowerCase().includes(q);
      return typeOk && searchOk;
    });
    const start = (input.page - 1) * input.pageSize;
    return {
      data: h.error || h.pending
        ? null
        : { rows: matching.slice(start, start + input.pageSize), total: h.totalOverride ?? matching.length },
      isPending: h.pending,
      isError: h.error,
      isFetching: false,
      refetch: h.refetch,
    };
  },
  useCompaniesTotal: () => ({ data: h.allTotal, isPending: false, isError: false }),
  useCompaniesExportAll: () => ({ mutateAsync: vi.fn(async () => h.directory), isPending: false }),
  useCompanyMutations: () => h.mutations,
}));

// list-working-set-return (#683): the page now writes real router navigation for its `type`/`q`
// URL state and for record-open return context, so `react-router` stays UNMOCKED here — a
// LocationProbe sibling (below) reads the real `useLocation()` to assert the resulting URL/state.

// usePermission reads the REAL JWT role from the impersonation context.
let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import Companies from './Companies';
import { ownershipMock } from '@/test/domainOwnershipMock';
import { clearOwnershipCache, setTaskOwnership } from '@/src/lib/adapterSeam/ownershipCache';

const seed = [
  { id: 'c1', name: 'Cascade Port Authority', type: 'Client', org_id: 'org-1', client_number_segment: 'RIS', archived_at: null, created_at: '2026-01-01T00:00:00Z' },
  { id: 'c2', name: 'Steelforge Fabrication', type: 'Vendor', org_id: 'org-1', archived_at: null, created_at: '2026-02-01T00:00:00Z' },
  { id: 'c3', name: 'Internal Holdings', type: 'Internal', org_id: 'org-1', archived_at: null, created_at: '2026-03-01T00:00:00Z' },
];
const mutations = h.mutations;

// list-working-set-return (#683): reads the REAL router location so tests can assert the URL
// (filter/search round-trip) and the record-open return-context `location.state` without mocking
// navigation away.
const LocationProbe: React.FC = () => {
  const location = useLocation();
  return (
    <div
      data-testid="location-probe"
      data-pathname={location.pathname}
      data-search={location.search}
      data-hash={location.hash}
    >
      {JSON.stringify(location.state ?? null)}
    </div>
  );
};

const renderPage = (role: Role = 'Admin', initialPath = '/companies') => {
  realRole = role;
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <LocationProbe />
        <Companies />
      </MemoryRouter>
    </ToastProvider>,
  );
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

beforeEach(() => {
  h.directory = [...seed];
  h.pending = false;
  h.error = false;
  h.totalOverride = null;
  h.allTotal = null;
  h.refetch.mockClear();
  h.lastInput = null;
  Object.values(mutations).forEach((m) => {
    m.mutateAsync.mockReset();
    m.mutateAsync.mockResolvedValue(undefined);
    m.isPending = false;
  });
  realRole = 'Admin';
  ownershipMock.override = null;
  ownershipMock.retry.mockClear();
  clearOwnershipCache();
});

describe('Companies index — shared ListPage shell (CW-5)', () => {
  it('renders on the shared ListPage shell: header + canonical toolbar', () => {
    renderPage();
    expect(screen.getByTestId('list-page-header')).toBeInTheDocument();
    expect(screen.getByTestId('list-page-toolbar')).toBeInTheDocument();
    // the page title lives in the shell header
    expect(within(screen.getByTestId('list-page-header')).getByRole('heading', { name: 'Companies' })).toBeInTheDocument();
  });
});

describe('Companies index — rows + filters (AC-CO-001)', () => {
  it('AC-CO-001: renders seeded company rows with name + type', () => {
    renderPage();
    expect(screen.getByText('Cascade Port Authority')).toBeInTheDocument();
    expect(screen.getByText('Steelforge Fabrication')).toBeInTheDocument();
    // type pill rendered
    expect(screen.getAllByText('Client').length).toBeGreaterThan(0);
  });

  it('AC-CO-001: the type filter narrows the visible rows — by asking the SERVER for that type', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /^Supplier$/ }));
    // the page passes the URL filter to the server page read…
    await waitFor(() => expect(h.lastInput).toMatchObject({ type: 'Vendor' }));
    // …and renders exactly the rows that read returns (the searched-out type stays out).
    await waitFor(() => expect(screen.queryByText('Cascade Port Authority')).not.toBeInTheDocument());
    expect(screen.getByText('Steelforge Fabrication')).toBeInTheDocument();
  });

  it('AC-CO-001: search filters rows by name — the committed term goes to the server', async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText(/Search companies/i), 'steel');
    await waitFor(() => expect(h.lastInput).toMatchObject({ search: 'steel' }));
    await waitFor(() => expect(screen.queryByText('Cascade Port Authority')).not.toBeInTheDocument());
    expect(screen.getByText('Steelforge Fabrication')).toBeInTheDocument();
  });

  it('AC-CO-001: company_type pills are the category family (Client violet dot+label; never the action-blue)', () => {
    renderPage();
    // The Type column pill is the closest pill ancestor of the type label inside its row.
    const pillEl = (label: string, rowName: string) => {
      const row = screen.getByText(rowName).closest('tr')!;
      return within(row).getByText(label).closest('span')!;
    };
    const client = pillEl('Client', 'Cascade Port Authority'); // categorical violet (highlighted)
    const vendor = pillEl('Supplier', 'Steelforge Fabrication'); // neutral grey
    const internal = pillEl('Internal', 'Internal Holdings'); // neutral grey
    // S1 (ADR-0068) as amended 2026-10-29 (decorative dot ban): status is a quiet
    // AA label on its paired pale surface — NO filled slab, no leading dot. The
    // category family is `violet` for the highlighted kind (Client) + `neutral`
    // for the rest; identity comes from the label token + the label word.
    expect(client.className).not.toMatch(/\bbg-(violet|primary|secondary)\b/);
    expect(client.getAttribute('style') ?? '').toContain('--status-violet-text');
    // vendor/internal are the quiet neutral grey (muted label on the neutral surface)
    expect(vendor.className).toContain('text-count-foreground');
    expect(internal.className).toContain('text-count-foreground');
    // Freed-Blue Status Rule (CW-2): a TYPE pill never uses the action-blue.
    expect(client.className).not.toContain('bg-primary');
    expect(vendor.className).not.toContain('bg-primary');
    expect(internal.className).not.toContain('bg-primary');
    // The label (Client / Supplier / Internal) carries identity — never colour-only:
    // each type pill renders its name inside its own row.
    expect(within(screen.getByText('Cascade Port Authority').closest('tr')!).getByText('Client')).toBeInTheDocument();
    expect(within(screen.getByText('Steelforge Fabrication').closest('tr')!).getByText('Supplier')).toBeInTheDocument();
    expect(within(screen.getByText('Internal Holdings').closest('tr')!).getByText('Internal')).toBeInTheDocument();
  });
});

describe('Companies index — states', () => {
  it('AC-CO-001: loading skeleton while pending', () => {
    h.pending = true;
    renderPage();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  });

  it('AC-CO-001: error state with retry', async () => {
    h.error = true;
    renderPage();
    const retry = screen.getByRole('button', { name: /Retry/i });
    await userEvent.click(retry);
    expect(h.refetch).toHaveBeenCalled();
  });

  it('AC-CO-001: empty state teaches with a gated New company action', () => {
    h.directory = [];
    renderPage('Admin');
    expect(screen.getByText(/No companies yet/i)).toBeInTheDocument();
  });

  it('AC-CO-001: a filtered zero-match is the table empty state, NOT the collection-empty one (AC-LRC-012)', () => {
    h.directory = [seed[0]];
    renderPage('Admin', '/companies?q=zzz');
    expect(screen.getByText(/No companies match your filters/i)).toBeInTheDocument();
    expect(screen.queryByText(/No companies yet/i)).not.toBeInTheDocument();
  });
});

describe('Companies index — server paging (#1989)', () => {
  const bigDirectory = [
    ...seed,
    ...Array.from({ length: 57 }, (_, i) => ({
      id: `c-bulk-${i}`,
      name: `Bulk Co ${String(i + 1).padStart(2, '0')}`,
      type: 'Client',
      org_id: 'org-1',
      archived_at: null,
    })),
  ];

  it('renders ONE page of rows and the pager range, with a working Next page', async () => {
    h.directory = bigDirectory;
    renderPage();
    // page 1 window: 50 of the 60 matching rows
    expect(screen.getByText('Cascade Port Authority')).toBeInTheDocument();
    expect(screen.getByText('Bulk Co 47')).toBeInTheDocument();
    expect(screen.queryByText('Bulk Co 51')).not.toBeInTheDocument();
    expect(screen.getByText('1–50 of 60')).toBeInTheDocument();
    const next = screen.getByRole('button', { name: /Next page/i });
    expect(next).toBeEnabled();
    await userEvent.click(next);
    await waitFor(() => expect(screen.getByText('Bulk Co 51')).toBeInTheDocument());
    expect(h.lastInput).toMatchObject({ page: 2 });
    expect(screen.getByText('51–60 of 60')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next page/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Previous page/i })).toBeEnabled();
  });

  it('a filter/search change lands on page 1 of the new result set', async () => {
    h.directory = bigDirectory;
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Next page/i }));
    await waitFor(() => expect(screen.getByText('51–60 of 60')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('tab', { name: /^Supplier$/ }));
    // the vendor set is small — page 1 of it, not page 2 of the old result set
    await waitFor(() => expect(h.lastInput).toMatchObject({ type: 'Vendor', page: 1 }));
    expect(screen.getByText('1–1 of 1')).toBeInTheDocument();
    expect(screen.getByText('Steelforge Fabrication')).toBeInTheDocument();
  });

  it('"Showing X of Y" compares the filtered total against the whole directory', async () => {
    h.directory = bigDirectory;
    h.allTotal = 60;
    renderPage();
    // unfiltered: count === directory total → the bare count, no "Showing" split
    expect(screen.getByTestId('list-page-count')).toHaveTextContent('60');
    await userEvent.click(screen.getByRole('tab', { name: /^Supplier$/ }));
    await waitFor(() => expect(screen.getByTestId('list-page-count')).toHaveTextContent('Showing 1 of 60'));
  });

  it('an out-of-range page corrects down instead of showing an empty page as truth', async () => {
    h.directory = bigDirectory;
    const tree = () => (
      <ToastProvider>
        <MemoryRouter initialEntries={['/companies?q=bulk']}>
          <Companies />
        </MemoryRouter>
      </ToastProvider>
    );
    const view = render(tree());
    await waitFor(() => expect(screen.getByText('1–50 of 57')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Next page/i }));
    await waitFor(() => expect(screen.getByText('51–57 of 57')).toBeInTheDocument());
    // the directory shrinks under the user (rows deleted elsewhere): the page read now comes
    // back EMPTY on page 2 with total 1 — an empty page-N is corrected down, never shown as truth.
    h.directory = [seed[0]];
    h.totalOverride = 1;
    view.rerender(tree());
    await waitFor(() => expect(h.lastInput).toMatchObject({ page: 1 }));
    await waitFor(() => expect(screen.getByText('1–1 of 1')).toBeInTheDocument());
  });
});

describe('Companies index — RBAC affordance gating (AC-CO-007)', () => {
  it('AC-CO-007: Admin sees New company + Edit + Archive + Delete', async () => {
    renderPage('Admin');
    expect(screen.getByRole('button', { name: /New company/i })).toBeInTheDocument();
    await userEvent.click(within(screen.getByText('Cascade Port Authority').closest('tr')!).getByRole('button', { name: /Row actions/i }));
    expect(screen.getByRole('menuitem', { name: /Edit/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Archive/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument();
  });

  it('AC-CO-007: PM sees New company + Edit but NOT Archive or Delete', async () => {
    renderPage('Project Manager');
    expect(screen.getByRole('button', { name: /New company/i })).toBeInTheDocument();
    await userEvent.click(within(screen.getByText('Cascade Port Authority').closest('tr')!).getByRole('button', { name: /Row actions/i }));
    expect(screen.getByRole('menuitem', { name: /Edit/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Archive/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Delete/i })).not.toBeInTheDocument();
  });

  it('AC-CO-007: Finance sees New company + Edit (master data write set incl. Finance)', () => {
    renderPage('Finance');
    expect(screen.getByRole('button', { name: /New company/i })).toBeInTheDocument();
  });

  it('AC-CO-007: Engineer is read-only — no New company and no row action menu', () => {
    renderPage('Engineer');
    expect(screen.queryByRole('button', { name: /New company/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Row actions/i })).not.toBeInTheDocument();
  });
});

describe('Companies index — customer collections doorway (AC-S36-005)', () => {
  it('AC-S36-005: opens a Client record through its existing canonical detail doorway', async () => {
    renderPage('Finance');
    await userEvent.click(screen.getByRole('button', { name: 'Open Cascade Port Authority' }));

    const location = screen.getByTestId('location-probe');
    expect(location).toHaveAttribute('data-pathname', '/companies/c1');
    expect(location).toHaveAttribute('data-hash', '');
  });
});

describe('Companies create / edit form (AC-CO-003 / AC-CO-004)', () => {
  it('AC-CO-003: New company opens the modal; a blank required name keeps submit disabled (F8 readiness)', async () => {
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /New company/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // F8 (AC-IXD-FORM-F8): the blank required name disables submit — the user cannot
    // silently submit a blank form, and no create mutation fires.
    const submit = screen.getByRole('button', { name: /^Create company$/i });
    expect(submit).toBeDisabled();
    await userEvent.click(submit);
    expect(mutations.create.mutateAsync).not.toHaveBeenCalled();
  });

  it('AC-CO-003: a valid create submits name + type to the mutation', async () => {
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /New company/i }));
    await userEvent.type(screen.getByLabelText(/Company name/i), 'Westvale Logistics');
    await userEvent.selectOptions(screen.getByLabelText(/^Type/i, { selector: 'input, select, textarea' }), 'Vendor');
    await userEvent.click(screen.getByRole('button', { name: /^Create company$/i }));
    await waitFor(() =>
      expect(mutations.create.mutateAsync).toHaveBeenCalledWith({ name: 'Westvale Logistics', type: 'Vendor' }),
    );
  });

  it('AC-CO-003: a create rejected by RLS (42501) surfaces a classified warning toast', async () => {
    mutations.create.mutateAsync.mockRejectedValue(new AppError('not permitted', '42501'));
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /New company/i }));
    await userEvent.type(screen.getByLabelText(/Company name/i), 'Blocked Co');
    await userEvent.click(screen.getByRole('button', { name: /^Create company$/i }));
    const toast = await findToastAnnouncement('alert', /don't have permission/i);
    expect(toast).toHaveTextContent(/don't have permission/i);
  });

  it('AC-CO-004: Edit pre-fills the row and submits an update', async () => {
    renderPage('Admin');
    await userEvent.click(within(screen.getByText('Cascade Port Authority').closest('tr')!).getByRole('button', { name: /Row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Edit/i }));
    const nameInput = screen.getByLabelText(/Company name/i) as HTMLInputElement;
    const segmentInput = screen.getByLabelText(/Client number segment/i) as HTMLInputElement;
    expect(nameInput.value).toBe('Cascade Port Authority');
    expect(segmentInput.value).toBe('RIS');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Cascade Port Co');
    await userEvent.clear(segmentInput);
    await userEvent.type(segmentInput, ' RIS-2 ');
    await userEvent.click(screen.getByRole('button', { name: /^Save company$/i }));
    await waitFor(() =>
      expect(mutations.update.mutateAsync).toHaveBeenCalledWith({
        id: 'c1',
        input: { name: 'Cascade Port Co', type: 'Client' },
      }),
    );
    await waitFor(() => expect(mutations.setProjectNumberSegment.mutateAsync).toHaveBeenCalledWith({ id: 'c1', segment: 'RIS-2' }));
    expect(mutations.update.mutateAsync).toHaveBeenCalledWith({ id: 'c1', input: { name: 'Cascade Port Co', type: 'Client' } });
  });
});

describe('Companies archive (AC-CO-005)', () => {
  it('AC-CO-005: Archive routes through a confirm and calls the mutation', async () => {
    renderPage('Admin');
    await userEvent.click(within(screen.getByText('Steelforge Fabrication').closest('tr')!).getByRole('button', { name: /Row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Archive/i }));
    // confirm dialog appears; mutation not yet called
    expect(mutations.archive.mutateAsync).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Archive company/i }));
    await waitFor(() => expect(mutations.archive.mutateAsync).toHaveBeenCalledWith('c2'));
  });
});

describe('Companies delete (AC-CO-006)', () => {
  it('AC-CO-006: Delete routes through a destructive confirm and calls the mutation', async () => {
    renderPage('Admin');
    await userEvent.click(within(screen.getByText('Steelforge Fabrication').closest('tr')!).getByRole('button', { name: /Row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Delete/i }));
    await userEvent.click(screen.getByRole('button', { name: /Delete company/i }));
    await waitFor(() => expect(mutations.remove.mutateAsync).toHaveBeenCalledWith('c2'));
  });

  it('AC-CO-006: an in-use (23503) delete surfaces a warning toast advising Archive instead', async () => {
    mutations.remove.mutateAsync.mockRejectedValue(new AppError('foreign key violation', '23503'));
    renderPage('Admin');
    await userEvent.click(within(screen.getByText('Cascade Port Authority').closest('tr')!).getByRole('button', { name: /Row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Delete/i }));
    await userEvent.click(screen.getByRole('button', { name: /Delete company/i }));
    // the in-use message is surfaced via a warning toast (centralized "Still in use" headline,
    // ADR-0017) advising Archive instead
    const toast = await findToastAnnouncement('alert', /Still in use/i);
    expect(toast).toHaveTextContent(/Still in use/i);
    expect(toast).toHaveTextContent(/Archive it instead/i);
  });

  it('AC-CO-006: an in-use (23503) delete renders an inline GateNotice naming the company + an Archive-instead recovery path', async () => {
    mutations.remove.mutateAsync.mockRejectedValue(new AppError('foreign key violation', '23503'));
    renderPage('Admin');
    await userEvent.click(within(screen.getByText('Cascade Port Authority').closest('tr')!).getByRole('button', { name: /Row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Delete/i }));
    await userEvent.click(screen.getByRole('button', { name: /Delete company/i }));
    // The inline GateNotice (block-delete-if-referenced) names the company and offers recovery.
    const gate = await screen.findByTestId('company-delete-gate');
    expect(gate).toHaveTextContent(/Cascade Port Authority/);
    expect(gate).toHaveTextContent(/referenced/i);
    // "Archive instead" opens the archive confirm for that same company (no second click needed).
    await userEvent.click(within(gate).getByRole('button', { name: /Archive instead/i }));
    expect(
      screen.getByRole('button', { name: /Archive company/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Archive Cascade Port Authority\?/i)).toBeInTheDocument();
    // Confirming the archive runs the archive mutation for that company.
    await userEvent.click(screen.getByRole('button', { name: /Archive company/i }));
    await waitFor(() => expect(mutations.archive.mutateAsync).toHaveBeenCalledWith('c1'));
  });
});

// CW-4b: the drawer-as-record is retired — a row now NAVIGATES to the routable
// `/companies/:id` record page (the page's own anatomy + the Contacts section are covered by
// CompanyDetail.test.tsx). The journey's goal — "open this company's record" — is intact; the
// destination changed from an in-page overlay to a URL.
describe('Companies index — row → detail navigation (CW-4b)', () => {
  it('CW-4b: activating a row navigates to the routable /companies/:id page', async () => {
    renderPage('Admin');
    // Row activation = the first-cell <button> (rowLabel "Open <name>").
    expect(screen.getByRole('button', { name: 'Open Steelforge Fabrication' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open Steelforge Fabrication' }));
    await waitFor(() =>
      expect(screen.getByTestId('location-probe').dataset.pathname).toBe('/companies/c2'),
    );
  });

  it('CW-4b: the drawer-as-record overlay is gone — activating a row opens no dialog', async () => {
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: 'Open Cascade Port Authority' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

// list-working-set-return (#683, AC-LRC-006): `type`/`q` round-trip through the URL, and opening a
// row stamps a validated Companies return context (list + path + no scroll element in jsdom) onto
// the navigation's router state — the seam CompanyDetail's BackBar/breadcrumb read on return.
describe('Companies index — list working set + return context (AC-LRC-006)', () => {
  it('AC-LRC-001: a direct URL with ?type= restores the selected filter and the narrowed rows', () => {
    renderPage('Admin', '/companies?type=Vendor');
    expect(screen.getByRole('tab', { name: /^Supplier$/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('Cascade Port Authority')).not.toBeInTheDocument();
    expect(screen.getByText('Steelforge Fabrication')).toBeInTheDocument();
  });

  it('AC-LRC-001: choosing a type filter writes ?type= to the URL (a copied link reproduces the same set)', async () => {
    renderPage('Admin');
    await userEvent.click(screen.getByRole('tab', { name: /^Supplier$/ }));
    await waitFor(() =>
      expect(screen.getByTestId('location-probe').dataset.search).toBe('?type=Vendor'),
    );
  });

  it('AC-LRC-001: typing a search term writes ?q= to the URL', async () => {
    renderPage('Admin');
    await userEvent.type(screen.getByLabelText(/Search companies/i), 'steel');
    await waitFor(() =>
      expect(screen.getByTestId('location-probe').dataset.search).toBe('?q=steel'),
    );
  });

  it('AC-LRC-006: opening a row stamps a validated Companies return context onto the navigation state', async () => {
    renderPage('Admin', '/companies?type=Vendor');
    await userEvent.click(screen.getByRole('button', { name: 'Open Steelforge Fabrication' }));
    await waitFor(() => {
      const probe = screen.getByTestId('location-probe');
      expect(probe.dataset.pathname).toBe('/companies/c2');
      const state = JSON.parse(probe.textContent || 'null');
      expect(state.pmoListReturn).toMatchObject({ list: 'companies', path: '/companies?type=Vendor' });
    });
  });

  // Supporting case; AC-LRC-012's owning proof is pages/__tests__/listWorkingSet.emptyStates.test.tsx.
  it('a zero-match filtered result offers Clear filters, which restores the rows', async () => {
    renderPage('Admin');
    await userEvent.type(screen.getByLabelText(/Search companies/i), 'no-such-company');
    expect(await screen.findByText(/No companies match your filters/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Clear filters/i }));
    expect(screen.getByText('Steelforge Fabrication')).toBeInTheDocument();
    expect(screen.getByText('Cascade Port Authority')).toBeInTheDocument();
    expect(screen.getByText('Internal Holdings')).toBeInTheDocument();
  });

  it('FR-LRC-005: a return restores the captured scroll position only once the rows are ready', async () => {
    h.pending = true;
    const entry = {
      pathname: '/companies',
      search: '?type=Vendor',
      state: { pmoListScrollRestore: { list: 'companies', path: '/companies?type=Vendor', scrollTop: 300 } },
    };
    // A fresh element per render: re-rendering the SAME element would let React bail out.
    const tree = () => (
      <ToastProvider>
        <MemoryRouter initialEntries={[entry]}>
          <div className="main-scroll">
            <Companies />
          </div>
        </MemoryRouter>
      </ToastProvider>
    );
    const { rerender } = render(tree());
    const main = sizeMainScroll();

    // Still loading: the restore must wait — scrolling a list before its rows exist is a no-op.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(main.scrollTop).toBe(0);

    h.pending = false;
    rerender(tree());
    await waitFor(() => expect(main.scrollTop).toBe(300));
    expect(screen.getByText('Steelforge Fabrication')).toBeInTheDocument();
  });
});


describe('company short names', () => {
  it('AC-NICK-001: lists prefer the short name and search matches short and legal names', async () => {
    h.directory = [{ ...seed[0], short_name: 'Example' }, seed[1]];
    renderPage();
    expect(screen.getByText('Example')).toBeInTheDocument();
    expect(screen.getByText(seed[1].name)).toBeInTheDocument();
    const search = screen.getByLabelText(/Search companies/i);
    await userEvent.type(search, 'cascade');
    expect(screen.getByText('Example')).toBeInTheDocument();
    expect(screen.queryByText(seed[1].name)).not.toBeInTheDocument();
    await userEvent.clear(search);
    await userEvent.type(search, 'example');
    expect(screen.getByText('Example')).toBeInTheDocument();
  });

  it('externally-owned legal name stays disabled while the short name can be saved', async () => {
    setTaskOwnership([{ domain: 'companies', externalTier: 'erpnext' }]);
    renderPage();
    await userEvent.click(within(screen.getByText(seed[0].name).closest('tr')!).getByRole('button', { name: /Row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Edit/i }));
    expect(screen.getByLabelText(/Company name/i)).toBeDisabled();
    expect(screen.getByLabelText(/^Type/i, { selector: 'input, select, textarea' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Short name/i), 'Example');
    await userEvent.click(screen.getByRole('button', { name: /^Save company$/i }));
    await waitFor(() => expect(mutations.update.mutateAsync).toHaveBeenCalledWith({ id: seed[0].id, input: { name: seed[0].name, type: 'Client', short_name: 'Example' } }));
  });
  it('preserves the stored legal name when saving an external company nickname', async () => {
    setTaskOwnership([{ domain: 'companies', externalTier: 'erpnext' }]);
    const original = { ...seed[0], name: `  ${seed[0].name}  ` };
    h.directory = [original];
    renderPage();
    await userEvent.click(within(screen.getByText(seed[0].name).closest('tr')!).getByRole('button', { name: /Row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Edit/i }));
    await userEvent.type(screen.getByLabelText(/Short name/i), 'Example');
    await userEvent.click(screen.getByRole('button', { name: /^Save company$/i }));
    await waitFor(() => expect(mutations.update.mutateAsync).toHaveBeenCalledWith({ id: original.id, input: { name: original.name, type: 'Client', short_name: 'Example' } }));
  });
});


it('standalone company creation persists a trimmed optional nickname', async () => {
  renderPage();
  await userEvent.click(screen.getByRole('button', { name: /New company/i }));
  await userEvent.type(screen.getByLabelText(/Company name/i), 'Example Legal Company');
  await userEvent.type(screen.getByLabelText(/Short name/i), ' Example ');
  await userEvent.click(screen.getByRole('button', { name: /^Create company$/i }));
  await waitFor(() => expect(mutations.create.mutateAsync).toHaveBeenCalledWith({ name: 'Example Legal Company', type: 'Client', short_name: 'Example' }));
});

describe('company ownership actions', () => {
  it('keeps an Internal company editable without offering a type conversion under external ownership', async () => {
    setTaskOwnership([{ domain: 'companies', externalTier: 'erpnext' }]);
    renderPage();
    await userEvent.click(within(screen.getByText('Internal Holdings').closest('tr')!).getByRole('button', { name: /Row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Edit/i }));
    expect(screen.getByLabelText(/Company name/i)).toBeEnabled();
    expect(screen.getByLabelText(/^Type/i, { selector: 'input, select, textarea' })).toBeDisabled();
  });
  it('holds a pending type conversion if ownership changes while editing', async () => {
    renderPage();
    await userEvent.click(within(screen.getByText('Internal Holdings').closest('tr')!).getByRole('button', { name: /Row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Edit/i }));
    await userEvent.selectOptions(screen.getByLabelText(/^Type/i, { selector: 'input, select, textarea' }), 'Vendor');
    act(() => setTaskOwnership([{ domain: 'companies', externalTier: 'erpnext' }]));
    expect(screen.getByRole('button', { name: /^save company$/i })).toBeDisabled();
  });
  it('holds a pending legal-name edit if ownership changes while editing', async () => {
    renderPage();
    await userEvent.click(within(screen.getByText(seed[0].name).closest('tr')!).getByRole('button', { name: /Row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Edit/i }));
    await userEvent.type(screen.getByLabelText(/Company name/i), ' Revised');
    act(() => setTaskOwnership([{ domain: 'companies', externalTier: 'erpnext' }]));
    expect(screen.getByRole('button', { name: /^save company$/i })).toBeDisabled();
  });
  it('holds company actions while ownership is unresolved', () => {
    ownershipMock.override = 'unknown';
    renderPage();
    expect(screen.queryByRole('button', { name: /new company/i })).not.toBeInTheDocument();
    expect(screen.getByText(/checking ownership/i)).toBeInTheDocument();
  });

  it('offers a retry after ownership fails', async () => {
    ownershipMock.override = 'error';
    renderPage();
    expect(screen.queryByRole('button', { name: /new company/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^retry$/i }));
    expect(ownershipMock.retry).toHaveBeenCalled();
  });

  it('offers Internal for native company creation', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /New company/i }));
    const type = within(screen.getByRole('dialog')).getByLabelText(/^Type/);
    expect(within(type).getByRole('option', { name: 'Internal' })).toBeInTheDocument();
  });

  it('updates create choices when company ownership changes', async () => {
    setTaskOwnership([]);
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /New company/i }));
    const type = within(screen.getByRole('dialog')).getByLabelText(/^Type/);
    expect(within(type).getByRole('option', { name: 'Internal' })).toBeInTheDocument();
    act(() => setTaskOwnership([{ domain: 'companies', externalTier: 'erpnext' }]));
    expect(within(type).queryByRole('option', { name: 'Internal' })).not.toBeInTheDocument();
  });

  it('offers only supported party types when creating under external ownership', async () => {
    setTaskOwnership([{ domain: 'companies', externalTier: 'erpnext' }]);
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /New company/i }));
    const type = within(screen.getByRole('dialog')).getByLabelText(/^Type/);
    expect(within(type).queryByRole('option', { name: 'Internal' })).not.toBeInTheDocument();
    expect(within(type).getByRole('option', { name: 'Client' })).toBeInTheDocument();
    expect(within(type).getByRole('option', { name: 'Supplier' })).toBeInTheDocument();
  });
});

it('keeps external companies from offering deletion', async () => {
  setTaskOwnership([{ domain: 'companies', externalTier: 'erpnext' }]);
  renderPage();
  const row = screen.getByText('Cascade Port Authority').closest('tr')!;
  await userEvent.click(within(row).getByRole('button', { name: /row actions/i }));
  expect(screen.queryByRole('menuitem', { name: /delete/i })).not.toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: /archive/i })).toBeInTheDocument();
  expect(screen.getByText(/records managed in ERP can be archived/i)).toBeInTheDocument();
});
