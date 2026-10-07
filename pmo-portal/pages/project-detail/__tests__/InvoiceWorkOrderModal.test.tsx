import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { AppError } from '@/src/lib/appError';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';

const h = vi.hoisted(() => ({ mutateAsync: vi.fn(), connected: false, mode: 'erp' as 'erp' | 'native' }));
vi.mock('@/src/hooks/useRevenue', () => ({ useRevenueMutations: () => ({ create: { mutateAsync: h.mutateAsync, isPending: false } }) }));
vi.mock('@/src/hooks/useErpItemOptions', () => ({
  useErpItemOptions: () => ({ connected: h.connected, loadOptions: async () => [{ value: 'SVC', label: 'SVC — Services' }] }),
}));
vi.mock('@/src/hooks/useCommandIntent', () => ({ useCommandIntent: () => ({ id: 'intent-1', idempotencyKey: 'key-1' }) }));
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => h.mode }));

import InvoiceWorkOrderModal from '../InvoiceWorkOrderModal';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { financeTestI18n } from '../../__tests__/financeI18nTestInstance';
import { FinanceI18nTestProvider } from '../../__tests__/financeI18nTestProvider';

const WO = { id: 'wo-1', project_id: 'p1', wo_number: 'WO-1', title: 'Phase 1 fabrication', status: 'Issued', currency: 'USD' } as WorkOrderRow;
const onCreated = vi.fn();
const renderModal = (remaining = 80_000, over: Partial<WorkOrderRow> = {}) => render(
  <MemoryRouter>
    <InvoiceWorkOrderModal workOrder={{ ...WO, ...over }} projectId="p1" clientId="c-1" remaining={remaining}
      onClose={vi.fn()} onCreated={onCreated} />
  </MemoryRouter>,
);
const amountInput = () => screen.getByLabelText(/Amount \(excl\. PPN\)/);
const submit = () => userEvent.click(screen.getByRole('button', { name: 'Create draft invoice' }));

beforeEach(() => {
  h.mutateAsync.mockReset();
  h.mutateAsync.mockResolvedValue({ id: 'si-1', si_number: 'ACC-SINV-1' });
  h.connected = false;
  h.mode = 'erp';
  onCreated.mockReset();
});

describe('InvoiceWorkOrderModal (OD-BILL-1)', () => {
  it("AC-BWO-004 pre-fills what is still to invoice and the work order's label", () => {
    renderModal();
    expect(amountInput()).toHaveValue('80,000');
    expect(screen.getByLabelText('Description')).toHaveValue('WO-1 — Phase 1 fabrication');
    expect(screen.getByText('Up to $80,000.00 is still to invoice on this work order.')).toBeInTheDocument();
  });

  it("AC-BWO-004 sends one line linked to the work order, for the project's client", async () => {
    renderModal();
    await userEvent.type(screen.getByLabelText(/Item code/), 'SVC');
    await submit();
    expect(h.mutateAsync).toHaveBeenCalledWith({
      customerId: 'c-1', projectId: 'p1', workOrderId: 'wo-1',
      items: [{ item_code: 'SVC', qty: 1, rate: 80000, description: 'WO-1 — Phase 1 fabrication' }],
      intent: { id: 'intent-1', idempotencyKey: 'key-1' },
    });
    expect(onCreated).toHaveBeenCalledWith('ACC-SINV-1');
  });

  it.each([
    ['80000.01', 'Only $80,000.00 is still to invoice on this work order.'],
    ['0', 'The amount must be more than zero.'],
    ['10.001', 'Enter an amount with no more than 2 decimal places.'],
  ])('AC-BWO-004 refuses %s', async (typed, message) => {
    renderModal();
    await userEvent.type(screen.getByLabelText(/Item code/), 'SVC');
    await userEvent.clear(amountInput());
    await userEvent.type(amountInput(), typed);
    await submit();
    expect((await screen.findAllByText(message)).length).toBeGreaterThan(0);
    expect(h.mutateAsync).not.toHaveBeenCalled();
  });

  it('AC-BWO-004 requires the ERP item', () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Create draft invoice' })).toBeDisabled();
  });

  const REFUSAL = new AppError('this invoice would bill 80000.00 against work order WO-1 (worth 500000.00 excl. tax, with 500000.00 already invoiced or in draft): only 0.00 is still to invoice', 'BW001');
  it('AC-BWO-004 a server refusal stays in the dialog, in the user\'s words with the amount formatted, and raises no second toast', async () => {
    h.mutateAsync.mockRejectedValue(REFUSAL);
    renderModal();
    await userEvent.type(screen.getByLabelText(/Item code/), 'SVC');
    await submit();
    expect(await screen.findByText('That would invoice past the work order')).toBeInTheDocument();
    expect(screen.getByText(/This work order had \$80,000\.00 still to invoice when you opened this dialog/)).toBeInTheDocument();
    expect(screen.queryByText(/only 0\.00 is still to invoice/)).toBeNull();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('AC-BWO-004 the refusal reads in Bahasa with the amount in the Indonesian money format', async () => {
    h.mutateAsync.mockRejectedValue(REFUSAL);
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    await financeTestI18n.changeLanguage('id');
    try {
      render(
        <FinanceI18nTestProvider>
          <InvoiceWorkOrderModal workOrder={{ ...WO, currency: 'IDR' }} projectId="p1" clientId="c-1" remaining={80_000}
            onClose={vi.fn()} onCreated={onCreated} />
        </FinanceI18nTestProvider>,
      );
      await userEvent.type(screen.getByLabelText(/Kode item/), 'SVC');
      await userEvent.click(screen.getByRole('button', { name: 'Buat draf faktur' }));
      expect(await screen.findByText('Tagihan ini akan melewati nilai Work Order')).toBeInTheDocument();
      expect(screen.getByText(/Tidak ada yang ditulis ke ERPNext/)).toHaveTextContent(/Rp\s?80\.000,00/);
      expect(screen.queryByText(/only 0\.00/)).toBeNull();
    } finally {
      resetActiveLocale();
      await financeTestI18n.changeLanguage('en');
    }
  });

  it('AC-BWO-004 the invoice line is described by the work order\'s own number and title — no English filler', () => {
    render(
      <InvoiceWorkOrderModal workOrder={{ ...WO, wo_number: null }} projectId="p1" clientId="c-1" remaining={1}
        onClose={vi.fn()} onCreated={onCreated} />,
    );
    expect(screen.getByLabelText('Description')).toHaveValue('Phase 1 fabrication');
  });

  it('the item is chosen from the ERP catalogue when ERPNext is connected', () => {
    h.connected = true;
    renderModal();
    expect(screen.getByText('ERP item')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Item code/)).toBeNull();
  });

  it('AC-BWO-004 the dialog opens on the first empty required field — the ERP item picker — not the pre-filled description', async () => {
    h.connected = true;
    renderModal();
    await vi.waitFor(() => expect(screen.getByRole('combobox', { name: 'ERP item' })).toHaveFocus());
    expect(screen.getByLabelText('Description')).not.toHaveFocus();
  });

  it('AC-BWO-004 the dialog opens on the item code when it is typed rather than picked', async () => {
    renderModal();
    await vi.waitFor(() => expect(screen.getByLabelText(/Item code/)).toHaveFocus());
  });

  it("AC-BWO-004 shows, read-only, the client PO reference the ERP invoice will carry", () => {
    render(
      <InvoiceWorkOrderModal workOrder={{ ...WO, client_po_number: 'MSW-PO-2604' }} projectId="p1" clientId="c-1" remaining={1}
        onClose={vi.fn()} onCreated={onCreated} />,
    );
    const po = screen.getByTestId('invoice-wo-client-po');
    expect(po).toHaveTextContent('Client PO on the invoice');
    expect(po).toHaveTextContent('MSW-PO-2604');
    expect(po.querySelector('input, textarea, select, button')).toBeNull();
  });

  it('AC-BWO-004 says so when the work order has no client PO to carry', () => {
    renderModal();
    expect(screen.getByTestId('invoice-wo-client-po')).toHaveTextContent('None on this work order');
  });

  it('AC-BWO-004 a create that fails for any other reason is headed as a failed create, never "Update failed"', async () => {
    h.mutateAsync.mockRejectedValue(new AppError('The external system could not be reached', 'external-unreachable'));
    renderModal();
    await userEvent.type(screen.getByLabelText(/Item code/), 'SVC');
    await submit();
    const region = await screen.findByTestId('entity-modal-save-error');
    expect(region).toHaveTextContent("Couldn't create the draft invoice");
    expect(region).not.toHaveTextContent('Update failed');
  });

  it('AC-BWO-004 the Cancel button reads in Bahasa', async () => {
    await financeTestI18n.changeLanguage('id');
    try {
      render(
        <FinanceI18nTestProvider>
          <InvoiceWorkOrderModal workOrder={WO} projectId="p1" clientId="c-1" remaining={1} onClose={vi.fn()} onCreated={onCreated} />
        </FinanceI18nTestProvider>,
      );
      expect(screen.getByRole('button', { name: 'Batal' })).toBeInTheDocument();
    } finally {
      await financeTestI18n.changeLanguage('en');
    }
  });

  it('#913 the ERP subtitle names ERPNext and a submitting user — unchanged by the native branch', () => {
    renderModal();
    expect(screen.getByText(/Creates a draft invoice in ERPNext/)).toBeInTheDocument();
    expect(screen.getByText(/A different Finance or Admin user submits it/)).toBeInTheDocument();
  });
});

describe('InvoiceWorkOrderModal — PMO owns revenue, no ERP (#913, OD-NAR-1 item 5)', () => {
  beforeEach(() => {
    h.mode = 'native';
    // A PMO Draft has no number yet (DD-NAR-9: minted on approval).
    h.mutateAsync.mockResolvedValue({ id: 'si-native-1', si_number: null });
  });

  it('#913 the copy names PMO and the second-person approval — never ERPNext', () => {
    renderModal();
    expect(screen.getByText('Creates a draft invoice in PMO for a second Finance/Admin person to approve.')).toBeInTheDocument();
    expect(screen.queryByText(/ERPNext/)).toBeNull();
  });

  it('#913 the line needs no ERP item — the work-order description alone completes the form', () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Create draft invoice' })).toBeEnabled();
  });

  it('#913 submitting calls the native create with the work order prefilled: client, project, work order, one line at the typed amount', async () => {
    renderModal();
    await userEvent.clear(amountInput());
    await userEvent.type(amountInput(), '25000.50');
    await submit();
    expect(h.mutateAsync).toHaveBeenCalledWith({
      customerId: 'c-1', projectId: 'p1', workOrderId: 'wo-1',
      items: [{ item_code: '', qty: 1, rate: 25000.5, description: 'WO-1 — Phase 1 fabrication' }],
      intent: { id: 'intent-1', idempotencyKey: 'key-1' },
    });
    // A PMO Draft has no number yet — none is reported.
    expect(onCreated).toHaveBeenCalledWith('');
  });

  it('#913 clearing both the item code and the description refuses the line before the round trip', async () => {
    renderModal();
    await userEvent.clear(screen.getByLabelText('Description'));
    await submit();
    expect(screen.getAllByText('Enter an item code or a description.').length).toBeGreaterThan(0);
    expect(h.mutateAsync).not.toHaveBeenCalled();
  });

  it('#913 a vat-rate-missing refusal shows the VAT guidance with the link to the project', async () => {
    h.mutateAsync.mockRejectedValue(
      new AppError('this project is subject to VAT but has no VAT rate: record it with the contract value before invoicing', 'vat-rate-missing'),
    );
    renderModal();
    await submit();
    const region = await screen.findByTestId('entity-modal-save-error');
    expect(region).toHaveTextContent('This project has no VAT rate recorded');
    const link = screen.getByRole('link', { name: 'Record the VAT rate on the project' });
    expect(link).toHaveAttribute('href', '/projects/p1');
  });

  it('#913 the 0262 ceiling refusal reads in PMO words — nothing was saved here — with the work-order amount', async () => {
    h.mutateAsync.mockRejectedValue(
      new AppError('this invoice would bill 80000.00 against work order WO-1: only 0.00 is still to invoice', 'BW001'),
    );
    renderModal();
    await submit();
    const region = await screen.findByTestId('entity-modal-save-error');
    expect(region).toHaveTextContent('That would invoice past the work order');
    expect(screen.getByText(/This work order had \$80,000\.00 still to invoice when you opened this dialog/)).toBeInTheDocument();
    expect(region).toHaveTextContent('Nothing was saved.');
    expect(region).not.toHaveTextContent('ERPNext');
    expect(onCreated).not.toHaveBeenCalled();
  });
});
