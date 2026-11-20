import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';

// Same harness as InvoiceWorkOrderModal.test.tsx — the real dialog; its write is faked.
const h = vi.hoisted(() => ({ mutateAsync: vi.fn(), connected: false, mode: 'erp' as 'erp' | 'native' | undefined, routeReady: true }));
vi.mock('@/src/hooks/useRevenue', () => ({ useRevenueMutations: () => ({ create: { mutateAsync: h.mutateAsync, isPending: false } }) }));
vi.mock('@/src/hooks/useErpItemOptions', () => ({
  useErpItemOptions: () => ({ connected: h.connected, loadOptions: async () => [{ value: 'SVC', label: 'SVC — Services' }] }),
}));
vi.mock('@/src/hooks/useCommandIntent', () => ({ useCommandIntent: () => ({ id: 'intent-1', idempotencyKey: 'key-1' }) }));
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => h.mode }));
vi.mock('@/src/hooks/useOwnershipCacheSync', () => ({ useRevenueRouteReady: (mode: unknown) => h.routeReady && mode !== undefined }));

import InvoiceWorkOrderModal from '../InvoiceWorkOrderModal';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';

const WO = { id: 'wo-1', project_id: 'p1', wo_number: 'WO-1', title: 'Phase 1 fabrication', status: 'Issued', currency: 'USD' } as WorkOrderRow;
const onCreated = vi.fn();
const amountInput = () => screen.getByLabelText(/Amount \(excl\. PPN\)/);

const renderModal = (remaining = 80_000) => render(
  <MemoryRouter>
    <FinanceI18nTestProvider>
      <InvoiceWorkOrderModal workOrder={WO} projectId="p1" clientId="c-1" remaining={remaining}
        onClose={vi.fn()} onCreated={onCreated} />
    </FinanceI18nTestProvider>
  </MemoryRouter>,
);

beforeEach(() => {
  h.mutateAsync.mockReset();
  h.mutateAsync.mockResolvedValue({ id: 'si-1', si_number: 'ACC-SINV-1' });
  h.connected = false;
  h.mode = 'erp';
  h.routeReady = true;
  onCreated.mockReset();
});

describe('InvoiceWorkOrderModal floor', () => {
  it('floor: saving the invoice line carries the entered amount with the order and project ids', async () => {
    renderModal();
    await userEvent.type(screen.getByLabelText(/Item code/), 'SVC');
    await userEvent.clear(amountInput());
    await userEvent.type(amountInput(), '25000');
    await userEvent.click(screen.getByRole('button', { name: 'Create draft invoice' }));

    expect(h.mutateAsync).toHaveBeenCalledWith({
      customerId: 'c-1', projectId: 'p1', workOrderId: 'wo-1',
      items: [{ item_code: 'SVC', qty: 1, rate: 25000, description: 'WO-1 — Phase 1 fabrication' }],
      intent: { id: 'intent-1', idempotencyKey: 'key-1' },
    });
    expect(onCreated).toHaveBeenCalledWith({ id: 'si-1', si_number: 'ACC-SINV-1' });
  });
});
