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
const { detailState, mutations } = vi.hoisted(() => ({
  detailState: {
    data: undefined as Record<string, unknown> | null | undefined,
    isPending: false,
    isError: false,
    error: null as (Error & { code?: string }) | null,
    refetch: vi.fn(),
  },
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
}));

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
  mutations.update.mutateAsync.mockClear().mockResolvedValue(undefined);
  mutations.transition.mutateAsync.mockClear().mockResolvedValue(undefined);
  realRole = 'Admin';
});

describe('IncidentDetail', () => {
  it('AC-INC-002: keeps identity, severity and status once with the incident evidence', () => {
    renderPage();
    const header = screen.getByTestId('record-header');
    expect(within(header).getByText('Near Miss')).toBeInTheDocument();
    expect(within(header).getByText('High')).toBeInTheDocument();
    expect(within(header).getByText('Open')).toBeInTheDocument();
    expect(screen.getAllByText('Near Miss')).toHaveLength(1);
    expect(screen.getAllByText('High')).toHaveLength(1);
    expect(screen.getAllByText('Open')).toHaveLength(1);
    expect(screen.getByText('Regional Site B')).toBeInTheDocument();
    expect(screen.getByText('Trip hazard near the scaffold')).toBeInTheDocument();
  });

  it('AC-INC-002: the next workflow action follows the reported evidence', () => {
    renderPage();
    const description = screen.getByText('Trip hazard near the scaffold');
    const nextAction = screen.getByRole('button', { name: /start investigating/i });
    expect(Boolean(description.compareDocumentPosition(nextAction) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('AC-INC-002: shows the loading skeleton while the record is pending', () => {
    detailState.data = undefined;
    detailState.isPending = true;
    renderPage();
    expect(screen.getByTestId('incident-loading')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('AC-INC-002: shows a calm not-found state when the record is absent', () => {
    detailState.data = null;
    detailState.isPending = false;
    renderPage();
    expect(screen.getByTestId('incident-not-found')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('AC-INC-002: a transient load error offers Retry', async () => {
    detailState.data = undefined;
    detailState.isError = true;
    renderPage();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const retry = screen.getByRole('button', { name: /retry|try again/i });
    await userEvent.click(retry);
    expect(detailState.refetch).toHaveBeenCalled();
  });

  it.each([
    ['loading', { data: undefined, isPending: true, isError: false }],
    ['not-found', { data: null, isPending: false, isError: false }],
    ['error', { data: undefined, isPending: false, isError: true }],
  ])('AC-INC-002: the %s state keeps a working return to the Incidents register', async (_n, s) => {
    Object.assign(detailState, s);
    renderPage();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: /back to incidents/i }));
    expect(screen.getByText('Incidents index')).toBeInTheDocument();
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
    detailState.data = { ...incident, status: 'Investigating' };
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /close incident/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /close incident/i }));
    expect(mutations.transition.mutateAsync).toHaveBeenCalledWith({ id: 'i1', status: 'Closed' });
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

  it('AC-IN-PROJ-010: an unlinked incident names its project scope without a dead link', () => {
    detailState.data = { ...incident, project_id: null };
    renderPage('Admin');
    expect(screen.queryByRole('link', { name: /^open /i })).toBeNull();
    expect(screen.getByText('Unlinked')).toBeInTheDocument();
  });

  it('AC-INC-002: a Closed incident shows no advance action and renders an empty-description fallback', () => {
    detailState.data = { ...incident, status: 'Closed', description: null, location: null };
    renderPage('Admin');
    expect(screen.queryByTestId('incident-advance')).toBeNull();
    expect(screen.getByText(/no description was recorded/i)).toBeInTheDocument();
    // Missing incident location is named so it is not confused with an omitted field.
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
  });
});
