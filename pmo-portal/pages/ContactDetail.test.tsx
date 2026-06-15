import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

// ── The single-contact hook + activities + mutations + the companies list are mocked. ──
const { detailState, activitiesState, mutations, companiesState } = vi.hoisted(() => ({
  detailState: {
    data: undefined as Record<string, unknown> | null | undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  activitiesState: {
    data: [] as Record<string, unknown>[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    archive: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    remove: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    logActivity: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    updateActivity: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    deleteActivity: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
  },
  companiesState: {
    data: [{ id: 'co1', name: 'Cascade Port Authority', type: 'Client' }],
  },
}));

vi.mock('@/src/hooks/useContacts', () => ({
  useContact: () => detailState,
  useContactActivities: () => activitiesState,
  useContactMutations: () => mutations,
}));
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => companiesState,
}));

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import ContactDetail from './ContactDetail';

const contact = {
  id: 'ct1',
  org_id: 'org-1',
  company_id: 'co1',
  full_name: 'Jane Doe',
  title: 'Procurement Lead',
  email: 'jane@example.com',
  phone: '+1 555 010 0000',
  notes: 'Key contact',
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
};

const renderPage = (role: Role = 'Admin') => {
  realRole = role;
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/contacts/ct1']}>
        <Routes>
          <Route path="/contacts/:contactId" element={<ContactDetail />} />
          <Route path="/contacts" element={<div>Contacts index</div>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
};

beforeEach(() => {
  detailState.data = contact;
  detailState.isPending = false;
  detailState.isError = false;
  activitiesState.data = [];
  activitiesState.isPending = false;
  activitiesState.isError = false;
  activitiesState.refetch.mockClear();
  mutations.update.mutateAsync.mockClear().mockResolvedValue(undefined);
  mutations.archive.mutateAsync.mockClear().mockResolvedValue(undefined);
  mutations.logActivity.mutateAsync.mockClear().mockResolvedValue(undefined);
  realRole = 'Admin';
});

describe('ContactDetail', () => {
  it('CW-4b: renders the shared RecordHeader with the contact name + the categorical pill, and its fields', () => {
    renderPage();
    const header = screen.getByTestId('record-header');
    expect(within(header).getByText('Jane Doe')).toBeInTheDocument();
    expect(within(header).getByText('Contact')).toBeInTheDocument();
    // Body fields are present.
    expect(screen.getByText('Cascade Port Authority')).toBeInTheDocument();
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
  });

  it('CW-4b: shows the loading skeleton while the record is pending', () => {
    detailState.data = undefined;
    detailState.isPending = true;
    renderPage();
    expect(screen.getByTestId('contact-loading')).toBeInTheDocument();
  });

  it('CW-4b: shows a calm not-found state when the record is absent', () => {
    detailState.data = null;
    detailState.isPending = false;
    renderPage();
    expect(screen.getByTestId('contact-not-found')).toBeInTheDocument();
  });

  it('CW-4b: a transient load error offers Retry', async () => {
    detailState.data = undefined;
    detailState.isError = true;
    renderPage();
    const retry = screen.getByRole('button', { name: /retry|try again/i });
    await userEvent.click(retry);
    expect(detailState.refetch).toHaveBeenCalled();
  });

  it('CW-4b: Back returns to the Contacts list', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /back to contacts/i }));
    expect(screen.getByText('Contacts index')).toBeInTheDocument();
  });

  it('CW-4b: renders the activity timeline section (moved off the retired drawer) — empty state when none', () => {
    activitiesState.data = [];
    renderPage();
    expect(screen.getByText(/no activity logged yet/i)).toBeInTheDocument();
  });

  it('CW-4b: renders logged activity in the timeline when present', () => {
    activitiesState.data = [
      { id: 'a1', kind: 'Call', subject: 'Kickoff call', body: 'Discussed scope', occurred_at: '2026-03-15T00:00:00Z' },
    ];
    renderPage();
    const timeline = screen.getByTestId('activity-timeline');
    expect(within(timeline).getByText('Kickoff call')).toBeInTheDocument();
    expect(within(timeline).getByText('Discussed scope')).toBeInTheDocument();
  });

  it('CW-4b: the activity timeline shows a loading skeleton while activities are pending', () => {
    activitiesState.isPending = true;
    activitiesState.data = [];
    renderPage();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  });

  it('CW-4b: an activity load error offers Retry', async () => {
    activitiesState.isPending = false;
    activitiesState.isError = true;
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(activitiesState.refetch).toHaveBeenCalled();
  });

  it('CW-4b: a manager can log an activity from the form on the page', async () => {
    renderPage('Admin');
    const subject = screen.getByLabelText(/subject/i);
    await userEvent.type(subject, 'Followup');
    await userEvent.click(screen.getByRole('button', { name: /log activity/i }));
    expect(mutations.logActivity.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ contact_id: 'ct1', subject: 'Followup' }),
    );
  });

  it('CW-4b: a manager can open the edit modal from the header and save an update', async () => {
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    const dialog = await screen.findByRole('dialog', { name: /edit contact/i });
    const nameField = within(dialog).getByLabelText(/full name/i);
    await userEvent.clear(nameField);
    await userEvent.type(nameField, 'Jane Smith');
    await userEvent.click(within(dialog).getByRole('button', { name: /save contact/i }));
    expect(mutations.update.mutateAsync).toHaveBeenCalledWith({
      id: 'ct1',
      input: expect.objectContaining({ full_name: 'Jane Smith' }),
    });
  });

  it('CW-4b: a manager can archive from the header (confirm-before-write)', async () => {
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /^archive$/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /archive contact/i }));
    expect(mutations.archive.mutateAsync).toHaveBeenCalledWith('ct1');
  });

  it('CW-4b: an Engineer (no contact access) sees the access-denied surface, not the record', () => {
    renderPage('Engineer');
    expect(screen.getByText(/don't have access to contacts/i)).toBeInTheDocument();
    expect(screen.queryByTestId('record-header')).toBeNull();
  });
});
