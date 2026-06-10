/**
 * AC-IXD-DASH-W5-C2A — Procurement page URL param read-on-mount
 *
 * Tests:
 * 1. ?status=Vendor+Invoiced on mount sets the Vendor Invoiced filter (shows only VI PRs)
 * 2. Backward-compatible: no param => default behavior (All) unchanged
 * 3. Existing segment values still work
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
import type { Role } from '@/src/auth/AuthContext';

vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({
    data: [
      { id: 'pr1', status: 'Vendor Invoiced', total_value: 100_000, title: 'Invoice Request', code: 'VI-001', requested_by_id: 'u1', requested_by: { full_name: 'Alice' }, project: { name: 'Alpha' }, created_at: '2026-06-01T00:00:00Z' },
      { id: 'pr2', status: 'Paid', total_value: 50_000, title: 'Paid Request', code: 'PD-001', requested_by_id: 'u1', requested_by: { full_name: 'Alice' }, project: { name: 'Beta' }, created_at: '2026-06-02T00:00:00Z' },
      { id: 'pr3', status: 'Draft', total_value: 20_000, title: 'Draft Request', code: 'DR-001', requested_by_id: 'u1', requested_by: { full_name: 'Alice' }, project: { name: 'Gamma' }, created_at: '2026-06-03T00:00:00Z' },
    ],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useCreateProcurement: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/src/hooks/useProcurementView', () => ({
  useProcurementView: () => ['table', vi.fn()] as ['table', () => void],
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Finance' }),
}));

import ProcurementPage from '../Procurement';

const renderWithUrl = (url: string, role: Role = 'Finance') =>
  render(
    <ImpersonationProvider realRole={role}>
      <MemoryRouter initialEntries={[url]}>
        <ToastProvider>
          <ProcurementPage />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Procurement page — URL param read-on-mount (AC-IXD-DASH-W5-C2A)', () => {
  it('AC-IXD-DASH-W5-C2A-PROC-1: backward-compatible — no param shows All (all 3 rows visible)', () => {
    renderWithUrl('/procurement');
    expect(screen.getAllByText('Invoice Request')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Paid Request')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Draft Request')[0]).toBeInTheDocument();
  });

  it('AC-IXD-DASH-W5-C2A-PROC-2: ?status=Vendor+Invoiced shows only Vendor Invoiced rows', () => {
    renderWithUrl('/procurement?status=Vendor+Invoiced');
    expect(screen.getAllByText('Invoice Request')[0]).toBeInTheDocument();
    expect(screen.queryByText('Paid Request')).not.toBeInTheDocument();
    expect(screen.queryByText('Draft Request')).not.toBeInTheDocument();
  });

  it('AC-IXD-DASH-W5-C2A-PROC-3: ?status=Paid maps to Paid segment (Paid row visible, others not)', () => {
    renderWithUrl('/procurement?status=Paid');
    expect(screen.getAllByText('Paid Request')[0]).toBeInTheDocument();
    expect(screen.queryByText('Invoice Request')).not.toBeInTheDocument();
    expect(screen.queryByText('Draft Request')).not.toBeInTheDocument();
  });
});
