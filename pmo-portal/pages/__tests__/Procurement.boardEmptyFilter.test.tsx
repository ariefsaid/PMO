/**
 * C-PR-1 — Procurement board empty-filter state.
 * AC-C-PR-1: when filtered.length===0 in board view, renders a single ListState
 * "No requests match your filters" instead of 7 empty stage columns.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

const { procState, viewState } = vi.hoisted(() => ({
  procState: {
    // One Requested row; filtering by Paid will yield 0 matches
    data: [
      {
        id: 'pr1',
        title: 'Crane hire',
        code: 'PR-001',
        status: 'Requested',
        total_value: 5000,
        created_at: '2026-06-01T00:00:00Z',
        project: { name: 'Harbour', code: 'H001' },
        requested_by_id: 'u1',
        requested_by: { full_name: 'Alice' },
      },
    ] as Array<Record<string, unknown>>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  // Force board view so we see the board rendering path
  viewState: { view: 'board' as const, setView: vi.fn() },
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState }));
vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useCreateProcurement: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurementView', () => ({
  useProcurementView: () => [viewState.view, viewState.setView],
  readProcurementView: () => 'board',
}));

import Procurement from '../Procurement';

const renderPage = (search = '') =>
  render(
    <MemoryRouter initialEntries={[`/procurement${search}`]}>
      <ImpersonationProvider realRole="Project Manager">
        <ToastProvider>
          <Procurement />
        </ToastProvider>
      </ImpersonationProvider>
    </MemoryRouter>,
  );

describe('AC-C-PR-1: board view empty-filter state (no 7 empty columns)', () => {
  it('AC-C-PR-1: board view with zero filter results shows "No requests match your filters"', () => {
    // URL param ?status=Paid filters the single Requested row out → 0 rows
    renderPage('?status=Paid');

    // The empty ListState must be shown, not 7 stage columns
    expect(screen.getByText(/No requests match your filters/i)).toBeInTheDocument();
    // The 7 stage columns must NOT be rendered
    expect(screen.queryByTestId('prstage-pr')).toBeNull();
    expect(screen.queryByTestId('prstage-vq')).toBeNull();
  });

  it('AC-C-PR-1: board view with matching results renders stage columns (not empty state)', () => {
    // No filter → all rows show → board renders
    renderPage();

    // With no filter the single Requested row is present → board columns render
    // "No requests match your filters" must NOT appear when there are results
    expect(screen.queryByText(/No requests match your filters/i)).toBeNull();
    // The board stage column for "Purchase Request" should render
    expect(screen.getByTestId('prstage-pr')).toBeInTheDocument();
  });
});
