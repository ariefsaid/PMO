import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

/**
 * G3c — CRM hub completion: CompanyDetail tests
 *
 * AC-G3C-CD-1a: activity row shows Edit button (gated: writer sees it, read-only hides it)
 * AC-G3C-CD-1b: clicking Edit on an activity row opens the edit form pre-populated
 * AC-G3C-CD-1c: saving the edit form calls updateActivity mutation with the row id
 * AC-G3C-CD-1d: activity row shows Delete button gated by contactActivity write permission
 * AC-G3C-CD-1e: clicking Delete shows ConfirmDialog; confirming calls deleteActivity mutation
 * AC-G3C-CD-3:  RelatedProcurement renders for a non-Vendor company when vendor PRs exist
 * AC-G3C-CD-4:  contactless company renders cold-start Activity prompt + opens Add-contact modal
 */

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const {
  detailState,
  mutations,
  contactsState,
  projectsState,
  procurementsState,
  contactActivitiesState,
  contactMutations,
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
    isError: false,
    refetch: vi.fn(),
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
  contactActivitiesState: {
    data: [] as Record<string, unknown>[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
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

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import CompanyDetail from '../CompanyDetail';

const company = {
  id: 'co1',
  org_id: 'org-1',
  name: 'Cascade Port Authority',
  type: 'Client' as const,
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
};

const contacts = [
  {
    id: 'ct1',
    full_name: 'Jane Doe',
    title: 'Procurement Lead',
    company_id: 'co1',
    email: 'jane@cascade.test',
    phone: null,
    notes: null,
    org_id: 'org-1',
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
  },
];

const activity = {
  id: 'a1',
  contact_id: 'ct1',
  kind: 'Call',
  subject: 'Kickoff discussion',
  body: 'Agreed on next steps',
  occurred_at: '2026-05-15T10:00:00Z',
  org_id: 'org-1',
  company_id: 'co1',
  project_id: null,
  logged_by_id: 'u1',
  created_at: '2026-05-15T10:00:00Z',
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
          <Route path="/projects/:id" element={<div>Project page</div>} />
          <Route path="/procurement/:id" element={<div>Procurement page</div>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
};

beforeEach(() => {
  detailState.data = company;
  detailState.isPending = false;
  detailState.isError = false;
  detailState.refetch.mockClear();

  contactsState.data = [];
  contactsState.isPending = false;
  contactsState.isError = false;

  projectsState.data = [];
  procurementsState.data = [];

  contactActivitiesState.data = [];
  contactActivitiesState.isPending = false;
  contactActivitiesState.isError = false;

  contactMutations.logActivity.mutateAsync.mockClear().mockResolvedValue(undefined);
  contactMutations.updateActivity.mutateAsync.mockClear().mockResolvedValue(undefined);
  contactMutations.deleteActivity.mutateAsync.mockClear().mockResolvedValue(undefined);

  realRole = 'Admin';
});

// ── CD-1/CT-1: editable/deletable activity rows (CompanyDetail) ───────────────

describe('CompanyDetail — editable activity rows (AC-G3C-CD-1a/b/c/d/e)', () => {
  it('AC-G3C-CD-1a: Admin sees Edit button on each activity row', () => {
    contactsState.data = contacts;
    contactActivitiesState.data = [activity];
    renderPage('Admin');
    expect(screen.getByTestId('account-activity-timeline')).toBeInTheDocument();
    const editBtns = screen.getAllByRole('button', { name: /edit activity/i });
    expect(editBtns.length).toBeGreaterThan(0);
  });

  it('AC-G3C-CD-1a: Finance sees Edit button on activity rows (MASTER_DATA writer)', () => {
    contactsState.data = contacts;
    contactActivitiesState.data = [activity];
    renderPage('Finance');
    const editBtns = screen.getAllByRole('button', { name: /edit activity/i });
    expect(editBtns.length).toBeGreaterThan(0);
  });

  it('AC-G3C-CD-1a: Engineer does NOT reach this page (AccessDenied) — no edit buttons', () => {
    contactsState.data = contacts;
    contactActivitiesState.data = [activity];
    renderPage('Engineer');
    // Engineer sees AccessDenied
    expect(screen.queryByRole('button', { name: /edit activity/i })).not.toBeInTheDocument();
  });

  it('AC-G3C-CD-1b: clicking Edit opens a form pre-populated with the activity data', async () => {
    contactsState.data = contacts;
    contactActivitiesState.data = [activity];
    renderPage('Admin');

    await userEvent.click(screen.getByRole('button', { name: /edit activity/i }));
    // The edit form or modal should appear with the activity data pre-filled
    const dialog = await screen.findByRole('dialog', { name: /edit activity/i });
    const subjectField = within(dialog).getByLabelText(/subject/i);
    expect(subjectField).toHaveValue('Kickoff discussion');
  });

  it('AC-G3C-CD-1c: saving the edit form calls updateActivity with the activity id + new data', async () => {
    contactsState.data = contacts;
    contactActivitiesState.data = [activity];
    renderPage('Admin');

    await userEvent.click(screen.getByRole('button', { name: /edit activity/i }));
    const dialog = await screen.findByRole('dialog', { name: /edit activity/i });
    const subjectField = within(dialog).getByLabelText(/subject/i);
    await userEvent.clear(subjectField);
    await userEvent.type(subjectField, 'Updated subject');
    await userEvent.click(within(dialog).getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(contactMutations.updateActivity.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a1', subject: 'Updated subject' }),
      ),
    );
  });

  it('AC-G3C-CD-1d: Admin sees Delete button on each activity row', () => {
    contactsState.data = contacts;
    contactActivitiesState.data = [activity];
    renderPage('Admin');
    const deleteBtns = screen.getAllByRole('button', { name: /delete activity/i });
    expect(deleteBtns.length).toBeGreaterThan(0);
  });

  it('AC-G3C-CD-1e: clicking Delete shows ConfirmDialog; confirming calls deleteActivity', async () => {
    contactsState.data = contacts;
    contactActivitiesState.data = [activity];
    renderPage('Admin');

    await userEvent.click(screen.getByRole('button', { name: /delete activity/i }));
    // ConfirmDialog with tone="destructive" renders role="alertdialog"
    const dialog = await screen.findByRole('alertdialog');
    const confirmBtn = within(dialog).getByRole('button', { name: /delete/i });
    await userEvent.click(confirmBtn);

    await waitFor(() =>
      expect(contactMutations.deleteActivity.mutateAsync).toHaveBeenCalledWith('a1'),
    );
  });
});

// ── CD-3: procurement shown for non-Vendor company when rows exist ────────────

describe('CompanyDetail — type-independent procurement (AC-G3C-CD-3)', () => {
  it('AC-G3C-CD-3: renders Procurement card for a Client company when useProcurementsByVendor returns rows', () => {
    detailState.data = { ...company, type: 'Client' };
    procurementsState.data = [
      { id: 'pr-1', title: 'IT Hardware', status: 'Ordered' },
    ];
    renderPage();
    // Procurement card heading should appear
    const heading = screen.getByText(/^Procurement$/i);
    expect(heading).toBeInTheDocument();
    // And the PR should be listed
    expect(screen.getByRole('link', { name: /IT Hardware/i })).toBeInTheDocument();
  });

  it('AC-G3C-CD-3: does NOT render Procurement card for a Client company with NO vendor PRs', () => {
    detailState.data = { ...company, type: 'Client' };
    procurementsState.data = [];
    renderPage();
    // No procurement heading when no rows
    expect(screen.queryByText(/^Procurement$/i)).not.toBeInTheDocument();
  });

  it('AC-G3C-CD-3: still renders Procurement card for a Vendor company with rows', () => {
    detailState.data = { ...company, type: 'Vendor' };
    procurementsState.data = [
      { id: 'pr-2', title: 'PV Module Supply', status: 'Approved' },
    ];
    renderPage();
    expect(screen.getByText(/^Procurement$/i)).toBeInTheDocument();
  });
});

// ── CD-4: cold-start empty — no contacts, no activities ──────────────────────

describe('CompanyDetail — cold-start empty Activity section (AC-G3C-CD-4)', () => {
  it('AC-G3C-CD-4: renders an Activity card with a prompt when company has no contacts and no activities', () => {
    contactsState.data = [];
    contactActivitiesState.data = [];
    renderPage('Admin');
    // The cold-start prompt text (distinct from the card heading "Activity")
    expect(screen.getByText(/add a contact to start logging activity/i)).toBeInTheDocument();
  });

  it('AC-G3C-CD-4: the cold-start prompt button opens the Add-contact modal', async () => {
    contactsState.data = [];
    contactActivitiesState.data = [];
    renderPage('Admin');

    // The cold-start has an "Add contact" button (in addition to the Contacts card one)
    // Use the one near the cold-start prompt (the Contacts card "Add contact" is also present)
    const addContactBtns = screen.getAllByRole('button', { name: /add contact/i });
    // Click the first one (in the cold-start Activity card, which appears before the Contacts card)
    await userEvent.click(addContactBtns[0]);

    const dialog = await screen.findByRole('dialog', { name: /new contact/i });
    expect(dialog).toBeInTheDocument();
  });

  it('AC-G3C-CD-4: cold-start prompt is absent when there are contacts (normal state)', () => {
    contactsState.data = contacts;
    contactActivitiesState.data = [];
    renderPage('Admin');
    expect(screen.queryByText(/add a contact to start logging activity/i)).not.toBeInTheDocument();
  });
});
