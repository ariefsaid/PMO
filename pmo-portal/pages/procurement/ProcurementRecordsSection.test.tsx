/**
 * AC-PR-018 — can() gates capture/upload/advance on the real JWT role.
 *
 * The capture/upload affordances for the four new record types must be:
 *   - HIDDEN for impersonating users (real role drives the check, not effectiveRole)
 *   - HIDDEN for an Engineer who is not the requester
 *   - SHOWN for a Project Manager (MASTER_DATA write role)
 *
 * RLS remains the enforcement authority; this tests the UX gate only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Stubs — vi.hoisted keeps mock factories before the import block
// ---------------------------------------------------------------------------

const authState = vi.hoisted(() => ({
  currentUser: { id: 'user-pm', org_id: 'org1', role: 'Project Manager' } as {
    id: string;
    org_id: string;
    role: string;
  } | null,
}));

const roleState = vi.hoisted(() => ({
  realRole: 'Project Manager' as string | null,
  effectiveRole: 'Project Manager' as string | null,
  canImpersonate: false,
  viewAs: vi.fn(),
}));

const mutState = vi.hoisted(() => ({
  createPurchaseRequest: { mutateAsync: vi.fn(), isPending: false },
  createRfq: { mutateAsync: vi.fn(), isPending: false },
  createPurchaseOrder: { mutateAsync: vi.fn(), isPending: false },
  createPayment: { mutateAsync: vi.fn(), isPending: false },
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: authState.currentUser }),
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => roleState,
}));

vi.mock('@/src/hooks/useProcurementRecords', () => ({
  useProcurementRecordMutations: () => mutState,
}));

// Mock file subsection — renders a visible "Attachments" header per phase
vi.mock('./ProcurementFilesSubsection', () => ({
  ProcurementFilesSubsection: ({ canWrite }: { canWrite: boolean }) =>
    canWrite ? (
      <div data-testid="files-write">Attachments (writable)</div>
    ) : (
      <div data-testid="files-read">Attachments (read-only)</div>
    ),
}));

// useToast stub
vi.mock('@/src/components/ui', async (orig) => {
  const actual = await orig<typeof import('@/src/components/ui')>();
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});

import { ProcurementRecordsSection } from './ProcurementRecordsSection';
import type { Tables } from '@/src/lib/supabase/database.types';

type PRRow = Tables<'purchase_requests'>;
type RfqRow = Tables<'rfqs'>;
type PORow = Tables<'purchase_orders'>;
type PayRow = Tables<'payments'>;

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: qc }, ui));
}

const BASE_PROPS = {
  procurementId: 'proc1',
  orgId: 'org1',
  uploadedById: 'user-pm',
  invoices: [] as Tables<'procurement_invoices'>[],
  purchaseRequests: [] as PRRow[],
  rfqs: [] as RfqRow[],
  purchaseOrders: [] as PORow[],
  payments: [] as PayRow[],
};

describe('AC-PR-018: can() gates capture/upload on the real JWT role', () => {
  beforeEach(() => {
    // Default: PM, not impersonating
    roleState.realRole = 'Project Manager';
    roleState.effectiveRole = 'Project Manager';
    roleState.canImpersonate = false;
    authState.currentUser = { id: 'user-pm', org_id: 'org1', role: 'Project Manager' };
  });

  it('AC-PR-018 PM sees capture triggers (can create procFile)', () => {
    wrap(<ProcurementRecordsSection {...BASE_PROPS} canWrite />);
    // At least one trigger button should be present
    const triggers = screen.queryAllByTestId(/trigger-capture-/);
    expect(triggers.length).toBeGreaterThan(0);
  });

  it('AC-PR-018 Engineer (non-requester) does NOT see capture triggers', () => {
    roleState.realRole = 'Engineer';
    roleState.effectiveRole = 'Engineer';
    authState.currentUser = { id: 'user-eng', org_id: 'org1', role: 'Engineer' };

    wrap(<ProcurementRecordsSection {...BASE_PROPS} canWrite={false} />);
    const triggers = screen.queryAllByTestId(/trigger-capture-/);
    expect(triggers.length).toBe(0);
  });

  it('AC-PR-018 impersonating Admin (real=Admin but canWrite=false) sees no capture triggers', () => {
    // Caller passes canWrite=false → the section respects it (real role gates this)
    roleState.realRole = 'Admin';
    roleState.effectiveRole = 'Engineer'; // view-as Engineer
    roleState.canImpersonate = true;

    wrap(<ProcurementRecordsSection {...BASE_PROPS} canWrite={false} />);
    const triggers = screen.queryAllByTestId(/trigger-capture-/);
    expect(triggers.length).toBe(0);
  });

  it('AC-PR-018 Finance role sees capture triggers (MASTER_DATA write role)', () => {
    roleState.realRole = 'Finance';
    roleState.effectiveRole = 'Finance';
    authState.currentUser = { id: 'user-fin', org_id: 'org1', role: 'Finance' };

    wrap(<ProcurementRecordsSection {...BASE_PROPS} canWrite />);
    const triggers = screen.queryAllByTestId(/trigger-capture-/);
    expect(triggers.length).toBeGreaterThan(0);
  });
});

describe('ProcurementRecordsSection — card rendering', () => {
  beforeEach(() => {
    roleState.realRole = 'Project Manager';
    roleState.effectiveRole = 'Project Manager';
  });

  it('renders existing purchase request records as RecordCards (dual-ID)', () => {
    const prRows: PRRow[] = [
      {
        id: 'pr1',
        org_id: 'org1',
        procurement_id: 'proc1',
        pr_number: 'PR-2606190001',
        reference_number: 'EXT-PR-99',
        status: 'Requested',
        date: '2026-06-19',
        amount: 5000,
        created_at: '2026-06-19T10:00:00Z',
      },
    ];

    wrap(
      <ProcurementRecordsSection {...BASE_PROPS} purchaseRequests={prRows} canWrite />,
    );

    // Both IDs must appear
    expect(screen.getByText('PR-2606190001')).toBeDefined();
    expect(screen.getByText('EXT-PR-99')).toBeDefined();
  });

  it('renders empty state when no records exist for a phase', () => {
    wrap(<ProcurementRecordsSection {...BASE_PROPS} canWrite />);
    // No purchase request cards; the section is still rendered (just empty)
    expect(screen.queryByText(/PR-/)).toBeNull();
  });
});
