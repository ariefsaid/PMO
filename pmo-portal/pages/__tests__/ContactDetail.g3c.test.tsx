import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

/**
 * G3c — CRM hub completion: ContactDetail activity edit/delete tests (CT-1)
 *
 * AC-G3C-CT-1a: activity row shows Edit button for a writer role (MASTER_DATA)
 * AC-G3C-CT-1b: clicking Edit opens a pre-populated form modal
 * AC-G3C-CT-1c: saving calls updateActivity with the row id + updated data
 * AC-G3C-CT-1d: activity row shows Delete button for a writer role
 * AC-G3C-CT-1e: clicking Delete shows ConfirmDialog; confirming calls deleteActivity
 */

// ── Hoisted mocks ────────────────────────────────────────────────────────────
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

import ContactDetail from '../ContactDetail';

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

const activity = {
  id: 'a1',
  contact_id: 'ct1',
  kind: 'Call',
  subject: 'Kickoff call',
  body: 'Discussed scope',
  occurred_at: '2026-03-15T00:00:00Z',
  org_id: 'org-1',
  company_id: 'co1',
  project_id: null,
  logged_by_id: 'u1',
  created_at: '2026-03-15T00:00:00Z',
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
  mutations.updateActivity.mutateAsync.mockClear().mockResolvedValue(undefined);
  mutations.deleteActivity.mutateAsync.mockClear().mockResolvedValue(undefined);
  realRole = 'Admin';
});

describe('ContactDetail — editable activity rows (AC-G3C-CT-1a/b/c/d/e)', () => {
  it('AC-G3C-CT-1a: Admin sees Edit button on each activity row in the timeline', () => {
    activitiesState.data = [activity];
    renderPage('Admin');
    const timeline = screen.getByTestId('activity-timeline');
    const editBtns = within(timeline).getAllByRole('button', { name: /edit activity/i });
    expect(editBtns.length).toBeGreaterThan(0);
  });

  it('AC-G3C-CT-1a: Finance sees Edit button on activity rows', () => {
    activitiesState.data = [activity];
    renderPage('Finance');
    const timeline = screen.getByTestId('activity-timeline');
    const editBtns = within(timeline).getAllByRole('button', { name: /edit activity/i });
    expect(editBtns.length).toBeGreaterThan(0);
  });

  it('AC-G3C-CT-1b: clicking Edit opens a pre-populated form modal', async () => {
    activitiesState.data = [activity];
    renderPage('Admin');
    const timeline = screen.getByTestId('activity-timeline');
    await userEvent.click(within(timeline).getByRole('button', { name: /edit activity/i }));
    const dialog = await screen.findByRole('dialog', { name: /edit activity/i });
    const subjectField = within(dialog).getByLabelText(/subject/i);
    expect(subjectField).toHaveValue('Kickoff call');
  });

  it('AC-G3C-CT-1c: saving the edit form calls updateActivity with id + updated data', async () => {
    activitiesState.data = [activity];
    renderPage('Admin');
    const timeline = screen.getByTestId('activity-timeline');
    await userEvent.click(within(timeline).getByRole('button', { name: /edit activity/i }));
    const dialog = await screen.findByRole('dialog', { name: /edit activity/i });
    const subjectField = within(dialog).getByLabelText(/subject/i);
    await userEvent.clear(subjectField);
    await userEvent.type(subjectField, 'Updated call notes');
    await userEvent.click(within(dialog).getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(mutations.updateActivity.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a1', subject: 'Updated call notes' }),
      ),
    );
  });

  it('AC-G3C-CT-1d: Admin sees Delete button on each activity row', () => {
    activitiesState.data = [activity];
    renderPage('Admin');
    const timeline = screen.getByTestId('activity-timeline');
    const deleteBtns = within(timeline).getAllByRole('button', { name: /delete activity/i });
    expect(deleteBtns.length).toBeGreaterThan(0);
  });

  it('AC-G3C-CT-1e: clicking Delete shows ConfirmDialog; confirming calls deleteActivity', async () => {
    activitiesState.data = [activity];
    renderPage('Admin');
    const timeline = screen.getByTestId('activity-timeline');
    await userEvent.click(within(timeline).getByRole('button', { name: /delete activity/i }));
    // ConfirmDialog with tone="destructive" renders role="alertdialog"
    const dialog = await screen.findByRole('alertdialog');
    const confirmBtn = within(dialog).getByRole('button', { name: /delete/i });
    await userEvent.click(confirmBtn);
    await waitFor(() =>
      expect(mutations.deleteActivity.mutateAsync).toHaveBeenCalledWith('a1'),
    );
  });
});
