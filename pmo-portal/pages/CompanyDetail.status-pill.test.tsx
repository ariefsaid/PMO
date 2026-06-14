import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

/**
 * Fix #9 — CompanyDetail: related-project rows must use StatusPill (dot+pill)
 * rather than rendering status as bare grey text (violates the Tinted-Status rule).
 *
 * AC-FIX9-PILL-01: a project row in the related-projects list renders a StatusPill,
 *   identified by `data-pill-dot` (the dot element inside every StatusPill).
 * AC-FIX9-PILL-02: status text is NOT rendered as a plain <span class="text-muted-foreground">.
 */

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
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
  }),
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

const renderPage = () =>
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/companies/co-client-1']}>
        <Routes>
          <Route path="/companies/:companyId" element={<CompanyDetail />} />
          <Route path="/companies" element={<div>Companies index</div>} />
          <Route path="/projects/:id" element={<div>Project page</div>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );

beforeEach(() => {
  detailState.data = clientCompany;
  detailState.isPending = false;
  detailState.isError = false;
  contactsState.data = [];
  contactsState.isPending = false;
  projectsState.data = [
    {
      id: 'p-1',
      name: 'Meridian Solar Phase 1',
      status: 'Ongoing Project',
      client: { name: 'Meridian Steelworks' },
    },
  ];
  projectsState.isPending = false;
  projectsState.isError = false;
  procurementsState.data = [];
  procurementsState.isPending = false;
  procurementsState.isError = false;
  realRole = 'Admin';
});

describe('CompanyDetail — related-project status pill (fix #9)', () => {
  it('AC-FIX9-PILL-01: related-project row contains a StatusPill dot (not bare text)', () => {
    renderPage();
    // StatusPill renders a <span data-pill-dot aria-hidden> inside every pill
    const dots = document.querySelectorAll('[data-pill-dot]');
    expect(dots.length).toBeGreaterThan(0);
  });

  it('AC-FIX9-PILL-02: status text is wrapped in a StatusPill, not a bare muted span', () => {
    renderPage();
    // The status text "Ongoing Project" must be inside a pill, not a bare <span>
    // with only text-muted-foreground styling. The pill itself will contain the text.
    const statusText = screen.getByText('Ongoing Project');
    // StatusPill renders as a <span> containing a dot + the text child.
    // Its parent span has the pill classes (bg-secondary, h-[22px], etc).
    // Bare text renders as: <span class="text-[12px] text-muted-foreground">Ongoing Project</span>
    // We assert it is NOT that bare pattern: it should have a sibling [data-pill-dot] element.
    const siblings = statusText.parentElement
      ? [...statusText.parentElement.querySelectorAll('[data-pill-dot]')]
      : [];
    expect(siblings.length).toBeGreaterThan(0);
  });
});
