import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

/**
 * Fix #9 — CompanyDetail: related-project rows must use StatusPill (paired status
 * surface + label) rather than rendering status as bare grey text (violates the
 * Tinted-Status rule). Amended 2026-10-29: the pill is text-only (decorative dot
 * banned); the pill chrome + paired surface identify it.
 *
 * AC-FIX9-PILL-01: a project row in the related-projects list renders a StatusPill,
 *   identified by its pill chrome + paired `bg-status-*` surface class.
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
vi.mock('@/src/hooks/useCompanyCollections', () => ({
  useCompanyCollections: () => ({ isEnabled: false }),
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
  it('AC-FIX9-PILL-01: related-project row contains a StatusPill (not bare text)', () => {
    renderPage();
    // StatusPill renders its label inside a rounded pill carrying a paired `bg-status-*` surface
    const pills = document.querySelectorAll('span[class*="bg-status-"]');
    expect(pills.length).toBeGreaterThan(0);
    expect(pills[0].className).toContain('rounded-full');
  });

  it('AC-FIX9-PILL-02: status text is wrapped in a StatusPill, not a bare muted span', () => {
    renderPage();
    // The status text "Ongoing Project" must be inside a pill, not a bare <span>
    // with only text-muted-foreground styling. The pill itself contains the text.
    const statusText = screen.getByText('Ongoing Project');
    // The pill's own element carries the pill chrome + the paired status surface.
    // Bare text renders as: <span class="text-[12px] text-muted-foreground">Ongoing Project</span>
    const pill = statusText.closest('span[class*="bg-status-"]');
    expect(pill).not.toBeNull();
    expect(pill!.className).toContain('rounded-full');
  });
});
