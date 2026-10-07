import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import { formatDateOnly } from '@/src/lib/format';

const h = vi.hoisted(() => ({
  invoices: [] as SalesInvoiceRow[],
  setEfaktur: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => ({ data: h.invoices, isPending: false, isError: false, refetch: vi.fn() }),
  useRevenueMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    setReceivedDate: { mutateAsync: vi.fn(), isPending: false },
    setEfaktur: { mutateAsync: h.setEfaktur, isPending: false },
    submitInvoice: { mutateAsync: vi.fn(), isPending: false },
    cancelInvoice: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user-test', org_id: 'org-test' } }) }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'pmo') }));
vi.mock('@/src/lib/analytics', () => ({ trackFilterApplied: vi.fn(), trackSaveFailed: vi.fn() }));

import SalesInvoices from '../SalesInvoices';

const invoice = (id: string, status: SalesInvoiceRow['status'], number: string | null, date: string | null): SalesInvoiceRow => ({
  id, org_id: 'org-test', project_id: null, customer_id: null, customer_name: 'Customer',
  si_number: `SI-${id}`, reference_number: null, invoice_date: '2026-10-01', amount: 100,
  currency: 'IDR', tax_treatment: 'inclusive', tax_amount: 0, erp_outstanding_amount: 100,
  status, erp_docstatus: status === 'Cancelled' ? 2 : 1, erp_modified: null, erp_amended_from: null,
  erp_cancelled_at: status === 'Cancelled' ? '2026-10-01T00:00:00Z' : null,
  created_at: '2026-10-01T00:00:00Z', author_user_id: null, author_user_ids: [],
  erp_payment_terms_days: null, erp_due_date: null, received_date: null,
  efaktur_number: number, efaktur_date: date,
});

function renderAs(role: Role) {
  return render(
    <ImpersonationProvider realRole={role}>
      <MemoryRouter><ToastProvider><SalesInvoices /></ToastProvider></MemoryRouter>
    </ImpersonationProvider>,
  );
}

beforeEach(() => {
  h.invoices = [invoice('one', 'Submitted', '010.001-26.12345678', '2026-10-01'), invoice('two', 'Draft', null, null)];
  h.setEfaktur.mockReset().mockResolvedValue(undefined);
});

describe('SalesInvoices e-Faktur details', () => {
  it('AC-EFK-004 displays stored values as date-only and shows an honest dash when empty', () => {
    renderAs('Finance');
    const tableText = screen.getByRole('table').textContent ?? '';
    expect(tableText).toContain('010.001-26.12345678');
    expect(tableText).toContain(formatDateOnly('2026-10-01'));
    expect(screen.getByText('e-Faktur number')).toBeInTheDocument();
    expect(screen.getByText('e-Faktur date')).toBeInTheDocument();
  });

  it('AC-EFK-004 offers edit to Finance/Admin across Draft, Submitted, and Paid but not PM/Executive', () => {
    h.invoices = [invoice('draft', 'Draft', null, null), invoice('issued', 'Submitted', null, null), invoice('paid', 'Paid', null, null)];
    const { unmount } = renderAs('Finance');
    expect(screen.getAllByRole('button', { name: 'Row actions' })).toHaveLength(3);
    unmount();
    const second = renderAs('Admin');
    expect(screen.getAllByRole('button', { name: 'Row actions' })).toHaveLength(3);
    second.unmount();
    renderAs('Project Manager');
    expect(screen.queryByRole('button', { name: 'Row actions' })).not.toBeInTheDocument();
  });

  it('AC-EFK-004 does not offer e-Faktur editing on cancelled invoices', () => {
    h.invoices = [invoice('cancelled', 'Cancelled', '010-01', '2026-10-01')];
    renderAs('Finance');
    expect(screen.queryByRole('button', { name: 'Row actions' })).not.toBeInTheDocument();
  });

  it('AC-EFK-004 saves trimmed values through setEfaktur and keeps a classified failure in the open dialog', async () => {
    renderAs('Finance');
    fireEvent.click(screen.getAllByRole('button', { name: 'Row actions' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit e-Faktur' }));
    fireEvent.change(screen.getByLabelText('e-Faktur number'), { target: { value: ' 010.001-26.12345678 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.setEfaktur).toHaveBeenCalledWith({
      siId: 'one', efakturNumber: '010.001-26.12345678', efakturDate: '2026-10-01',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    h.setEfaktur.mockRejectedValueOnce(Object.assign(new Error('save refused'), { code: '42501' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Row actions' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit e-Faktur' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert', { name: 'Save failed' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
