import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { AppError } from '@/src/lib/appError';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';

const h = vi.hoisted(() => ({ mutateAsync: vi.fn(), connected: false }));
vi.mock('@/src/hooks/useRevenue', () => ({ useRevenueMutations: () => ({ create: { mutateAsync: h.mutateAsync, isPending: false } }) }));
vi.mock('@/src/hooks/useErpItemOptions', () => ({
  useErpItemOptions: () => ({ connected: h.connected, loadOptions: async () => [{ value: 'SVC', label: 'SVC — Services' }] }),
}));
vi.mock('@/src/hooks/useCommandIntent', () => ({ useCommandIntent: () => ({ id: 'intent-1', idempotencyKey: 'key-1' }) }));

import InvoiceWorkOrderModal from '../InvoiceWorkOrderModal';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { financeTestI18n } from '../../__tests__/financeI18nTestInstance';
import { FinanceI18nTestProvider } from '../../__tests__/financeI18nTestProvider';

const WO = { id: 'wo-1', project_id: 'p1', wo_number: 'WO-1', title: 'Phase 1 fabrication', status: 'Issued', currency: 'USD' } as WorkOrderRow;
const onCreated = vi.fn();
const renderModal = (remaining = 80_000) => render(
  <InvoiceWorkOrderModal workOrder={WO} projectId="p1" clientId="c-1" remaining={remaining}
    onClose={vi.fn()} onCreated={onCreated} />,
);
const amountInput = () => screen.getByLabelText(/Amount \(excl\. PPN\)/);
const submit = () => userEvent.click(screen.getByRole('button', { name: 'Create draft invoice' }));

beforeEach(() => {
  h.mutateAsync.mockReset();
  h.mutateAsync.mockResolvedValue({ id: 'si-1', si_number: 'ACC-SINV-1' });
  h.connected = false;
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
});
