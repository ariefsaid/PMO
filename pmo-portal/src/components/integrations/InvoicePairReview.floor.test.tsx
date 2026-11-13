import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';

const h = vi.hoisted(() => ({
  proposeInvoicePairs: vi.fn(),
  acceptInvoicePairs: vi.fn(),
  unpairInvoice: vi.fn(),
  listUnpairedNativeInvoices: vi.fn(),
  listAcceptedInvoicePairs: vi.fn(),
  listOwn: vi.fn(),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { revenue: h, externalDomainOwnership: { listOwn: h.listOwn } } }));

import { InvoicePairReview } from './InvoicePairReview';

const proposal = (n: number) => ({
  pmoInvoiceId: `pmo-${n}`,
  erpInvoiceId: `erp-${n}`,
  ambiguous: false,
  pmoNumber: `PMO-${n}`,
  erpNumber: `SI-${n}`,
  customerName: 'Acme Co',
  amount: 1000 * n,
  currency: 'IDR',
  invoiceDate: '2026-03-10',
});

function mount() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ImpersonationProvider realRole="Finance"><InvoicePairReview orgId="org-1" /></ImpersonationProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.listOwn.mockResolvedValue([{ domain: 'revenue', externalTier: 'erp' }]);
  h.proposeInvoicePairs.mockResolvedValue([proposal(1)]);
  h.listUnpairedNativeInvoices.mockResolvedValue([]);
  h.listAcceptedInvoicePairs.mockResolvedValue([]);
  h.acceptInvoicePairs.mockResolvedValue(1);
  h.unpairInvoice.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('invoice pair review floor controls', () => {
  it('floor: Count each once sends the selected invoice pair ids after confirmation', async () => {
    mount();
    expect(await screen.findByText('PMO-1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Count each once' }));
    const dialog = await screen.findByRole('dialog', { name: 'Count these invoices once?' });
    expect(h.acceptInvoicePairs).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Count once' }));
    await waitFor(() => expect(h.acceptInvoicePairs).toHaveBeenCalledWith([{ pmoInvoiceId: 'pmo-1', erpInvoiceId: 'erp-1' }]));
  });

  it('floor: Undo removes the accepted pair after confirmation', async () => {
    h.proposeInvoicePairs.mockResolvedValue([]);
    h.listAcceptedInvoicePairs
      .mockResolvedValueOnce([{ pmoInvoiceId: 'pmo-9', pmoNumber: 'PMO-9', amount: 9000, currency: 'IDR', pairedAt: '2026-11-02T01:00:00Z', erpNumber: 'SI-9' }])
      .mockResolvedValue([]);
    mount();
    fireEvent.click(await screen.findByText('1 invoice already counts once'));
    fireEvent.click(screen.getByRole('button', { name: 'Undo PMO-9' }));
    const dialog = await screen.findByRole('dialog', { name: 'Count PMO-9 on its own again?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(h.unpairInvoice).toHaveBeenCalledWith('pmo-9'));
    await waitFor(() => expect(h.listAcceptedInvoicePairs).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('PMO-9')).not.toBeInTheDocument());
  });

  it('floor: matching invoices Retry reloads only the matching invoice read', async () => {
    h.proposeInvoicePairs.mockRejectedValueOnce(new Error('network down')).mockResolvedValue([proposal(1)]);
    mount();
    const alert = await screen.findByRole('alert');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(h.proposeInvoicePairs).toHaveBeenCalledTimes(2));
    expect(h.listUnpairedNativeInvoices).toHaveBeenCalledTimes(1);
    expect(h.listAcceptedInvoicePairs).toHaveBeenCalledTimes(1);
  });

  it('floor: still-counted invoices Retry reloads only the still-counted read', async () => {
    h.listUnpairedNativeInvoices.mockRejectedValueOnce(new Error('network down')).mockResolvedValue([]);
    mount();
    const alert = await screen.findByRole('alert');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(h.listUnpairedNativeInvoices).toHaveBeenCalledTimes(2));
    expect(h.proposeInvoicePairs).toHaveBeenCalledTimes(1);
    expect(h.listAcceptedInvoicePairs).toHaveBeenCalledTimes(1);
  });

  it('floor: accepted pairs Retry reloads only the accepted pair read', async () => {
    h.listAcceptedInvoicePairs.mockRejectedValueOnce(new Error('network down')).mockResolvedValue([]);
    mount();
    const alert = await screen.findByRole('alert');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(h.listAcceptedInvoicePairs).toHaveBeenCalledTimes(2));
    expect(h.proposeInvoicePairs).toHaveBeenCalledTimes(1);
    expect(h.listUnpairedNativeInvoices).toHaveBeenCalledTimes(1);
  });
});
