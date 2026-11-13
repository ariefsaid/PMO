import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

const {
  detailState,
  mutations,
  contactsState,
  projectsState,
  procurementsState,
  contactActivitiesState,
  contactMutations,
} = vi.hoisted(() => ({
  detailState: { data: undefined as Record<string, unknown> | null | undefined, isPending: false, isError: false, refetch: vi.fn() },
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    archive: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    remove: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
  },
  contactsState: { data: [] as Record<string, unknown>[], isPending: false, isError: false, refetch: vi.fn() },
  projectsState: { data: [] as Record<string, unknown>[], isPending: false, isError: false, refetch: vi.fn() },
  procurementsState: { data: [] as Record<string, unknown>[], isPending: false, isError: false, refetch: vi.fn() },
  contactActivitiesState: { data: [] as Record<string, unknown>[], isPending: false, isError: false, refetch: vi.fn() },
  contactMutations: {
    create: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    update: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    archive: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    remove: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    logActivity: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    updateActivity: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    deleteActivity: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
  },
}));

vi.mock('@/src/hooks/useDomainOwnershipMode', async () => await import('@/test/domainOwnershipMock'));
vi.mock('@/src/hooks/useCompanyPartyMappings', () => ({ useCompanyPartyMappings: () => ({ ids: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompany: () => detailState,
  useCompanyMutations: () => mutations,
  useProjectsByClient: () => projectsState,
  useProcurementsByVendor: () => procurementsState,
}));
vi.mock('@/src/hooks/useContacts', () => ({
  useContactsByCompany: () => contactsState,
  useCompanyActivities: () => contactActivitiesState,
  useContactMutations: () => contactMutations,
}));
vi.mock('@/src/hooks/useCompanyCollections', () => ({ useCompanyCollections: () => ({ isEnabled: false }) }));

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole, effectiveRole: realRole }) }));

import CompanyDetail from './CompanyDetail';

function ContactDestination() {
  const { contactId } = useParams();
  return <div>Contact page {contactId}</div>;
}

const company = {
  id: 'co1',
  org_id: 'org-1',
  name: 'Sample Company',
  type: 'Client' as const,
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
};
const contact = {
  id: 'ct1',
  full_name: 'Test Contact',
  title: 'Procurement Lead',
  company_id: 'co1',
  phone: null,
  notes: null,
  org_id: 'org-1',
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
};

function renderPage() {
  realRole = 'Admin';
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/companies/co1']}>
        <Routes>
          <Route path="/companies/:companyId" element={<CompanyDetail />} />
          <Route path="/companies" element={<div>Companies index</div>} />
          <Route path="/contacts/:contactId" element={<ContactDestination />} />
          <Route path="/projects/:id" element={<div>Project page</div>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

beforeEach(() => {
  detailState.data = company;
  detailState.isPending = false;
  detailState.isError = false;
  contactsState.data = [contact];
  contactsState.isPending = false;
  contactsState.isError = false;
  projectsState.data = [];
  projectsState.isPending = false;
  projectsState.isError = false;
  procurementsState.data = [];
  procurementsState.isPending = false;
  procurementsState.isError = false;
  contactActivitiesState.data = [];
  contactActivitiesState.isPending = false;
  contactActivitiesState.isError = false;
  realRole = 'Admin';
});

describe('company record floor controls', () => {
  it('floor: Primary contact name opens that contact record', () => {
    renderPage();
    fireEvent.click(screen.getByRole('link', { name: 'Test Contact' }));
    expect(screen.getByText('Contact page ct1')).toBeInTheDocument();
  });
});
