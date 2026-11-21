import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcurementLedger } from './ProcurementLedger';
import type { LedgerRow } from '@/src/lib/db/procurementLedger';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';
import { repositories } from '@/src/lib/repositories';
import { subcontractKeys } from '@/src/hooks/useSubcontract';

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'user-finance', org_id: 'org-1', role: 'Finance' } }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Finance', effectiveRole: 'Finance', canImpersonate: false, viewAs: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurementRecords', () => ({
  useProcurementRecordMutations: () => ({
    createPurchaseRequest: { mutateAsync: vi.fn(), isPending: false },
    createRfq: { mutateAsync: vi.fn(), isPending: false },
    createPurchaseOrder: { mutateAsync: vi.fn(), isPending: false },
    createPayment: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));
vi.mock('@/src/hooks/useProcurementFiles', () => ({
  useProcurementFiles: () => ({ list: { data: [], isPending: false, isError: false }, upload: { mutate: vi.fn(), isPending: false }, archive: { mutate: vi.fn(), isPending: false }, download: vi.fn(), progress: null, uploadError: null, cancelUpload: vi.fn(), clearUploadError: vi.fn() }),
}));
vi.mock('@/src/lib/db/procurementFiles', () => ({ listProcurementFiles: vi.fn(), getSignedDownloadUrl: vi.fn() }));

// A purchase with two orders; the mistyped bill was captured against the SECOND one.
const detail = {
  id: 'proc-1', status: 'Vendor Invoiced', created_at: '2026-11-01T00:00:00Z', is_subcontract: true,
  purchase_orders: [{ id: 'po-1' }, { id: 'po-2' }],
} as unknown as ProcurementDetail;
const billOnSecondOrder: LedgerRow = {
  id: 'Invoice-vi-2', date: '2026-11-02', type: 'Invoice', systemNumber: 'VI-2', externalRef: null,
  amount: 5000000, status: 'Received', statusVariant: 'neutral', fileHref: null, fileTitle: null, fileCount: 0,
  financial: true, recordId: 'vi-2', currency: 'IDR', taxTreatment: 'exclusive',
  efakturNumber: null, efakturDate: null, efakturLocked: false, voidable: true, voided: null, poId: 'po-2',
};

afterEach(() => { vi.restoreAllMocks(); });

describe('ProcurementLedger — void refreshes the bill\'s own order (#1671)', () => {
  it('AC-SCV-008 voiding a bill on the second order refreshes that order\'s payable, not only the first order\'s', async () => {
    const voidRpc = vi.spyOn(repositories.subcontracts, 'voidSubcontractBill').mockResolvedValue(undefined as never);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    render(
      <MemoryRouter><QueryClientProvider client={queryClient}>
        <ProcurementLedger
          detail={detail} rows={[billOnSecondOrder]} procurementId="proc-1" uploadedById={null}
          canWrite={false} invoices={[]} canVoidBill
        />
      </QueryClientProvider></MemoryRouter>,
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Row actions' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Void bill' }));
    const dialog = screen.getByRole('alertdialog');
    fireEvent.change(within(dialog).getByLabelText(/Why is this bill being voided\?/), { target: { value: 'typed 12 instead of 2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Void bill' }));

    await waitFor(() => expect(voidRpc).toHaveBeenCalledWith('vi-2', 'typed 12 instead of 2'));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: subcontractKeys.po('org-1', 'po-2') }));
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: subcontractKeys.po('org-1', 'po-1') });
  });
});
