import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';

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
  mutations.update.mutateAsync.mockClear().mockResolvedValue(undefined);
  mutations.transition.mutateAsync.mockClear().mockResolvedValue(undefined);
  realRole = 'Admin';
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
    // A classified warning toast (role=status) appears — the failure is surfaced, not swallowed.
    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent(/don't have permission/i);
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
