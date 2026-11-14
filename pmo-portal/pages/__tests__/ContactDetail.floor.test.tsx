/**
 * Floor tests for the contact record (floor-wave2).
 *
 * Four controls a person can press on `/contacts/:id` that nothing drove end-to-end: the Company
 * field's link, a minuted meeting's title in the timeline, an activity subject that names a
 * project, and the company-directory Retry. Each asserts the OUTCOME (a route opens, a read is
 * re-issued), never a look. The mock set mirrors the page's own suites
 * (`ContactDetail.companylink.test.tsx`, `ContactDetail.activitylink.test.tsx`) — same repository
 * mocks, same real MemoryRouter — but the router is NOT stubbed here: navigation is the outcome.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast as sonnerToast } from 'sonner';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

vi.mock('@/src/hooks/useDomainOwnershipMode', async () => await import('@/test/domainOwnershipMock'));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-pm', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Project Manager', realRole: 'Project Manager' }),
}));
vi.mock('@/src/components/ui', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});

const h = vi.hoisted(() => ({
  contact: {
    data: null as Record<string, unknown> | null,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  companies: {
    data: [] as Array<Record<string, unknown>>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  activities: {
    data: [] as Array<Record<string, unknown>>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  },
  meetings: {
    data: [] as Array<Record<string, unknown>>,
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useContacts', () => ({
  useContact: () => h.contact,
  useContactActivities: () => h.activities,
  useContactMeetings: () => h.meetings,
  useContactMutations: () => ({
    update: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    logActivity: { mutateAsync: vi.fn(), isPending: false },
    updateActivity: { mutateAsync: vi.fn(), isPending: false },
    deleteActivity: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => h.companies,
  useCompany: () => ({ data: undefined, isPending: false, isError: true }),
}));

import ContactDetail from '../ContactDetail';

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="location-probe" data-pathname={location.pathname} />;
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/contacts/ct-1']}>
      <LocationProbe />
      <Routes>
        <Route
          path="/contacts/:contactId"
          element={
            <ToastProvider>
              <ContactDetail />
            </ToastProvider>
          }
        />
        <Route path="*" element={<div data-testid="landed" />} />
      </Routes>
    </MemoryRouter>,
  );

const baseContact = {
  id: 'ct-1',
  full_name: 'Jane Doe',
  company_id: 'co-1',
  title: 'Procurement Lead',
  email: null,
  phone: null,
  notes: null,
  archived_at: null,
};

const makeActivity = (overrides: Record<string, unknown>) => ({
  id: `act-${String(overrides.subject ?? 'x')}`,
  contact_id: 'ct-1',
  kind: 'Call' as const,
  subject: 'Project kickoff',
  body: null,
  occurred_at: '2026-06-01T10:00:00Z',
  company_id: null,
  project_id: null,
  org_id: 'org-1',
  logged_by_id: null,
  created_at: '2026-06-01T10:00:00Z',
  ...overrides,
});

const pathname = () => screen.getByTestId('location-probe').dataset.pathname;

beforeEach(() => {
  h.contact.data = { ...baseContact };
  h.contact.isPending = false;
  h.contact.isError = false;
  h.contact.refetch.mockClear();
  h.companies.data = [{ id: 'co-1', name: 'Apex Corp', archived_at: null }];
  h.companies.isPending = false;
  h.companies.isError = false;
  h.companies.refetch.mockClear();
  h.activities.data = [];
  h.activities.isPending = false;
  h.activities.isError = false;
  h.activities.hasNextPage = false;
  h.meetings.data = [];
  h.meetings.isPending = false;
  h.meetings.isError = false;
});

afterEach(() => {
  act(() => { sonnerToast.dismiss(); });
});

describe('ContactDetail floor — cross-links open the related record', () => {
  it('floor: the Company field name opens the company record', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('link', { name: 'Apex Corp' }));
    await waitFor(() => expect(pathname()).toBe('/companies/co-1'));
  });

  it('floor: a minuted meeting title opens the meeting record', async () => {
    h.meetings.data = [{ id: 'm-1', title: 'Site walkthrough', occurred_at: '2026-06-02T10:00:00Z' }];
    renderPage();
    await userEvent.click(screen.getByRole('link', { name: 'Site walkthrough' }));
    await waitFor(() => expect(pathname()).toBe('/meetings/m-1'));
  });

  it('floor: an activity subject naming a project opens that project', async () => {
    h.activities.data = [makeActivity({ subject: 'Kickoff call', project_id: 'p-1' })];
    renderPage();
    await userEvent.click(screen.getByRole('link', { name: 'Kickoff call' }));
    await waitFor(() => expect(pathname()).toBe('/projects/p-1'));
  });
});

describe('ContactDetail floor — recoveries', () => {
  it('floor: company directory Retry re-reads the directory', async () => {
    h.companies.isError = true;
    h.companies.data = [];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Retry$/i }));
    expect(h.companies.refetch).toHaveBeenCalled();
  });
});
