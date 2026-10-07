import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

/** `siNumber`'s cell under the column headed `header`. */
function cellOf(siNumber: string, header: string): HTMLElement {
  const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
  const col = headers.indexOf(header);
  expect(col).toBeGreaterThanOrEqual(0);
  const row = screen.getByText(siNumber).closest('tr');
  if (!row) throw new Error(`no table row for ${siNumber}`);
  return within(row).getAllByRole('cell')[col];
}

function renderAs(role: Role) {
  return render(
    <ImpersonationProvider realRole={role}>
      <MemoryRouter><ToastProvider><SalesInvoices /></ToastProvider></MemoryRouter>
    </ImpersonationProvider>,
  );
}

beforeEach(() => {
  h.invoices = [invoice('one', 'Submitted', '010.001-26.12345678', '2026-09-28'), invoice('two', 'Draft', null, null)];
  h.setEfaktur.mockReset().mockResolvedValue(undefined);
});

describe('SalesInvoices e-Faktur details', () => {
  it('AC-EFK-004 shows number + date in ONE e-Faktur cell after Due Date, and an honest dash when empty', () => {
    renderAs('Finance');
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
    // one merged column (a second one pushed the row ⋯ trigger out of the 1440 view), placed after Due Date
    expect(headers).not.toContain('e-Faktur number');
    expect(headers).not.toContain('e-Faktur date');
    expect(headers.indexOf('e-Faktur')).toBe(headers.indexOf('Due Date') + 1);

    const cell = cellOf('SI-one', 'e-Faktur');
    const number = within(cell).getByText('010.001-26.12345678');
    expect(number).toHaveClass('font-mono'); // machine-ID style, as Invoice #
    // the e-Faktur date is its own fact (not the 2026-10-01 invoice date), as a muted second line
    const date = within(cell).getByText(formatDateOnly('2026-09-28'));
    expect(date).toHaveClass('text-muted-foreground');
    expect(cellOf('SI-two', 'e-Faktur').textContent?.trim()).toBe('—');
  });

  it('AC-EFK-004 offers Record e-Faktur to Finance/Admin across Draft, Submitted, and Paid but not PM/Executive', () => {
    h.invoices = [invoice('draft', 'Draft', null, null), invoice('issued', 'Submitted', null, null), invoice('paid', 'Paid', null, null)];
    for (const role of ['Finance', 'Admin'] as const) {
      const { unmount } = renderAs(role);
      for (const id of ['draft', 'issued', 'paid']) {
        const row = screen.getByText(`SI-${id}`).closest('tr');
        if (!row) throw new Error(`no table row for SI-${id}`);
        fireEvent.click(within(row).getByRole('button', { name: 'Row actions' }));
        expect(screen.getByRole('menuitem', { name: 'Record e-Faktur' })).toBeInTheDocument();
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      }
      unmount();
    }
    renderAs('Project Manager');
    expect(screen.queryByRole('button', { name: 'Row actions' })).not.toBeInTheDocument();
  });

  it('AC-EFK-004 does not offer e-Faktur editing on cancelled invoices', () => {
    h.invoices = [invoice('cancelled', 'Cancelled', '010-01', '2026-10-01')];
    renderAs('Finance');
    expect(screen.queryByRole('button', { name: 'Row actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Record e-Faktur' })).not.toBeInTheDocument();
  });

  it('AC-EFK-004 saves trimmed values through setEfaktur and keeps a classified failure in the open dialog', async () => {
    renderAs('Finance');
    fireEvent.click(screen.getAllByRole('button', { name: 'Row actions' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Record e-Faktur' }));
    fireEvent.change(screen.getByLabelText('e-Faktur number'), { target: { value: ' 010.001-26.12345678 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.setEfaktur).toHaveBeenCalledWith({
      siId: 'one', efakturNumber: '010.001-26.12345678', efakturDate: '2026-09-28',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    h.setEfaktur.mockRejectedValueOnce(Object.assign(new Error('save refused'), { code: '42501' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Row actions' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Record e-Faktur' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert', { name: 'Save failed' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
