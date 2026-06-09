import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';

/**
 * B-2 (AC-W2-IXD-003 part 2 / D5): Finance's Procurement view offers a
 * "Needs approval" segment surfacing Requested PRs awaiting their approval.
 *
 * Finance (and PM) can approve procurement requests (Requested → Approved/Rejected).
 * Without this segment they must hunt the mixed status table to find actionable items.
 * The segment filter shows only Requested-status PRs (the ones needing approval action).
 *
 * Per the plan: add a "Needs approval" segment/filter to Procurement.tsx for Finance/PM.
 */

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

const { procState } = vi.hoisted(() => ({
  procState: {
    data: [
      { id: 'pr1', title: 'Pending PR', code: 'PR-001', status: 'Requested', total_value: 5000, created_at: '2026-01-01', project: { name: 'Project A' }, requested_by: { full_name: 'Alice' } },
      { id: 'pr2', title: 'Draft PR', code: 'PR-002', status: 'Draft', total_value: 1000, created_at: '2026-01-02', project: { name: 'Project B' }, requested_by: { full_name: 'Bob' } },
    ] as Array<Record<string, unknown>>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState }));
vi.mock('@/src/hooks/useProcurementCrud', () => ({ useCreateProcurement: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/src/hooks/useProcurementView', () => ({ useProcurementView: () => ['table', vi.fn()] }));

import ProcurementPage from '../Procurement';

const renderAs = (realRole: Role) =>
  render(
    <ImpersonationProvider realRole={realRole}>
      <MemoryRouter>
        <ToastProvider>
          <ProcurementPage />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

describe('Procurement — Finance "Needs approval" segment (B-2, AC-W2-IXD-003)', () => {
  it('AC-W2-IXD-003: Finance sees a "Needs approval" tab in the Status filter (ViewToggle)', () => {
    renderAs('Finance');
    // ViewToggle uses role="tab" for its segment items.
    expect(screen.getByRole('tab', { name: /needs approval/i })).toBeInTheDocument();
  });

  it('AC-W2-IXD-003: a PM also sees the "Needs approval" tab segment', () => {
    renderAs('Project Manager');
    expect(screen.getByRole('tab', { name: /needs approval/i })).toBeInTheDocument();
  });

  it('AC-W2-IXD-003: an Engineer does NOT see the "Needs approval" segment (cannot approve)', () => {
    renderAs('Engineer');
    expect(screen.queryByRole('tab', { name: /needs approval/i })).not.toBeInTheDocument();
  });
});
