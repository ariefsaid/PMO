/**
 * task FIX-1 (Discover CRITICAL 1) graduation — the RENDERED proof, not just the hook: a flipped
 * ownership map routes a real capture (Purchase Request) through `repositories.procurement.*` (never
 * the direct DAL), and the TaskPushBadge visibly cycles idle -> pushing -> pushed inside the real
 * ProcurementLedger component tree (useProcurementRecordMutations is the REAL hook here, unlike
 * ProcurementLedger.test.tsx's mocked-hook suite).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const authState = { currentUser: { id: 'user-pm', org_id: 'org1', role: 'Project Manager' } };
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => authState }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Project Manager', effectiveRole: 'Project Manager', canImpersonate: false, viewAs: vi.fn() }),
}));
vi.mock('@/src/components/ui', async (orig) => {
  const actual = await orig<typeof import('@/src/components/ui')>();
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});
vi.mock('@/src/hooks/useProcurementFiles', () => ({
  useProcurementFiles: vi.fn(() => ({
    list: { data: [], isPending: false, isError: false },
    upload: { mutate: vi.fn(), isPending: false },
    archive: { mutate: vi.fn(), isPending: false },
    download: vi.fn(async () => 'https://signed/url'),
    progress: null,
    uploadError: null,
    cancelUpload: vi.fn(),
    clearUploadError: vi.fn(),
  })),
}));
vi.mock('@/src/lib/db/procurementFiles', () => ({
  listProcurementFiles: vi.fn(async () => []),
  getSignedDownloadUrl: vi.fn(async (path: string) => `https://cdn.example.com/${path}`),
}));

// The repository seam is the boundary this test proves the hook routes through — mocked here
// (not the DAL), so a call landing on `procurement.createPurchaseRequest` is the routing proof.
const { procurement } = vi.hoisted(() => ({
  procurement: { createPurchaseRequest: vi.fn() },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { procurement } }));

import { ProcurementLedger } from './ProcurementLedger';
import { clearOwnershipCache, setDomainOwnership } from '@/src/lib/adapterSeam/ownershipCache';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';

function makeDetail(): ProcurementDetail {
  return {
    id: 'proc-1', org_id: 'org-1', title: 'Test Procurement', status: 'Draft', code: 'PROC-001',
    created_at: '2026-01-01T00:00:00Z', total_value: 0, pr_number: null, vq_number: null, po_number: null,
    project_id: null, vendor_id: null, requested_by_id: null, approved_by_id: null, approval_notes: null,
    rejection_notes: null, project: null, vendor: null, requested_by: null, approved_by: null, items: [],
    quotations: [], receipts: [], invoices: [], purchase_requests: [], rfqs: [], purchase_orders: [],
    payments: [], statusEvents: [],
  } as unknown as ProcurementDetail;
}

function renderLedger() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProcurementLedger
          detail={makeDetail()}
          rows={[]}
          procurementId="proc-1"
          uploadedById="user-pm"
          canWrite
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setDomainOwnership([{ domain: 'procurement', externalTier: 'erpnext' }]);
});
afterEach(() => clearOwnershipCache());

describe('ProcurementLedger — flipped ownership routes a real capture externally + renders pendingPush', () => {
  it('capturing a Purchase Request calls repositories.procurement.createPurchaseRequest and the badge cycles idle -> pushing -> pushed', async () => {
    let resolveCreate!: (v: unknown) => void;
    procurement.createPurchaseRequest.mockReturnValue(new Promise((res) => (resolveCreate = res)));

    renderLedger();

    // No badge before any write.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    // Open the capture row + submit with defaults (referenceNumber/amount optional).
    fireEvent.click(screen.getByTestId('ledger-capture-open'));
    fireEvent.click(screen.getByTestId('purchase_request-save-btn'));

    // Pushing state renders while the write is in flight.
    await waitFor(() => expect(screen.getByText('Pushing…')).toBeInTheDocument());
    expect(procurement.createPurchaseRequest).toHaveBeenCalledTimes(1);
    expect(procurement.createPurchaseRequest).toHaveBeenCalledWith('proc-1', null, 'Draft', expect.any(String), null);

    // Resolve the external write — the badge converges to Pushed.
    resolveCreate({ id: 'pr-ext-1', pr_number: 'MAT-REQ-2026-00001' });
    await waitFor(() => expect(screen.getByText('Pushed')).toBeInTheDocument());
  });
});
