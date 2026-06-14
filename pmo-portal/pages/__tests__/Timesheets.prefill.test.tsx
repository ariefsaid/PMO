import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

/**
 * AC-IFW-TASKS-02 — Timesheets page consumes `?project=<id>` URL param
 * and auto-adds the project as a grid row without manual picker use.
 *
 * Lens-D regression invariant: Timesheets consumes `?project=<id>` to
 * pre-add a project row on load.
 */

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-self', org_id: 'org-1' }, role: 'Engineer' }),
}));

const { sheetsState, projectsState } = vi.hoisted(() => ({
  sheetsState: {
    data: [] as Array<Record<string, unknown>>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  projectsState: {
    data: [] as Array<Record<string, unknown>>,
    isPending: false,
  },
}));

vi.mock('@/src/hooks/useTimesheets', () => ({
  useTimesheets: () => sheetsState,
}));

vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetMutations: () => ({
    submit: { mutate: vi.fn(), isPending: false },
    reopen: { mutate: vi.fn(), isPending: false },
  }),
  useTimesheetsAwaitingApproval: () => ({ data: [] }),
}));

vi.mock('@/src/hooks/useTimesheetEntries', () => ({
  useTimesheetEntryMutations: () => ({
    saveWeek: { mutate: vi.fn(), isPending: false },
    deleteRow: { mutate: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => projectsState,
}));

vi.mock('@/src/auth/impersonation', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/auth/impersonation')>();
  return {
    ...real,
    useEffectiveRole: () => ({ realRole: 'Engineer', effectiveRole: 'Engineer' }),
  };
});

import TimesheetsPage from '../Timesheets';

const solarProject = {
  id: 'p-solar-1',
  name: 'Meridian Solar Phase 1',
  code: 'SP-2401',
  status: 'Ongoing Project',
  client_id: 'cd-1',
  project_manager_id: 'pm-1',
  contract_value: 500000,
  start_date: '2024-01-01',
  end_date: '2025-12-31',
  client: { name: 'Meridian Steelworks' },
  pm: { full_name: 'Diego PM' },
};

const renderAtUrl = (url: string) =>
  render(
    <ImpersonationProvider realRole="Engineer">
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/timesheets" element={
            <ToastProvider>
              <TimesheetsPage />
            </ToastProvider>
          } />
        </Routes>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  sheetsState.data = [];
  sheetsState.isPending = false;
  sheetsState.isError = false;
  projectsState.data = [solarProject];
  projectsState.isPending = false;
  sheetsState.refetch.mockClear();
});

describe('Timesheets — ?project= prefill (AC-IFW-TASKS-02)', () => {
  it('AC-IFW-TASKS-02: when ?project=<id> is present, the project is auto-added (grid is not empty)', async () => {
    renderAtUrl('/timesheets?project=p-solar-1');
    // After prefill the empty-state div should be gone (a row was added)
    await waitFor(() => {
      expect(screen.queryByTestId('timesheets-empty')).not.toBeInTheDocument();
    });
  });

  it('AC-IFW-TASKS-02: when ?project=<unknown-id> is present, the grid stays empty (guard)', async () => {
    // Project "p-unknown" is not in allProjects — addProject should be a no-op
    renderAtUrl('/timesheets?project=p-unknown');
    // Grid should remain empty
    await waitFor(() => {
      expect(screen.getByTestId('timesheets-empty')).toBeInTheDocument();
    });
  });

  it('AC-IFW-TASKS-02: without ?project param, grid stays empty (no auto-add)', async () => {
    renderAtUrl('/timesheets');
    // No ?project param → no prefill → grid stays empty
    await waitFor(() => {
      expect(screen.getByTestId('timesheets-empty')).toBeInTheDocument();
    });
  });
});
