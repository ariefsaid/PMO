import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/supabase-js';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';

/**
 * AC-BWO-004 (#785 Discover): the over-invoice refusal driven through the REAL write path — dialog → useRevenueMutations →
 * repositories.revenue.createInvoice → dispatchDomainCommand → classifyDispatchError. Only the network boundary
 * (`supabase.functions.invoke`) is faked, answering exactly what adapter-dispatch answers: HTTP 422 `{ error, message }`.
 * The unit tests beside this one hand the dialog an AppError that already carries `BW001`; that is how the transport
 * dropping the code went unseen.
 */
const h = vi.hoisted(() => ({ invoke: vi.fn(), mode: 'erp' as 'erp' | 'native' }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { functions: { invoke: h.invoke } } }));
// The ERP item picker is not on the write path: the free-text item code keeps the test to the transport.
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: false, loadOptions: async () => [] }) }));
// The dialog's mode branch is copy-only; the write-time routing under test here is the repository's (ownership cache).
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => h.mode }));

import InvoiceWorkOrderModal from '../InvoiceWorkOrderModal';
import { clearOwnershipCache, setDomainOwnership } from '@/src/lib/adapterSeam/ownershipCache';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { financeTestI18n } from '../../__tests__/financeI18nTestInstance';
import { FinanceI18nTestProvider } from '../../__tests__/financeI18nTestProvider';

const RAW = 'this invoice would bill 100000.00 against work order WO-3 (worth 120000.00 excl. tax, with 80000.00 already invoiced or in draft): only 40000.00 is still to invoice';
const WO = { id: 'wo-3', project_id: 'p1', wo_number: 'WO-3', title: 'Commissioning support', status: 'Issued', currency: 'USD', client_po_number: 'PO-9' } as WorkOrderRow;
const answer = (status: number, body: Record<string, string>) =>
  h.invoke.mockResolvedValue({
    data: null,
    error: new FunctionsHttpError(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })),
  });

const renderModal = (wo: WorkOrderRow = WO) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <FinanceI18nTestProvider>
        <InvoiceWorkOrderModal workOrder={wo} projectId="p1" clientId="c-1" remaining={120_000} onClose={vi.fn()} onCreated={vi.fn()} />
      </FinanceI18nTestProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  h.invoke.mockReset();
  setDomainOwnership([{ domain: 'revenue', externalTier: 'erpnext' }]);
});
afterEach(() => clearOwnershipCache());

describe('InvoiceWorkOrderModal over the real dispatch transport (AC-BWO-004)', () => {
  it('AC-BWO-004 a 422 BW001 from adapter-dispatch reads as the localized refusal — never "Update failed", never the raw text', async () => {
    answer(422, { error: 'BW001', message: RAW });
    renderModal();
    await userEvent.type(screen.getByLabelText(/Item code/), 'SVC-INSTALL');
    await userEvent.click(screen.getByRole('button', { name: 'Create draft invoice' }));

    const region = await screen.findByTestId('entity-modal-save-error');
    expect(region).toHaveTextContent('That would invoice past the work order');
    expect(region).toHaveTextContent(/This work order had \$120,000\.00 still to invoice when you opened this dialog/);
    expect(region).not.toHaveTextContent('Update failed');
    expect(region).not.toHaveTextContent('only 40000.00');
    expect(h.invoke).toHaveBeenCalledWith('adapter-dispatch', expect.objectContaining({
      body: expect.objectContaining({ domain: 'revenue', operation: 'create' }),
    }));
  });

  it('AC-BWO-004 the same refusal reads in Bahasa, with the amount in the Indonesian money format', async () => {
    answer(422, { error: 'BW001', message: RAW });
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    await financeTestI18n.changeLanguage('id');
    try {
      renderModal({ ...WO, currency: 'IDR' });
      await userEvent.type(screen.getByLabelText(/Kode item/), 'SVC-INSTALL');
      await userEvent.click(screen.getByRole('button', { name: 'Buat draf faktur' }));
      const region = await screen.findByTestId('entity-modal-save-error');
      expect(region).toHaveTextContent('Tagihan ini akan melewati nilai Work Order');
      expect(region).toHaveTextContent(/Rp\s?120\.000,00/);
      expect(region).not.toHaveTextContent('Update failed');
      expect(region).not.toHaveTextContent('only 40000.00');
    } finally {
      resetActiveLocale();
      await financeTestI18n.changeLanguage('en');
    }
  });

  it('AC-BWO-004 any other create failure is headed as a failed create, never "Update failed"', async () => {
    answer(500, { error: 'DISPATCH_FAILED', message: 'boom' });
    renderModal();
    await userEvent.type(screen.getByLabelText(/Item code/), 'SVC-INSTALL');
    await userEvent.click(screen.getByRole('button', { name: 'Create draft invoice' }));
    const region = await screen.findByTestId('entity-modal-save-error');
    expect(region).toHaveTextContent("Couldn't create the draft invoice");
    expect(region).not.toHaveTextContent('Update failed');
  });
});
