import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcurementLedger } from './ProcurementLedger';
import type { LedgerRow } from '@/src/lib/db/procurementLedger';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';
import { AppError } from '@/src/lib/appError';
import { formatDay } from '@/src/lib/format';

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
const voidBill = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
const subcontractArgs = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock('@/src/hooks/useSubcontract', () => ({
  useSubcontractMutations: (...args: unknown[]) => { subcontractArgs.calls.push(args); return { voidBill }; },
}));
vi.mock('@/src/lib/db/procurementFiles', () => ({ listProcurementFiles: vi.fn(), getSignedDownloadUrl: vi.fn() }));

const detail = { id: 'proc-1', status: 'Vendor Invoiced', created_at: '2026-11-01T00:00:00Z', is_subcontract: true, purchase_orders: [{ id: 'po-1' }] } as unknown as ProcurementDetail;
const bill: LedgerRow = {
  id: 'Invoice-vi-1', date: '2026-11-01', type: 'Invoice', systemNumber: 'VI-1', externalRef: null,
  amount: 10000000, status: 'Received', statusVariant: 'neutral', fileHref: null, fileTitle: null, fileCount: 0,
  financial: true, recordId: 'vi-1', currency: 'IDR', taxTreatment: 'exclusive',
  efakturNumber: null, efakturDate: null, efakturLocked: false, voidable: true, voided: null, poId: 'po-1',
};

function renderLedger(props: Partial<React.ComponentProps<typeof ProcurementLedger>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter><QueryClientProvider client={queryClient}>
      <ProcurementLedger
        detail={detail} rows={[bill]} procurementId="proc-1" uploadedById={null}
        canWrite={false} invoices={[]} {...props}
      />
    </QueryClientProvider></MemoryRouter>,
  );
}

function openMenu() {
  fireEvent.click(screen.getAllByRole('button', { name: 'Row actions' })[0]);
}

describe('ProcurementLedger — void a mistyped subcontract bill (#1671)', () => {
  beforeEach(() => { voidBill.mutateAsync.mockReset(); subcontractArgs.calls = []; });

  it('AC-SCV-008 Finance is offered "Void bill" on a live PMO-native subcontract bill; confirming sends the trimmed reason', async () => {
    voidBill.mutateAsync.mockResolvedValue(undefined);
    renderLedger({ canVoidBill: true });
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Void bill' }));
    expect(subcontractArgs.calls[0]).toEqual(['po-1', 'proc-1']);
    const dialog = screen.getByRole('alertdialog');
    fireEvent.change(within(dialog).getByLabelText(/Why is this bill being voided\?/), { target: { value: '  typed 12 instead of 2  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Void bill' }));
    await waitFor(() => expect(voidBill.mutateAsync).toHaveBeenCalledWith({ invoiceId: 'vi-1', reason: 'typed 12 instead of 2' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('AC-SCV-008 the action is not offered without the void permission, on a voided bill, or on a bill that cannot be voided', () => {
    const noRole = renderLedger({ canVoidBill: false });
    openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Void bill' })).not.toBeInTheDocument();
    noRole.unmount();
    const erp = renderLedger({ canVoidBill: true, rows: [{ ...bill, voidable: false }] });
    openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Void bill' })).not.toBeInTheDocument();
    erp.unmount();
    renderLedger({
      canVoidBill: true,
      rows: [{ ...bill, voidable: false, voided: { at: '2026-11-03T04:05:06Z', reason: 'duplicate', byName: 'Finance Two' } }],
    });
    openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Void bill' })).not.toBeInTheDocument();
  });

  it('AC-SCV-008 a voided bill reads "Voided" with the reason, who voided it and when', () => {
    renderLedger({ rows: [{ ...bill, voidable: false, voided: { at: '2026-11-03T04:05:06Z', reason: 'typed 12 instead of 2', byName: 'Finance Two' } }] });
    const row = screen.getByText('VI-1').closest('tr')!;
    expect(within(row).getByText('Voided')).toBeInTheDocument();
    expect(within(row).getByText('typed 12 instead of 2')).toBeInTheDocument();
    expect(within(row).getByText(new RegExp(`Finance Two.*${formatDay('2026-11-03T04:05:06Z').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))).toBeInTheDocument();
  });

  it('AC-SCV-008 a server refusal is said in words and the dialog stays open', async () => {
    voidBill.mutateAsync.mockRejectedValue(
      new AppError('separation of duties: the person who captured this bill cannot void it', '42501', 'void-own-bill'),
    );
    renderLedger({ canVoidBill: true });
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Void bill' }));
    const dialog = screen.getByRole('alertdialog');
    fireEvent.change(within(dialog).getByLabelText(/Why is this bill being voided\?/), { target: { value: 'mistyped' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Void bill' }));
    expect(await within(dialog).findByText('You captured this bill, so another Admin or Finance user must void it.')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});
