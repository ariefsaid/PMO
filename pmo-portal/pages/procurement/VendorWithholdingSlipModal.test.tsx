import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ data: { pages: [] as unknown[] }, save: vi.fn() }));
vi.mock('@/src/hooks/useVendorWithholdingSlips', () => ({ useVendorWithholdingCandidates: () => ({ data: h.data, isLoading: false, isError: false, hasNextPage: false, refetch: vi.fn(), fetchNextPage: vi.fn(), isFetchingNextPage: false }) }));
import { VendorWithholdingSlipModal } from './VendorWithholdingSlipModal';
import type { ProcurementInvoiceRow } from '@/src/lib/db/procurementLifecycle';
const invoice = { id: 'invoice-a', currency: 'IDR', withheld_amount: 20000, withheld_pph_type: 'pph23' } as ProcurementInvoiceRow;
const bill = { invoice_id: 'invoice-a', vendor_id: 'vendor-a', currency: 'IDR', withheld_amount: '20000.00', withheld_pph_type: 'pph23', invoice_date: '2026-10-01' };

describe('AC-BUPOT-017 capture form', () => {
  it('pins the vendor/currency, preselects the starting bill, and refuses a one-cent mismatch', async () => {
    h.data = { pages: [{ rows: [bill] }] };
    render(<VendorWithholdingSlipModal invoice={invoice} vendorId="vendor-a" open onClose={vi.fn()} onSave={h.save} />);
    expect(await screen.findByText('IDR 20000.00')).toBeInTheDocument();
    expect(screen.getByText(/vendor-a/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/issued slip number/i), { target: { value: 'DJ-TEST-1' } });
    fireEvent.change(screen.getByLabelText(/tax base/i), { target: { value: '20000.00' } });
    fireEvent.change(screen.getByLabelText(/issued withheld amount/i), { target: { value: '19999.99' } });
    expect(screen.getByText(/must exactly equal/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /record bukti potong/i })).toBeDisabled();
    expect(h.save).not.toHaveBeenCalled();
  });
  it('retains the stable capture intent across a refused attempt', async () => {
    h.data = { pages: [{ rows: [bill] }] };
    h.save.mockRejectedValueOnce({ code: '23514', details: 'bupot-amount-mismatch' });
    render(<VendorWithholdingSlipModal invoice={invoice} vendorId="vendor-a" open onClose={vi.fn()} onSave={h.save} />);
    fireEvent.change(await screen.findByLabelText(/issued slip number/i), { target: { value: 'DJ-TEST-2' } });
    fireEvent.change(screen.getByLabelText(/tax base/i), { target: { value: '20000.00' } });
    fireEvent.change(screen.getByLabelText(/issued withheld amount/i), { target: { value: '20000.00' } });
    fireEvent.click(screen.getByRole('button', { name: /record bukti potong/i }));
    await waitFor(() => expect(h.save).toHaveBeenCalledOnce());
    expect(await screen.findByText(/issued amount does not match/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/issued slip number/i)).toHaveValue('DJ-TEST-2');
  });
});
