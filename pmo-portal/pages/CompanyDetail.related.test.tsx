import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import type { ErpAgingSnapshotRow } from '@/src/lib/db/erpSnapshots';
import type { CompanyCollectionsHookResult } from '@/src/hooks/useCompanyCollections';

/**
 * AC-IFW-COMPANY-01 — CompanyDetail renders related projects (always) and
 * related procurement (Vendor-only) as clickable links. The procurement card is
 * absent for a Client company.
 *
 * Lens-D regression invariant: CompanyDetail renders a related-projects list
 * with project links, and for a Vendor a related-procurement list with PR links.
 */

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const {
  detailState,
  mutations,
  contactsState,
  projectsState,
  procurementsState,
} = vi.hoisted(() => ({
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
  projectsState: {
    data: [] as Record<string, unknown>[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  procurementsState: {
    data: [] as Record<string, unknown>[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));
const collectionsHook = vi.hoisted(() => ({ useCompanyCollections: vi.fn() }));

vi.mock('@/src/hooks/useCompanies', () => ({
  useCompany: () => detailState,
  useCompanyMutations: () => mutations,
  useProjectsByClient: () => projectsState,
  useProcurementsByVendor: () => procurementsState,
}));
vi.mock('@/src/hooks/useContacts', () => ({
  useContactsByCompany: () => contactsState,
  // T17/T14: account-level hooks — default to empty/idle so existing tests are unaffected.
  useCompanyActivities: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useContactMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    logActivity: { mutateAsync: vi.fn(), isPending: false },
    updateActivity: { mutateAsync: vi.fn(), isPending: false },
    deleteActivity: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/hooks/useCompanyCollections', () => ({
  useCompanyCollections: collectionsHook.useCompanyCollections,
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import CompanyDetail from './CompanyDetail';

const clientCompany = {
  id: 'co-client-1',
  org_id: 'org-1',
  name: 'Meridian Steelworks',
  type: 'Client' as const,
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
};

const vendorCompany = {
  id: 'co-vendor-1',
  org_id: 'org-1',
  name: 'SunVolt Modules Co.',
  type: 'Vendor' as const,
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
};

const customerPosition: ErpAgingSnapshotRow = {
  party: 'Customer:C-0001',
  partyType: 'Customer',
  currency: 'USD',
  totalOutstanding: 250,
  current: 0,
  bucket0to30: 250,
  bucket31to60: 0,
  bucket61to90: 0,
  bucketOver90: 0,
  rangeLabels: { b_0_30: '0–30 days' },
  reportDate: '2026-10-18',
  ageingBasedOn: 'Due Date',
  asOf: '2026-10-18T00:00:00Z',
  sourceReport: 'Accounts Receivable',
  reportVersion: '15',
  snapshotId: 'snapshot-1',
};

const collectionsResult = (
  state: 'known' | 'unavailable' | 'ambiguous',
  positions: ErpAgingSnapshotRow[] = [],
): CompanyCollectionsHookResult => ({
  rows: positions,
  refsBySnapshotCustomer: [],
  byCompany: new Map([['co-client-1', { state, positions }]]),
  customerLinks: new Map(),
  isEnabled: true,
  isPending: false,
  isError: false,
  error: null,
  refetch: vi.fn(async () => undefined),
});

const renderPage = (companyId: string = 'co-client-1') => {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/companies/${companyId}`]}>
        <Routes>
          <Route path="/companies/:companyId" element={<CompanyDetail />} />
          <Route path="/companies" element={<div>Companies index</div>} />
          <Route path="/projects/:id" element={<div>Project page</div>} />
          <Route path="/procurement/:id" element={<div>Procurement page</div>} />
          <Route path="/contacts/:contactId" element={<div>Contact page</div>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
};

beforeEach(() => {
  detailState.data = clientCompany;
  detailState.isPending = false;
  detailState.isError = false;
  contactsState.data = [];
  contactsState.isPending = false;
  projectsState.data = [];
  projectsState.isPending = false;
  projectsState.isError = false;
  projectsState.refetch.mockClear();
  procurementsState.data = [];
  procurementsState.isPending = false;
  procurementsState.isError = false;
  procurementsState.refetch.mockClear();
  mutations.update.mutateAsync.mockClear().mockResolvedValue(undefined);
  mutations.archive.mutateAsync.mockClear().mockResolvedValue(undefined);
  realRole = 'Admin';
  collectionsHook.useCompanyCollections.mockReset();
  collectionsHook.useCompanyCollections.mockReturnValue(collectionsResult('unavailable'));
});

describe('CompanyDetail — related objects (AC-IFW-COMPANY-01)', () => {
  it('AC-IFW-COMPANY-01: renders a "Related projects" card for a Client company', () => {
    renderPage('co-client-1');
    // The section title is a semantic CardHead heading; the list's accessible label may also match.
    const headings = screen.getAllByText(/related projects/i);
    expect(headings.length).toBeGreaterThan(0);
  });

  it('AC-IFW-COMPANY-01: lists related project as a link to /projects/:id', () => {
    projectsState.data = [
      {
        id: 'p-1',
        name: 'Meridian Solar Phase 1',
        status: 'Ongoing Project',
        client: { name: 'Meridian Steelworks' },
        pm: { full_name: 'Diego PM' },
      },
    ];
    renderPage('co-client-1');
    const link = screen.getByRole('link', { name: /Meridian Solar Phase 1/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/projects/p-1');
  });

  it('AC-IFW-COMPANY-01: shows empty state when no related projects', () => {
    projectsState.data = [];
    renderPage('co-client-1');
    expect(screen.getByText(/no related projects yet/i)).toBeInTheDocument();
  });

  it('AC-IFW-COMPANY-01: procurement card is ABSENT for a Client company', () => {
    detailState.data = clientCompany;
    renderPage('co-client-1');
    expect(screen.queryByText(/procurement/i)).not.toBeInTheDocument();
  });

  it('AC-IFW-COMPANY-01: renders a "Procurement" card for a Vendor company', () => {
    detailState.data = vendorCompany;
    renderPage('co-vendor-1');
    expect(screen.getByText(/^Procurement$/i)).toBeInTheDocument();
  });

  it('AC-IFW-COMPANY-01: lists vendor procurement as a link to /procurement/:id', () => {
    detailState.data = vendorCompany;
    procurementsState.data = [
      {
        id: 'pr-1',
        title: 'PV Module Supply',
        status: 'Ordered',
        total_value: 120000,
        vendor_id: 'co-vendor-1',
        project: { name: 'Meridian Solar Phase 1', code: 'SP-2401' },
        vendor: { name: 'SunVolt Modules Co.' },
        requested_by: { full_name: 'Diego PM' },
      },
    ];
    renderPage('co-vendor-1');
    const link = screen.getByRole('link', { name: /PV Module Supply/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/procurement/pr-1');
  });

  it('AC-IFW-COMPANY-01: shows empty state when no vendor procurement', () => {
    detailState.data = vendorCompany;
    procurementsState.data = [];
    renderPage('co-vendor-1');
    expect(screen.getByText(/no procurement yet/i)).toBeInTheDocument();
  });
});

describe('CompanyDetail — customer collections (AC-S36-003)', () => {
  it('AC-S36-002: follows the collections hash to the section and focuses its heading', async () => {
    const scrollIntoView = vi.fn();
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });

    try {
      render(
        <ToastProvider>
          <MemoryRouter initialEntries={['/companies/co-client-1#collections']}>
            <Routes>
              <Route path="/companies/:companyId" element={<CompanyDetail />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>,
      );

      const heading = screen.getByRole('heading', { name: 'Customer collections' });
      await waitFor(() => {
        expect(heading).toHaveFocus();
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
      });
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
  });

  it('AC-S36-003: shows the mapped ERP aging position and an exact company invoice doorway', () => {
    collectionsHook.useCompanyCollections.mockReturnValue(collectionsResult('known', [customerPosition]));

    renderPage('co-client-1');

    expect(screen.getByRole('heading', { name: 'Customer collections' })).toBeInTheDocument();
    expect(screen.getByText('Customer:C-0001')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Customer:C-0001/ })).toHaveTextContent(/\$250\s*USD/);
    expect(screen.getByText('Report date: 2026-10-18')).toBeInTheDocument();
    expect(screen.getByText('Ageing basis: Due Date')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open invoices' })).toHaveAttribute(
      'href', '/sales-invoices?customer=co-client-1',
    );
    expect(screen.queryByText('AP aging')).not.toBeInTheDocument();
    expect(screen.getByText('Related projects', { exact: true })).toBeInTheDocument();
  });

  it('AC-S36-003: keeps missing or ambiguous ERP mapping explicitly unavailable', () => {
    collectionsHook.useCompanyCollections.mockReturnValue(collectionsResult('unavailable'));
    const { rerender } = renderPage('co-client-1');

    expect(screen.getByText(/does not indicate a zero balance/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open invoices' })).toHaveAttribute(
      'href', '/sales-invoices?customer=co-client-1',
    );
    expect(screen.queryByText(/250\.00/)).not.toBeInTheDocument();

    collectionsHook.useCompanyCollections.mockReturnValue(collectionsResult('ambiguous', [customerPosition]));
    rerender(
      <ToastProvider>
        <MemoryRouter initialEntries={['/companies/co-client-1']}>
          <Routes>
            <Route path="/companies/:companyId" element={<CompanyDetail />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );

    expect(screen.getByText(/mapped to multiple companies/i)).toBeInTheDocument();
    expect(screen.queryByText(/250\.00/)).not.toBeInTheDocument();
  });

  it('AC-S36-003: does not mount customer receivables on a Vendor company', () => {
    detailState.data = vendorCompany;

    renderPage('co-vendor-1');

    expect(screen.queryByRole('heading', { name: 'Customer collections' })).not.toBeInTheDocument();
    expect(collectionsHook.useCompanyCollections).not.toHaveBeenCalled();
    expect(screen.getByText(/^Procurement$/i)).toBeInTheDocument();
  });
});
