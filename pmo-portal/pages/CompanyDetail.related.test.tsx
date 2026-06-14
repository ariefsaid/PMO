import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

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
  },
  procurementsState: {
    data: [] as Record<string, unknown>[],
    isPending: false,
    isError: false,
  },
}));

vi.mock('@/src/hooks/useCompanies', () => ({
  useCompany: () => detailState,
  useCompanyMutations: () => mutations,
  useProjectsByClient: () => projectsState,
  useProcurementsByVendor: () => procurementsState,
}));
vi.mock('@/src/hooks/useContacts', () => ({
  useContactsByCompany: () => contactsState,
}));

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
  procurementsState.data = [];
  procurementsState.isPending = false;
  procurementsState.isError = false;
  mutations.update.mutateAsync.mockClear().mockResolvedValue(undefined);
  mutations.archive.mutateAsync.mockClear().mockResolvedValue(undefined);
  realRole = 'Admin';
});

describe('CompanyDetail — related objects (AC-IFW-COMPANY-01)', () => {
  it('AC-IFW-COMPANY-01: renders a "Related projects" card for a Client company', () => {
    renderPage('co-client-1');
    // CardHead renders as a div; getAllByText returns multiple when the ul aria-label matches too
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
