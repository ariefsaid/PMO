import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';
import { findToastAnnouncement } from '@/src/components/ui/__tests__/toastTestQueries';

// ── The single-incident hook + mutations are mocked; the page is the unit. ──
const { assigneeState, detailState, mutations, uploadEvidence, evidenceState, linkedTaskState } = vi.hoisted(() => ({
  detailState: {
    data: undefined as Record<string, unknown> | null | undefined,
    isPending: false,
    isError: false,
    error: null as (Error & { code?: string }) | null,
    refetch: vi.fn(),
  },
  assigneeState: { data: [] as { value: string; label: string }[] },
  uploadEvidence: vi.fn().mockResolvedValue({}),
  evidenceState: { data: [] as Array<{ id: string; kind: string; title: string }> },
  linkedTaskState: { data: { project_id: 'p1' } as { project_id: string } | null },
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    transition: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    remove: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
  },
}));

vi.mock('@/src/hooks/useIncidents', () => ({
  useIncident: () => detailState,
  useIncidentMutations: () => mutations,
  useAssigneeOptions: () => ({ data: assigneeState.data }),
  useIncidentEvidenceMutations: () => ({ upload: { mutateAsync: uploadEvidence, isPending: false }, makeTask: { mutateAsync: vi.fn(), isPending: false } }),
  useIncidentFiles: () => evidenceState,
}));
vi.mock('@/src/hooks/useIncidentLinkedTask', () => ({ useIncidentLinkedTask: () => linkedTaskState }));
vi.mock('@/src/hooks/useWorkOrders', () => ({ useProjectWorkOrders: () => ({ data: [] }) }));


vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-self', org_id: 'org-1' } }) }));

// Project FK options back the project-link display name on the detail page.
const { projectOptions } = vi.hoisted(() => ({
  projectOptions: { data: [] as { value: string; label: string }[] },
}));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => projectOptions,
}));

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import IncidentDetail from './IncidentDetail';

const incident = {
  id: 'i1',
  org_id: 'org-1',
  incident_date: '2026-03-15',
  type: 'Near Miss',
  severity: 'High' as const,
  location: 'Regional Site B',
  description: 'Trip hazard near the scaffold',
  status: 'Open' as const,
  reported_by: 'u1',
  created_at: '2026-03-15T00:00:00Z',
};

const renderPage = (role: Role = 'Admin') => {
  realRole = role;
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/incidents/i1']}>
        <Routes>
          <Route path="/incidents/:incidentId" element={<IncidentDetail />} />
          <Route path="/incidents" element={<div>Incidents index</div>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
};

beforeEach(() => {
  detailState.data = incident;
  detailState.isPending = false;
  detailState.isError = false;
  detailState.error = null;
  projectOptions.data = [];
  evidenceState.data = [];
  linkedTaskState.data = { project_id: 'p1' };
  mutations.update.mutateAsync.mockClear().mockResolvedValue(undefined);
  mutations.transition.mutateAsync.mockClear().mockResolvedValue(undefined);
  realRole = 'Admin';
});

describe('IncidentDetail — the reporter is told what happens next (walk fix JOB-ISSUE-REPORTER)', () => {
  it('names the person in charge, the next step, who can close it, and offers a photo', () => {
    assigneeState.data = [{ value: 'u-boss', label: 'Pak Budi' }];
    detailState.data = { ...incident, reported_by: 'u-self', assignee_id: 'u-boss', action: 'Barricade the area' };
    renderPage('Engineer');
    const panel = screen.getByTestId('incident-next-steps');
    expect(within(panel).getByText(/Person in charge: Pak Budi/)).toBeInTheDocument();
    expect(within(panel).getByText(/Next: Barricade the area/)).toBeInTheDocument();
    expect(within(panel).getByText(/Project Manager, Executive and Admin can close this issue, with proof\./)).toBeInTheDocument();
    expect(screen.queryByTestId('incident-advance')).toBeNull();
  });

  it('with nobody in charge yet it says who assigns one', () => {
    assigneeState.data = [];
    detailState.data = { ...incident, reported_by: 'u-self' };
    renderPage('Engineer');
    expect(within(screen.getByTestId('incident-next-steps')).getByText(/Nobody is in charge yet\. The project manager picks the person in charge\./)).toBeInTheDocument();
  });

  it('a closed issue shows no next steps', () => {
    detailState.data = { ...incident, status: 'Closed', reported_by: 'u-self' };
    renderPage('Engineer');
    expect(screen.queryByTestId('incident-next-steps')).toBeNull();
  });
});

describe('IncidentDetail', () => {
  it('AC-INC-002: renders the record header with the incident type, severity + status pills, and its fields', () => {
    renderPage();
    const header = screen.getByTestId('record-header');
    expect(within(header).getByText('Near Miss')).toBeInTheDocument();
    // Severity + workflow-status pills both surface in the header.
    expect(within(header).getByText('High')).toBeInTheDocument();
    expect(within(header).getByText('Open')).toBeInTheDocument();
    // Body fields are present (the dead-end is gone — the record opens to a real page).
    expect(screen.getByText('Regional Site B')).toBeInTheDocument();
    expect(screen.getByText('Trip hazard near the scaffold')).toBeInTheDocument();
  });

  it('AC-INC-002: shows the loading skeleton while the record is pending', () => {
    detailState.data = undefined;
    detailState.isPending = true;
    renderPage();
    expect(screen.getByTestId('incident-loading')).toBeInTheDocument();
  });

  it('AC-INC-002: shows a calm not-found state when the record is absent', () => {
    detailState.data = null;
    detailState.isPending = false;
    renderPage();
    expect(screen.getByTestId('incident-not-found')).toBeInTheDocument();
  });

  it('AC-INC-002: a transient load error offers Retry', async () => {
    detailState.data = undefined;
    detailState.isError = true;
    renderPage();
    const retry = screen.getByRole('button', { name: /retry|try again/i });
    await userEvent.click(retry);
    expect(detailState.refetch).toHaveBeenCalled();
  });

  it.each([
    ['loading', { data: undefined, isPending: true, isError: false }],
    ['not-found', { data: null, isPending: false, isError: false }],
    ['error', { data: undefined, isPending: false, isError: true }],
  ])('#707: the %s state shows the Back bar only at phone width (hidden on desktop)', (_n, s) => {
    Object.assign(detailState, s);
    renderPage();
    const bar = screen.getByRole('button', { name: /back to incidents/i }).parentElement!;
    expect(bar.className).toContain('hidden');
    expect(bar.className).toContain('max-[920px]:flex');
  });

  it('AC-INC-002: Back returns to the Incidents list', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /back to incidents/i }));
    expect(screen.getByText('Incidents index')).toBeInTheDocument();
  });

  it('AC-INC-003: a manager can advance the workflow (Open → Investigating) from the detail page', async () => {
    renderPage('Admin');
    // The header carries the status-transition action.
    await userEvent.click(screen.getByRole('button', { name: /start investigating/i }));
    // Confirm-before-write dialog.
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /start investigating/i }));
    expect(mutations.transition.mutateAsync).toHaveBeenCalledWith({ id: 'i1', status: 'Investigating' });
  });

  it('AC-INC-003: an Engineer (no transition/edit rights) sees no advance or edit affordance', () => {
    renderPage('Engineer');
    expect(screen.queryByRole('button', { name: /start investigating/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^edit$/i })).toBeNull();
  });

  it('AC-INC-004: a manager can open the edit modal from the header and save an update', async () => {
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    const dialog = await screen.findByRole('dialog', { name: /edit incident/i });
    // The form is pre-filled; change the type then save.
    const typeField = within(dialog).getByLabelText(/^type/i);
    await userEvent.clear(typeField);
    await userEvent.type(typeField, 'Spill');
    await userEvent.click(within(dialog).getByRole('button', { name: /save incident/i }));
    expect(mutations.update.mutateAsync).toHaveBeenCalledWith({
      id: 'i1',
      input: expect.objectContaining({ type: 'Spill' }),
    });
  });

  it('AC-INC-003: an Investigating incident advances to Closed via the header action', async () => {
    // A Medium issue closes without a photo (proof is required from High up — see the next test).
    detailState.data = { ...incident, status: 'Investigating', severity: 'Medium' };
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /close incident/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /close incident/i }));
    expect(mutations.transition.mutateAsync).toHaveBeenCalledWith({ id: 'i1', status: 'Closed' });
  });

  it('AC-SIL-004: a High issue cannot be closed from the form until a close photo is added', async () => {
    detailState.data = { ...incident, status: 'Investigating', severity: 'High' };
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /close incident/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /close incident/i })).toBeDisabled();
    await userEvent.upload(within(dialog).getByTestId('incident-close-photo-input'), new File(['x'], 'proof.jpg', { type: 'image/jpeg' }));
    expect(within(dialog).getByRole('button', { name: /close incident/i })).toBeEnabled();
  });

  it('opens the linked task from the issue', () => {
    detailState.data = { ...incident, project_id: 'p1', task_id: 't1' };
    renderPage('Admin');
    expect(screen.getByTestId('incident-task-linked')).toHaveAttribute('href', '/projects/p1/tasks?open=t1');
  });

  it('opens the task’s own project if the issue has moved', () => {
    detailState.data = { ...incident, project_id: 'p2', task_id: 't1' };
    linkedTaskState.data = { project_id: 'p1' };
    renderPage('Admin');
    expect(screen.getByTestId('incident-task-linked')).toHaveAttribute('href', '/projects/p1/tasks?open=t1');
  });

  it('permits a raise photo when close photos bring the total to ten', () => {
    evidenceState.data = Array.from({ length: 10 }, (_, n) => ({ id: `f${n}`, title: `photo${n}.jpg`, kind: n < 5 ? 'at_raise' : 'at_close' }));
    renderPage('Admin');
    expect(within(screen.getByTestId('incident-evidence')).getByRole('button', { name: /add photo/i })).toBeInTheDocument();
  });

  it('accepts at most five close photos', async () => {
    detailState.data = { ...incident, status: 'Investigating', severity: 'High' };
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /close incident/i }));
    const dialog = await screen.findByRole('dialog');
    const photos = Array.from({ length: 6 }, (_, n) => new File(['x'], `proof-${n}.jpg`, { type: 'image/jpeg' }));
    await userEvent.upload(within(dialog).getByTestId('incident-close-photo-input'), photos);
    expect(within(dialog).getByText('proof-4.jpg')).toBeInTheDocument();
    expect(within(dialog).queryByText('proof-5.jpg')).not.toBeInTheDocument();
  });

  it('allows a high issue to close using its existing close proof', async () => {
    detailState.data = { ...incident, status: 'Investigating', severity: 'High' };
    evidenceState.data = [{ id: 'f1', kind: 'at_close', title: 'proof.jpg' }];
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /close incident/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /close incident/i })).toBeEnabled();
    await userEvent.click(within(dialog).getByRole('button', { name: /close incident/i }));
    expect(mutations.transition.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it('retries closing after an uploaded proof and a failed status update', async () => {
    detailState.data = { ...incident, status: 'Investigating', severity: 'High' };
    mutations.transition.mutateAsync.mockRejectedValueOnce(new Error('network error'));
    uploadEvidence.mockClear().mockResolvedValue({});
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /close incident/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.upload(within(dialog).getByTestId('incident-close-photo-input'), new File(['x'], 'proof.jpg', { type: 'image/jpeg' }));
    await userEvent.click(within(dialog).getByRole('button', { name: /close incident/i }));
    expect(mutations.transition.mutateAsync).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('button', { name: /close incident/i })).toBeEnabled();
    await userEvent.click(within(dialog).getByRole('button', { name: /close incident/i }));
    expect(mutations.transition.mutateAsync).toHaveBeenCalledTimes(2);
    expect(uploadEvidence).toHaveBeenCalledTimes(1);
  });

  it('AC-SIL-011: an open issue past its due time shows Overdue on the record', () => {
    detailState.data = { ...incident, status: 'Open', due_at: '2020-01-01T00:00:00Z' };
    renderPage('Admin');
    expect(screen.getByTestId('incident-pills')).toHaveTextContent(/overdue/i);
  });

  it('AC-SIL-013: a legacy issue with every new column empty renders without an Overdue badge', () => {
    detailState.data = { ...incident, status: 'Open', due_at: null, assignee_id: null, work_order_id: null, task_id: null };
    renderPage('Admin');
    expect(screen.getByTestId('incident-pills')).not.toHaveTextContent(/overdue/i);
  });

  it('AC-INC-003: a rejected transition (RLS) surfaces a classified warning toast, record unchanged', async () => {
    mutations.transition.mutateAsync.mockRejectedValueOnce(new AppError('permission denied', '42501'));
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /start investigating/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /start investigating/i }));
    // A classified warning toast (role=alert) appears — the failure is surfaced, not swallowed.
    const toast = await findToastAnnouncement('alert', /don't have permission/i);
    expect(toast).toHaveTextContent(/don't have permission/i);
  });

  it('AC-IN-PROJ-010: a linked incident renders a click-to-open Project link to /projects/:id', () => {
    detailState.data = { ...incident, project_id: 'p1' };
    projectOptions.data = [{ value: 'p1', label: 'Eastfield Phase 2' }];
    renderPage('Admin');
    const link = screen.getByRole('link', { name: /open eastfield phase 2/i });
    expect(link).toHaveAttribute('href', '/projects/p1');
  });

  it('AC-IN-PROJ-010: an unlinked incident shows the Project field em-dash, no link', () => {
    detailState.data = { ...incident, project_id: null };
    renderPage('Admin');
    expect(screen.queryByRole('link', { name: /^open /i })).toBeNull();
    // The Project field still renders (with its em-dash fallback).
    expect(screen.getByText('Project')).toBeInTheDocument();
  });

  it('AC-INC-002: a Closed incident shows no advance action and renders an empty-description fallback', () => {
    detailState.data = { ...incident, status: 'Closed', description: null, location: null };
    renderPage('Admin');
    expect(screen.queryByTestId('incident-advance')).toBeNull();
    expect(screen.getByText(/no description was recorded/i)).toBeInTheDocument();
    // The empty location renders the em-dash fallback in the field list.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
