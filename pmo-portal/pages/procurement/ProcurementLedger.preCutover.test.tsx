/**
 * FR-ECA-030 / AC-ECA-020 — a purchase ordered before the ERP connection says so in the ledger, wherever its push
 * state would show: "Recorded before the ERP connection, not sent". Information, not an alert; absent otherwise.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

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
import { clearOwnershipCache, setTaskOwnership } from '@/src/lib/adapterSeam/ownershipCache';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';

function makeDetail(extra: Partial<ProcurementDetail>): ProcurementDetail {
  return {
    id: 'proc-1', org_id: 'org-1', title: 'Test Procurement', status: 'Ordered', code: 'PROC-001',
    created_at: '2026-01-01T00:00:00Z', total_value: 0, pr_number: null, vq_number: null, po_number: null,
    project_id: null, vendor_id: null, requested_by_id: null, approved_by_id: null, approval_notes: null,
    rejection_notes: null, project: null, vendor: null, requested_by: null, approved_by: null, items: [],
    quotations: [], receipts: [], invoices: [], purchase_requests: [], rfqs: [], purchase_orders: [],
    payments: [], statusEvents: [], ...extra,
  } as unknown as ProcurementDetail;
}

function renderLedger(extra: Partial<ProcurementDetail>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProcurementLedger detail={makeDetail(extra)} rows={[]} procurementId="proc-1" uploadedById="user-pm" canWrite />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setTaskOwnership([{ domain: 'procurement', externalTier: 'erpnext' }]);
});
afterEach(() => clearOwnershipCache());

describe('ProcurementLedger — the pre-connection purchase label (FR-ECA-030)', () => {
  it('a purchase ordered before the connection says its records are not sent, as information', () => {
    renderLedger({ pre_cutover: true });
    const note = screen.getByTestId('ledger-pre-cutover');
    expect(note).toHaveTextContent('Recorded before the ERP connection, not sent');
    expect(note.getAttribute('role')).not.toBe('alert');
  });

  it('a purchase ordered after the connection shows no such label', () => {
    renderLedger({ pre_cutover: false });
    expect(screen.queryByTestId('ledger-pre-cutover')).not.toBeInTheDocument();
  });

  it('an org that does not employ procurement shows none (the flag is never set there)', () => {
    clearOwnershipCache();
    renderLedger({});
    expect(screen.queryByTestId('ledger-pre-cutover')).not.toBeInTheDocument();
  });
});
