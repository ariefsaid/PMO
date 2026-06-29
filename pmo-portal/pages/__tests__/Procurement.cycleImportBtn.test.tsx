/**
 * AC-E15-E17: "Import cycle data" button — render assertion (ADR-0010 unit layer).
 *
 * The e2e journey covers the import flow end-to-end; this unit test asserts
 * the button renders and is enabled for a canCreate role (ADR-0010 rule: each AC
 * at the lowest sufficient layer — render assertion belongs here, journey in e2e).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';

const { procState, createState } = vi.hoisted(() => ({
  procState: {
    data: [
      {
        id: 'pr1',
        title: 'Test Request',
        code: 'PR-001',
        status: 'Requested',
        total_value: 5000,
        created_at: '2026-06-01T00:00:00Z',
        project: { name: 'Harbour' },
        requested_by_id: 'u-admin',
        requested_by: { full_name: 'Admin User' },
      },
    ] as Array<Record<string, unknown>>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  createState: { mutateAsync: vi.fn() },
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-admin', org_id: 'org-1' }, role: 'Admin' }),
}));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [] }),
  useVendorOptions: () => ({ data: [] }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState }));
vi.mock('@/src/hooks/useProcurementCrud', () => ({ useCreateProcurement: () => createState }));
vi.mock('@/src/hooks/useProcurementView', () => ({
  useProcurementView: () => ['table', vi.fn()],
}));

import ProcurementPage from '../../pages/Procurement';

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

beforeEach(() => {
  procState.isPending = false;
  procState.isError = false;
});

describe('Procurement — Import cycle data button (AC-E15-E17)', () => {
  it('AC-E15-E17: renders "Import cycle data" button (not "Import cycle") for a canCreate Admin role', () => {
    renderAs('Admin');
    // E15: new label "Import cycle data"
    expect(screen.getByRole('button', { name: /import cycle data/i })).toBeInTheDocument();
    // Confirm the old label is gone
    expect(screen.queryByRole('button', { name: /^import cycle$/i })).not.toBeInTheDocument();
  });

  it('AC-E15-E17: "Import cycle data" button is enabled for a canCreate Admin', () => {
    renderAs('Admin');
    const btn = screen.getByRole('button', { name: /import cycle data/i });
    expect(btn).toBeEnabled();
  });

  it('AC-E15-E17: "Import cycle data" button is also visible for Engineer (any member can raise)', () => {
    renderAs('Engineer');
    // Engineers CAN create procurement (any member may raise a PR — policy.test line 30).
    // The button is shown (canCreate=true for Engineer).
    expect(screen.getByRole('button', { name: /import cycle data/i })).toBeInTheDocument();
  });
});
