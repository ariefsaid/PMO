import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor, act } from '@testing-library/react';
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

/** A second ongoing project already present in the existing draft. */
const windmillProject = {
  id: 'p-windmill-2',
  name: 'Windmill Grid Alpha',
  code: 'WG-2402',
  status: 'Ongoing Project',
  client_id: 'cd-2',
  project_manager_id: 'pm-1',
  contract_value: 300000,
  start_date: '2024-02-01',
  end_date: '2025-12-31',
  client: { name: 'Grid Corp' },
  pm: { full_name: 'Diego PM' },
};

/** Compute the Monday (week-start) for a given date — mirrors the page helper. */
function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
  projectsState.data = [solarProject, windmillProject];
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

  it(
    'AC-IFW-TASKS-02: prefilled project survives reseed when sheets load AFTER projects — ' +
    'regression: non-empty saved draft in current week must show BOTH the existing row AND the prefilled row',
    async () => {
      // ── Arrange: projects available immediately; sheets still loading ──────────
      // This simulates the real-world race: allProjects resolves fast (cached),
      // but useTimesheets has not yet returned the saved draft.
      sheetsState.isPending = true;
      sheetsState.data = [];

      const { rerender } = renderAtUrl('/timesheets?project=p-solar-1');

      // Loading spinner while sheets are pending — prefill effect may fire here.
      // (The component short-circuits to the loading skeleton; effects still run.)

      // ── Act: sheets now resolves with a draft that already has windmill ────────
      // seedKey changes: 'none|none|<week>' → 'ts-draft|Draft|<week>'
      // This is the moment the reseed block fires and (before the fix) wipes the
      // just-prefilled solar row from editRows.
      const weekStr = getWeekStart(new Date());
      await act(async () => {
        sheetsState.isPending = false;
        sheetsState.data = [
          {
            id: 'ts-draft',
            user_id: 'u-self',
            week_start_date: weekStr,
            status: 'Draft',
            submitted_at: null,
            approved_by: null,
            approved_at: null,
            org_id: 'org-1',
            entries: [
              {
                id: 'e-1',
                project_id: 'p-windmill-2',
                entry_date: weekStr, // Monday
                hours: 4,
                notes: null,
                project: { name: 'Windmill Grid Alpha', code: 'WG-2402' },
              },
            ],
          },
        ];
        // Trigger re-render so the component picks up the resolved sheets data.
        rerender(
          <ImpersonationProvider realRole="Engineer">
            <MemoryRouter initialEntries={['/timesheets?project=p-solar-1']}>
              <Routes>
                <Route
                  path="/timesheets"
                  element={
                    <ToastProvider>
                      <TimesheetsPage />
                    </ToastProvider>
                  }
                />
              </Routes>
            </MemoryRouter>
          </ImpersonationProvider>,
        );
      });

      // ── Assert: BOTH rows must appear in the editable grid ──────────────────
      // Wait for the loading state to clear and the grid to render.
      await waitFor(() => {
        expect(screen.queryByTestId('timesheets-loading')).not.toBeInTheDocument();
      });
      // The tsgrid-table data-testid scopes us to the grid rows only,
      // excluding the picker <option> elements (which also contain project names).
      const grid = await screen.findByTestId('tsgrid-table');
      const gridView = within(grid);
      // The existing windmill row (from the server draft) must be present in the grid.
      expect(gridView.getByText('Windmill Grid Alpha')).toBeInTheDocument();
      // The prefilled solar row must ALSO be present in the grid (not dropped by reseed).
      expect(gridView.getByText('Meridian Solar Phase 1')).toBeInTheDocument();
      // The empty-state sentinel must not be shown (grid has rows).
      expect(screen.queryByTestId('timesheets-empty')).not.toBeInTheDocument();
    },
  );
});
